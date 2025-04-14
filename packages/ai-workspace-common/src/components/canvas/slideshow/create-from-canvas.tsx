import {
  useCreatePage,
  useGetCanvasData,
} from '@refly-packages/ai-workspace-common/queries/queries';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Form, Input, message, Typography } from 'antd';
import { CheckboxChangeEvent } from 'antd/es/checkbox';
const { Text } = Typography;

interface CreatePageFromCanvasProps {
  canvasId: string;
  afterCreate: (pageId: string) => void;
}

export const CreatePageFromCanvas = memo(({ canvasId, afterCreate }: CreatePageFromCanvasProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [nodeIds, setNodeIds] = useState<string[]>([]);

  const { mutate: createPage, isPending } = useCreatePage(undefined, {
    onError: (error) => {
      console.error('Failed to create page:', error);
    },
  });

  const {
    data: canvasData,
    refetch: refetchCanvasData,
    isLoading,
  } = useGetCanvasData(
    {
      query: {
        canvasId,
      },
    },
    null,
    { enabled: !!canvasId?.trim() },
  );

  const availableNodes = useMemo(
    () =>
      (canvasData?.data?.nodes || []).filter(
        (node: any) =>
          node?.type && !['group', 'skill'].includes(node?.type) && node?.data?.entityId,
      ),
    [canvasData?.data?.nodes],
  );

  const checkedAll = useMemo(
    () => nodeIds?.length === availableNodes?.length && availableNodes?.length > 0,
    [nodeIds, availableNodes],
  );

  const indeterminate = useMemo(
    () => (nodeIds?.length ?? 0) > 0 && (nodeIds?.length ?? 0) < (availableNodes?.length ?? 0),
    [nodeIds, availableNodes],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!canvasId?.trim()) {
        return;
      }

      if (nodeIds?.length === 0) {
        message.error(t('pages.new.pleaseSelectAtLeastOneNode'));
        return;
      }

      createPage(
        {
          body: {
            title: title?.trim() || t('pages.new.untitledPage'),
            description: t('pages.new.createdFromCanvas', { canvasId }),
            content: {
              canvasId,
              nodeIds,
            },
          },
        },
        {
          onSuccess: (response: any) => {
            const pageId = response?.data?.data?.pageId;
            if (pageId) {
              setTitle('');
              setNodeIds([]);
              afterCreate?.(pageId);
            } else {
              message.error(t('pages.new.createPageFailed'));
            }
          },
        },
      );
    },
    [canvasId, nodeIds, title, t, createPage, afterCreate],
  );

  const handleCheckAll = useCallback(
    (e: CheckboxChangeEvent) => {
      const newNodeIds = e.target.checked
        ? availableNodes?.map((node) => node?.data?.entityId).filter(Boolean)
        : [];
      setNodeIds(newNodeIds);
    },
    [availableNodes],
  );

  const handleNodeIdsChange = useCallback((values: string[]) => {
    setNodeIds(values);
  }, []);

  useEffect(() => {
    return () => {
      setNodeIds([]);
    };
  }, [canvasId]);

  return (
    <div className="mx-auto flex flex-col w-full h-full max-w-3xl">
      <Form className="flex flex-col flex-1 min-h-20 pt-6">
        <div className="flex-1 overflow-y-auto">
          <Form.Item label={t('pages.new.pageTitle')} name="title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('pages.new.enterPageTitle')}
            />
          </Form.Item>
          <Form.Item
            className="flex-grow min-h-10 node-select-container"
            label={t('pages.new.selectNodesToInclude')}
            name="nodeIds"
            required={true}
          >
            <div className="mb-2 pt-1">
              <Checkbox
                checked={checkedAll}
                indeterminate={indeterminate}
                onChange={handleCheckAll}
              >
                {t('pages.new.selectAll')}
              </Checkbox>
            </div>
            <Checkbox.Group
              className="w-full flex flex-col gap-2"
              value={nodeIds}
              onChange={handleNodeIdsChange}
            >
              {availableNodes?.map((node) => (
                <Checkbox key={node?.data?.entityId} value={node?.data?.entityId}>
                  <Text ellipsis={{ tooltip: true }}>
                    {node?.data?.title || t('common.untitled')}
                  </Text>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </div>
        <div className="w-full flex gap-2 justify-end py-4 border-t">
          <Button type="default" onClick={() => refetchCanvasData()} loading={isLoading}>
            {t('pages.new.refresh')}
          </Button>
          <Button
            type="primary"
            onClick={handleSubmit}
            loading={isPending}
            disabled={nodeIds?.length === 0}
          >
            {t('pages.new.createPage')}
          </Button>
        </div>
      </Form>
    </div>
  );
});
