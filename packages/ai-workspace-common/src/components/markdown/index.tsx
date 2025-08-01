import { LoadingOutlined } from '@ant-design/icons';
import { memo, useEffect, useRef, useState, Suspense, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

import RemarkBreaks from 'remark-breaks';

import { cn, markdownCitationParse } from '@refly/utils';

// plugins
import LinkElement from './plugins/link';
import rehypeHighlight from './custom-plugins/rehype-highlight';
import remarkGfm from 'remark-gfm';
// styles
import './styles/markdown.scss';
import './styles/highlight.scss';
import { Source } from '@refly/openapi-schema';
import { useTranslation } from 'react-i18next';

import { markdownElements } from './plugins';
import { processWithArtifact } from '@refly/utils/artifact';
import { ImagePreview } from '@refly-packages/ai-workspace-common/components/common/image-preview';
import { MarkdownMode } from './types';

const rehypePlugins = markdownElements.map((element) => element.rehypePlugin);

// Image component for handling preview
const MarkdownImage = memo(({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="max-w-full h-auto cursor-zoom-in rounded-lg hover:opacity-90 transition-opacity"
        onClick={(e) => {
          e.preventDefault();
          setIsPreviewVisible(true);
        }}
        {...props}
      />
      <ImagePreview
        isPreviewModalVisible={isPreviewVisible}
        setIsPreviewModalVisible={setIsPreviewVisible}
        imageUrl={src ?? ''}
        imageTitle={alt}
      />
    </>
  );
});

// Custom Components for enhanced Markdown rendering
const HighlightComponent = ({ children }: { children: React.ReactNode }) => (
  <mark className="bg-yellow-200 dark:bg-yellow-800 dark:text-gray-200 rounded-sm px-1 text-inherit">
    {children}
  </mark>
);

const StrikethroughComponent = ({ children }: { children: React.ReactNode }) => (
  <del>{children}</del>
);

export const Markdown = memo(
  (
    props: {
      content: string;
      loading?: boolean;
      sources?: Source[];
      className?: string;
      resultId?: string;
      mode?: MarkdownMode;
    } & React.DOMAttributes<HTMLDivElement>,
  ) => {
    const { content: rawContent, mode = 'interactive' } = props;
    const content = processWithArtifact(rawContent);

    const mdRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const [isKatexLoaded, setIsKatexLoaded] = useState(false);

    // Add state for dynamically loaded plugins
    const [plugins, setPlugins] = useState({
      RemarkMath: null,
      RehypeKatex: null,
      RehypeHighlight: null,
    });

    // Memoize the className to prevent inline object creation
    const markdownClassName = useMemo(
      () => cn('markdown-body dark:text-gray-300', props.className),
      [props.className],
    );

    // Memoize the parsed content
    const parsedContent = useMemo(() => markdownCitationParse(content), [content]);

    const artifactComponents = useMemo(() => {
      // Capture resultId from outer props scope
      const outerResultId = props.resultId;

      return Object.fromEntries(
        markdownElements.map((element) => {
          const Component = element.Component;

          return [
            element.tag,
            (innerProps: any) => <Component {...innerProps} id={outerResultId} mode={mode} />,
          ];
        }),
      );
    }, [props.resultId, mode]);

    // Dynamically import KaTeX CSS
    useEffect(() => {
      import('katex/dist/katex.min.css').then(() => setIsKatexLoaded(true));
    }, []);

    // Dynamically import heavy plugins
    useEffect(() => {
      Promise.all([import('remark-math'), import('rehype-katex'), import('rehype-highlight')]).then(
        ([RemarkMath, RehypeKatex, RehypeHighlight]) => {
          setPlugins({
            RemarkMath: RemarkMath.default,
            RehypeKatex: RehypeKatex.default,
            RehypeHighlight: RehypeHighlight.default,
          });
        },
      );
    }, []);

    return (
      <div className={markdownClassName} ref={mdRef}>
        {props.loading ? (
          <LoadingOutlined />
        ) : (
          <Suspense fallback={<div>{t('common.loading')}</div>}>
            {isKatexLoaded &&
              plugins.RemarkMath &&
              plugins.RehypeKatex &&
              plugins.RehypeHighlight && (
                <ReactMarkdown
                  remarkPlugins={[
                    RemarkBreaks,
                    [
                      remarkGfm,
                      {
                        singleTilde: false, // 禁用单波浪线删除线以减少冲突
                        tablePipeAlign: true, // 保持表格对齐功能
                        tableCellPadding: true, // 保持表格单元格填充
                      },
                    ],
                    plugins.RemarkMath,
                  ]}
                  rehypePlugins={[
                    // Ensure MCPCallElement processes before other plugins that might affect URLs
                    ...rehypePlugins,
                    [
                      plugins.RehypeHighlight,
                      {
                        detect: false,
                        ignoreMissing: true,
                      },
                    ],
                    rehypeHighlight,
                    plugins.RehypeKatex,
                  ]}
                  components={{
                    ...artifactComponents,
                    a: (args) => LinkElement.Component(args, props?.sources || []),
                    img: MarkdownImage,
                    mark: HighlightComponent,
                    del: StrikethroughComponent,
                  }}
                  linkTarget={'_blank'}
                >
                  {parsedContent}
                </ReactMarkdown>
              )}
          </Suspense>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.content === nextProps.content &&
      prevProps.loading === nextProps.loading &&
      prevProps.className === nextProps.className &&
      prevProps.resultId === nextProps.resultId &&
      prevProps.mode === nextProps.mode &&
      JSON.stringify(prevProps.sources) === JSON.stringify(nextProps.sources)
    );
  },
);
