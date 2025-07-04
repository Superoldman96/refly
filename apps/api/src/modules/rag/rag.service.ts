import { Injectable, Logger, Inject } from '@nestjs/common';
import { Document, DocumentInterface } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { cleanMarkdownForIngest } from '@refly/utils';
import * as avro from 'avsc';
import { SearchResult, User } from '@refly/openapi-schema';
import { HybridSearchParam, ContentPayload, DocumentPayload } from './rag.dto';
import { VectorSearchService, VectorPoint, VectorFilter } from '../common/vector-search';
import { VECTOR_SEARCH } from '../common/vector-search/tokens';
import { genResourceUuid } from '../../utils';
import { ProviderService } from '../provider/provider.service';

// Define Avro schema for vector points (must match the one used for serialization)
const avroSchema = avro.Type.forSchema({
  type: 'array',
  items: {
    type: 'record',
    name: 'Point',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'vector', type: { type: 'array', items: 'float' } },
      { name: 'payload', type: 'string' }, // JSON string of payload
      {
        name: 'metadata',
        type: {
          type: 'record',
          name: 'Metadata',
          fields: [
            { name: 'nodeType', type: 'string' },
            { name: 'entityId', type: 'string' },
            { name: 'originalUid', type: 'string' },
          ],
        },
      },
    ],
  },
});

@Injectable()
export class RAGService {
  private splitter: RecursiveCharacterTextSplitter;
  private logger = new Logger(RAGService.name);

  constructor(
    @Inject(VECTOR_SEARCH)
    private vectorSearch: VectorSearchService,
    private providerService: ProviderService,
  ) {
    this.splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
      chunkSize: 1000,
      chunkOverlap: 0,
    });
  }

  async chunkText(text: string) {
    return await this.splitter.splitText(cleanMarkdownForIngest(text));
  }

  // metadata?.uniqueId for save or retrieve
  async inMemorySearchWithIndexing(
    user: User,
    options: {
      content: string | Document<any> | Array<Document<any>>;
      query?: string;
      k?: number;
      filter?: (doc: Document<DocumentPayload>) => boolean;
      needChunk?: boolean;
      additionalMetadata?: Record<string, any>;
    },
  ): Promise<DocumentInterface[]> {
    const { content, query, k = 10, filter, needChunk = true, additionalMetadata = {} } = options;
    const { uid } = user;

    if (!query) {
      return [];
    }

    // Create a temporary MemoryVectorStore for this operation
    const embeddings = await this.providerService.prepareEmbeddings(user);
    const tempMemoryVectorStore = new MemoryVectorStore(embeddings);

    // Prepare the document
    let documents: Document<any>[];
    if (Array.isArray(content)) {
      documents = content.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          tenantId: uid,
          ...additionalMetadata,
        },
      }));
    } else {
      let doc: Document<any>;
      if (typeof content === 'string') {
        doc = {
          pageContent: content,
          metadata: {
            tenantId: uid,
            ...additionalMetadata,
          },
        };
      } else {
        doc = {
          ...content,
          metadata: {
            ...content.metadata,
            tenantId: uid,
            ...additionalMetadata,
          },
        };
      }

      // Index the content
      const chunks = needChunk ? await this.chunkText(doc.pageContent) : [doc.pageContent];
      let startIndex = 0;
      documents = chunks.map((chunk) => {
        const document = {
          pageContent: chunk.trim(),
          metadata: {
            ...doc.metadata,
            tenantId: uid,
            ...additionalMetadata,
            start: startIndex,
            end: startIndex + chunk.trim().length,
          },
        };

        startIndex += chunk.trim().length;

        return document;
      });
    }

    await tempMemoryVectorStore.addDocuments(documents);

    // Perform the search
    const wrapperFilter = (doc: Document<DocumentPayload>) => {
      // Always check for tenantId
      const tenantIdMatch = doc.metadata.tenantId === uid;

      // If filter is undefined, only check tenantId
      if (filter === undefined) {
        return tenantIdMatch;
      }

      // If filter is defined, apply both filter and tenantId check
      return filter(doc) && tenantIdMatch;
    };

    return tempMemoryVectorStore.similaritySearch(query, k, wrapperFilter);
  }

  async indexDocument(user: User, doc: Document<DocumentPayload>): Promise<{ size: number }> {
    const { uid } = user;
    const { pageContent, metadata } = doc;
    const { nodeType, docId, resourceId } = metadata;
    const entityId = nodeType === 'document' ? docId : resourceId;

    // Get new chunks
    const newChunks = await this.chunkText(pageContent);

    // Get existing points for this document using scroll
    const existingPoints = await this.vectorSearch.scroll({
      filter: {
        must: [
          { key: 'tenantId', match: { value: uid } },
          { key: nodeType === 'document' ? 'docId' : 'resourceId', match: { value: entityId } },
        ],
      },
      with_payload: true,
      with_vector: true,
    });

    // Create a map of existing chunks for quick lookup
    const existingChunksMap = new Map(
      existingPoints.map((point) => [
        point.payload.content,
        {
          id: point.id,
          vector: point.vector as number[],
        },
      ]),
    );

    // Prepare points for new or updated chunks
    const pointsToUpsert: VectorPoint[] = [];
    const chunksNeedingEmbeddings: string[] = [];
    const chunkIndices: number[] = [];

    // Identify which chunks need new embeddings
    for (let i = 0; i < newChunks.length; i++) {
      const chunk = newChunks[i];
      const existing = existingChunksMap.get(chunk);

      if (existing) {
        // Reuse existing embedding for identical chunks
        pointsToUpsert.push({
          id: genResourceUuid(`${entityId}-${i}`),
          vector: existing.vector,
          payload: {
            ...metadata,
            seq: i,
            content: chunk,
            tenantId: uid,
          },
        });
      } else {
        // Mark for new embedding computation
        chunksNeedingEmbeddings.push(chunk);
        chunkIndices.push(i);
      }
    }

    // Compute embeddings only for new or modified chunks
    if (chunksNeedingEmbeddings.length > 0) {
      const embeddings = await this.providerService.prepareEmbeddings(user);
      const vectors = await embeddings.embedDocuments(chunksNeedingEmbeddings);

      // Create points for chunks with new embeddings
      chunkIndices.forEach((originalIndex, embeddingIndex) => {
        pointsToUpsert.push({
          id: genResourceUuid(`${entityId}-${originalIndex}`),
          vector: vectors[embeddingIndex],
          payload: {
            ...metadata,
            seq: originalIndex,
            content: chunksNeedingEmbeddings[embeddingIndex],
            tenantId: uid,
          },
        });
      });
    }

    // Delete existing points for this document
    if (existingPoints.length > 0) {
      await this.vectorSearch.batchDelete({
        must: [
          { key: 'tenantId', match: { value: uid } },
          { key: nodeType === 'document' ? 'docId' : 'resourceId', match: { value: entityId } },
        ],
      });
    }

    // Save new points
    if (pointsToUpsert.length > 0) {
      await this.vectorSearch.batchSaveData(pointsToUpsert);
    }

    return { size: this.vectorSearch.estimatePointsSize(pointsToUpsert) };
  }

  async deleteResourceNodes(user: User, resourceId: string) {
    return this.vectorSearch.batchDelete({
      must: [
        { key: 'tenantId', match: { value: user.uid } },
        { key: 'resourceId', match: { value: resourceId } },
      ],
    });
  }

  async deleteDocumentNodes(user: User, docId: string) {
    return this.vectorSearch.batchDelete({
      must: [
        { key: 'tenantId', match: { value: user.uid } },
        { key: 'docId', match: { value: docId } },
      ],
    });
  }

  async duplicateDocument(param: {
    sourceUid: string;
    targetUid: string;
    sourceDocId: string;
    targetDocId: string;
  }) {
    const { sourceUid, targetUid, sourceDocId, targetDocId } = param;

    try {
      this.logger.log(
        `Duplicating document ${sourceDocId} from user ${sourceUid} to user ${targetUid}`,
      );

      // Fetch all points for the source document
      const points = await this.vectorSearch.scroll({
        filter: {
          must: [
            { key: 'tenantId', match: { value: sourceUid } },
            { key: 'docId', match: { value: sourceDocId } },
          ],
        },
        with_payload: true,
        with_vector: true,
      });

      if (!points?.length) {
        this.logger.warn(`No points found for document ${sourceDocId}`);
        return { size: 0, pointsCount: 0 };
      }

      // Prepare points for the target user
      const pointsToUpsert: VectorPoint[] = points.map((point) => ({
        ...point,
        id: genResourceUuid(`${sourceUid}-${targetDocId}-${point.payload.seq ?? 0}`),
        payload: {
          ...point.payload,
          tenantId: targetUid,
        },
      }));

      // Calculate the size of the points to be upserted
      const size = this.vectorSearch.estimatePointsSize(pointsToUpsert);

      // Perform the upsert operation
      await this.vectorSearch.batchSaveData(pointsToUpsert);

      this.logger.log(
        `Successfully duplicated ${pointsToUpsert.length} points for document ${sourceDocId} to user ${targetUid}`,
      );

      return {
        size,
        pointsCount: pointsToUpsert.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to duplicate document ${sourceDocId} from user ${sourceUid} to ${targetUid}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async retrieve(user: User, param: HybridSearchParam): Promise<ContentPayload[]> {
    if (!param.vector) {
      const embeddings = await this.providerService.prepareEmbeddings(user);
      param.vector = await embeddings.embedQuery(param.query);
      // param.vector = Array(256).fill(0);
    }

    const conditions: VectorFilter[] = [
      {
        key: 'tenantId',
        match: { value: user.uid },
      },
    ];

    if (param.filter?.nodeTypes?.length > 0) {
      conditions.push({
        key: 'nodeType',
        match: { any: param.filter?.nodeTypes },
      });
    }
    if (param.filter?.urls?.length > 0) {
      conditions.push({
        key: 'url',
        match: { any: param.filter?.urls },
      });
    }
    if (param.filter?.docIds?.length > 0) {
      conditions.push({
        key: 'docId',
        match: { any: param.filter?.docIds },
      });
    }
    if (param.filter?.resourceIds?.length > 0) {
      conditions.push({
        key: 'resourceId',
        match: { any: param.filter?.resourceIds },
      });
    }
    if (param.filter?.projectIds?.length > 0) {
      conditions.push({
        key: 'projectId',
        match: { any: param.filter?.projectIds },
      });
    }

    const filter: VectorFilter = { must: conditions };
    const results = await this.vectorSearch.search(param, filter);
    return results.map((res) => res.payload as any);
  }

  /**
   * Rerank search results using the configured reranker.
   */
  async rerank(
    user: User,
    query: string,
    results: SearchResult[],
    options?: { topN?: number; relevanceThreshold?: number },
  ): Promise<SearchResult[]> {
    try {
      const reranker = await this.providerService.prepareReranker(user);
      return await reranker.rerank(query, results, options);
    } catch (e) {
      this.logger.error(`Reranker failed, fallback to original results: ${e.stack}`);
      return results;
    }
  }

  /**
   * Serializes all vector points for a document into Avro binary format.
   * @param user The user that owns the document
   * @param param Parameters object containing document/resource details
   * @param param.docId The document ID to export (use either docId or resourceId)
   * @param param.resourceId The resource ID to export (use either docId or resourceId)
   * @param param.nodeType The node type ('document' or 'resource')
   * @returns Binary data in Avro format and metadata about the export
   */
  async serializeToAvro(
    user: User,
    param: {
      docId?: string;
      resourceId?: string;
      nodeType?: 'document' | 'resource';
    },
  ): Promise<{ data: Buffer; pointsCount: number; size: number }> {
    const { docId, resourceId, nodeType = docId ? 'document' : 'resource' } = param;
    const entityId = nodeType === 'document' ? docId : resourceId;

    if (!entityId) {
      throw new Error('Either docId or resourceId must be provided');
    }

    try {
      this.logger.log(`Serializing ${nodeType} ${entityId} from user ${user.uid} to Avro binary`);

      // Fetch all points for the document
      const points = await this.vectorSearch.scroll({
        filter: {
          must: [
            { key: 'tenantId', match: { value: user.uid } },
            { key: nodeType === 'document' ? 'docId' : 'resourceId', match: { value: entityId } },
          ],
        },
        with_payload: true,
        with_vector: true,
      });

      if (!points?.length) {
        this.logger.warn(`No points found for ${nodeType} ${entityId}`);
        return { data: Buffer.from([]), pointsCount: 0, size: 0 };
      }

      // Prepare points for serialization
      const pointsForAvro = points.map((point) => ({
        id: point.id,
        vector: point.vector,
        payload: JSON.stringify(point.payload),
        metadata: {
          nodeType,
          entityId,
          originalUid: user.uid,
        },
      }));

      // Serialize points to Avro binary
      const avroBuffer = Buffer.from(avroSchema.toBuffer(pointsForAvro));
      const size = avroBuffer.length;

      this.logger.log(
        `Successfully serialized ${points.length} points for ${nodeType} ${entityId} to Avro binary (${size} bytes)`,
      );

      return {
        data: avroBuffer,
        pointsCount: points.length,
        size,
      };
    } catch (error) {
      this.logger.error(
        `Failed to serialize ${nodeType} ${entityId} from user ${user.uid} to Avro binary: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Deserializes Avro binary data and saves the vector points to Qdrant with new IDs.
   * @param user The target user to save the points for
   * @param param Parameters object containing target details
   * @param param.data The Avro binary data to deserialize
   * @param param.targetDocId The target document ID (use either targetDocId or targetResourceId)
   * @param param.targetResourceId The target resource ID (use either targetDocId or targetResourceId)
   * @returns Metadata about the import operation
   */
  async deserializeFromAvro(
    user: User,
    param: {
      data: Buffer;
      targetDocId?: string;
      targetResourceId?: string;
    },
  ): Promise<{ size: number; pointsCount: number }> {
    const { data, targetDocId, targetResourceId } = param;
    const targetNodeType = targetDocId ? 'document' : 'resource';
    const targetEntityId = targetNodeType === 'document' ? targetDocId : targetResourceId;

    if (!targetEntityId) {
      throw new Error('Either targetDocId or targetResourceId must be provided');
    }

    if (!data || data.length === 0) {
      this.logger.warn('No Avro data provided for deserialization');
      return { size: 0, pointsCount: 0 };
    }

    try {
      this.logger.log(
        `Deserializing Avro binary to ${targetNodeType} ${targetEntityId} for user ${user.uid}`,
      );

      // Deserialize Avro binary to points
      const deserializedPoints = avroSchema.fromBuffer(data);

      if (!deserializedPoints?.length) {
        this.logger.warn('No points found in Avro data');
        return { size: 0, pointsCount: 0 };
      }

      // Prepare points for saving to Qdrant with new IDs and tenant
      const pointsToUpsert = deserializedPoints.map((point, index) => {
        const payload = JSON.parse(point.payload);

        // Generate a new ID for the point
        const id = genResourceUuid(`${targetEntityId}-${index}`);

        // Update payload with new tenant ID and entity ID
        const updatedPayload = {
          ...payload,
          tenantId: user.uid,
        };

        // If the point refers to a document or resource, update its ID
        if (targetNodeType === 'document' && payload.docId) {
          updatedPayload.docId = targetDocId;
        } else if (targetNodeType === 'resource' && payload.resourceId) {
          updatedPayload.resourceId = targetResourceId;
        }

        return {
          id,
          vector: point.vector,
          payload: updatedPayload,
        };
      });

      // Calculate the size of points
      const size = this.vectorSearch.estimatePointsSize(pointsToUpsert);

      // Save points to Qdrant
      await this.vectorSearch.batchSaveData(pointsToUpsert);

      this.logger.log(
        `Successfully deserialized ${pointsToUpsert.length} points from Avro binary to ${targetNodeType} ${targetEntityId} for user ${user.uid}`,
      );

      return {
        size,
        pointsCount: pointsToUpsert.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to deserialize Avro binary to ${targetNodeType} ${targetEntityId} for user ${user.uid}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Updates arbitrary metadata for all points of a given document or resource.
   * @param user The user that owns the document/resource
   * @param params Parameters for the update operation
   * @param params.docId The document ID to update (use either docId or resourceId)
   * @param params.resourceId The resource ID to update (use either docId or resourceId)
   * @param params.metadata The metadata fields to update
   * @returns Metadata about the update operation
   */
  async updateDocumentPayload(
    user: User,
    params: {
      docId?: string | string[];
      resourceId?: string | string[];
      metadata: Record<string, any>;
    },
  ) {
    const { docId, resourceId, metadata } = params;

    // Determine if we're dealing with documents, resources, or both
    const hasDocIds = docId && (typeof docId === 'string' ? [docId].length > 0 : docId.length > 0);
    const hasResourceIds =
      resourceId &&
      (typeof resourceId === 'string' ? [resourceId].length > 0 : resourceId.length > 0);

    // Convert single values to arrays
    const docIds = typeof docId === 'string' ? [docId] : (docId ?? []);
    const resourceIds = typeof resourceId === 'string' ? [resourceId] : (resourceId ?? []);

    if (!hasDocIds && !hasResourceIds) {
      throw new Error('Either docId or resourceId must be provided');
    }

    if (!metadata || Object.keys(metadata).length === 0) {
      throw new Error('No metadata fields provided for update');
    }

    this.logger.log(
      `Updating metadata ${JSON.stringify(metadata)} for ${JSON.stringify(
        hasDocIds ? docIds : resourceIds,
      )} from user ${user.uid}`,
    );

    // Prepare filter conditions
    const conditions: VectorFilter[] = [{ key: 'tenantId', match: { value: user.uid } }];

    // Add conditions for documents and resources
    if (hasDocIds) {
      conditions.push({ key: 'docId', match: { any: docIds } });
    }

    if (hasResourceIds) {
      conditions.push({ key: 'resourceId', match: { any: resourceIds } });
    }

    const filter: VectorFilter = { must: conditions };
    return await this.vectorSearch.updatePayload(filter, metadata);
  }
}
