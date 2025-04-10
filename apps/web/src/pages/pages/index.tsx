import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Spin, message, Modal, Select } from 'antd';
import {
  useGetPageDetail,
  useUpdatePage,
  useDeletePageNode,
  useSharePage,
} from '@refly-packages/ai-workspace-common/queries/queries';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  ShareAltOutlined,
  CopyOutlined,
  GlobalOutlined,
  UserOutlined,
  PlayCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useSiderStoreShallow } from '@refly-packages/ai-workspace-common/stores/sider';
import { NodeRenderer } from './components/NodeRenderer';
import { type NodeRelation } from './components/ArtifactRenderer';
import './styles/preview-mode.css';

// 导入抽象的组件和 hooks
import PageLayout from './components/PageLayout';
import PreviewMode from './components/PreviewMode';
import { usePreviewUI } from './hooks/usePreviewUI';
import { useSlideshow } from './hooks/useSlideshow';
import { getNodeTitle } from './utils/nodeUtils';

// 懒加载虚拟列表组件
const VirtualizedNodeList = lazy(() => import('./components/VirtualizedNodeList'));

interface PageDetailType {
  title: string;
  description?: string;
  nodeRelations?: NodeRelation[];
}

function PageEdit() {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [formChanged, setFormChanged] = useState(false);
  const [activeNodeIndex, setActiveNodeIndex] = useState(0);
  const [nodesList, setNodes] = useState<NodeRelation[]>([]);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [_isDeletingNode, setIsDeletingNode] = useState(false);
  const [wideMode, setWideMode] = useState<{ isActive: boolean; nodeId: string | null }>({
    isActive: false,
    nodeId: null,
  });

  // 分享相关状态
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareOption, setShareOption] = useState<'internet' | '未开启'>('internet');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // 获取侧边栏状态
  const { collapse, setCollapse } = useSiderStoreShallow((state) => ({
    collapse: state.collapse,
    setCollapse: state.setCollapse,
  }));

  // 强制默认隐藏侧边栏
  useEffect(() => {
    setCollapse(true);
  }, [setCollapse]);

  // 使用抽象的 UI 状态管理 hook
  const {
    uiState,
    showPreviewMinimap,
    handleUiInteraction,
    handlePreviewMouseMove,
    handleMinimapMouseEnter,
    handleMinimapMouseLeave,
    handleSideHintClick,
  } = usePreviewUI({ isPreviewMode });

  // 使用抽象的幻灯片预览 hook
  const {
    currentSlideIndex,
    nextSlide,
    prevSlide,
    handlePreviewSlideSelect,
    previewContentRef,
    resetSlideIndex,
    setCurrentSlideIndex, // Add this line
  } = useSlideshow({
    nodes: nodesList,
    isPreviewMode,
    handleUiInteraction,
  });

  // UI 交互处理方法
  const toggleSidebar = useCallback(() => setCollapse(!collapse), [collapse, setCollapse]);

  const toggleMinimap = useCallback(() => setShowMinimap(!showMinimap), [showMinimap]);

  const togglePreviewMode = useCallback(() => {
    setIsPreviewMode(!isPreviewMode);
    if (!isPreviewMode) {
      resetSlideIndex();
    }
  }, [isPreviewMode, resetSlideIndex]);

  // 获取页面详情
  const {
    data: pageDetailResponse,
    isLoading: isLoadingPage,
    error: pageLoadError,
  } = useGetPageDetail({ path: { pageId: pageId || '' } }, undefined, {
    enabled: !!pageId,
  });

  // 更新页面Hook
  const { mutate: updatePage, isPending: isUpdating } = useUpdatePage();

  // 分享页面Hook
  const { mutate: sharePage } = useSharePage();

  // 从响应中提取页面数据
  const pageDetail = pageDetailResponse?.data as PageDetailType | undefined;

  // 获取节点数据
  const nodes = useMemo<NodeRelation[]>(() => {
    if (!pageDetail?.nodeRelations) return [];

    // 注: 原本有过滤逻辑，但实际上不过滤任何内容 (node.nodeType === "codeArtifact" || 1)
    return pageDetail.nodeRelations.map((node) => ({
      ...node,
    }));
  }, [pageDetail]);

  // 当页面数据加载完成后，更新本地状态
  useEffect(() => {
    if (pageDetail) {
      form.setFieldsValue({
        title: pageDetail.title,
        description: pageDetail.description,
      });
      setNodes(nodes);
      setFormChanged(false);
    }
  }, [form, pageDetail, nodes]);

  // 提交表单处理函数
  const handleSubmit = (values: any) => {
    if (!pageId) return;

    const updateData = {
      path: { pageId },
      body: {
        title: values.title,
        description: values.description,
      } as any,
    };

    // 如果有节点数据，仅更新节点顺序
    if (nodesList.length > 0) {
      updateData.body.nodeRelationOrders = nodesList.map((node: NodeRelation, index: number) => ({
        relationId: node.relationId,
        orderIndex: index,
      }));
    }

    updatePage(updateData, {
      onSuccess: () => {
        message.success('页面更新成功');
        setFormChanged(false);
      },
      onError: (error) => {
        console.error('更新页面失败:', error);
        message.error('保存失败，请稍后重试');
      },
    });
  };

  // 表单与导航处理
  const handleBack = () => navigate('/pages');
  const handleFormChange = () => setFormChanged(true);

  // 处理节点选择
  const handleNodeSelect = (index: number) => {
    setActiveNodeIndex(index);

    // 滚动到对应的内容块
    const element = document.getElementById(`content-block-${index}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // 处理节点重新排序
  const handleReorderNodes = (newOrder: NodeRelation[]) => {
    setNodes(
      newOrder.map((node, index) => ({
        ...node,
        orderIndex: index,
      })),
    );
    setFormChanged(true);
  };

  // 处理删除节点
  const deletePageNodeMutation = useDeletePageNode();

  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!pageId) return;

      try {
        setIsDeletingNode(true);

        // 使用 useDeletePageNode 删除节点
        await deletePageNodeMutation.mutateAsync({
          path: {
            pageId,
            nodeId,
          },
        });

        // 从本地状态中移除节点
        setNodes((prevNodes) => prevNodes.filter((node) => node.nodeId !== nodeId));

        // 如果删除的是当前选中的节点，选择第一个节点
        if (nodesList[activeNodeIndex]?.nodeId === nodeId) {
          setActiveNodeIndex(0);
        }

        message.success('节点删除成功');
        setFormChanged(true);
      } catch (error) {
        console.error('删除节点失败:', error);
        message.error('删除节点失败，请重试');
      } finally {
        setIsDeletingNode(false);
      }
    },
    [pageId, activeNodeIndex, nodesList, deletePageNodeMutation],
  );

  // 处理从指定节点开始幻灯片预览
  const handleStartSlideshow = useCallback(
    (nodeId: string) => {
      // 查找点击的节点索引
      const nodeIndex = nodesList.findIndex((node) => node.nodeId === nodeId);
      if (nodeIndex !== -1) {
        // 设置当前幻灯片索引为找到的节点索引
        setCurrentSlideIndex(nodeIndex); // Use setCurrentSlideIndex here
        // 打开预览模式
        setIsPreviewMode(true);
      }
    },
    [nodesList, setCurrentSlideIndex],
  );

  // 宽屏模式处理
  const handleWideMode = useCallback(
    (nodeId: string) => {
      const node = nodesList.find((n) => n.nodeId === nodeId);
      if (node) {
        setWideMode({ isActive: true, nodeId });
      }
    },
    [nodesList],
  );

  // 关闭宽屏模式
  const handleCloseWideMode = useCallback(() => {
    setWideMode({ isActive: false, nodeId: null });
  }, []);

  // 宽屏模式键盘快捷键
  useEffect(() => {
    if (!wideMode.isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseWideMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wideMode.isActive, handleCloseWideMode]);

  // 处理分享页面
  const handleShare = () => {
    setShareModalVisible(true);
  };

  // 执行分享操作
  const handleShareSubmit = () => {
    if (!pageId) return;

    setIsSharing(true);

    sharePage(
      { path: { pageId } },
      {
        onSuccess: (response) => {
          if (!response?.data?.data?.shareUrl) {
            console.error('分享链接获取失败', response);
            message.error('分享失败，无法获取链接');
            setIsSharing(false);
            return;
          }

          const shareLink = response.data.data.shareUrl;
          setShareUrl(shareLink);
          setIsSharing(false);

          // 自动复制分享链接到剪贴板
          navigator.clipboard
            .writeText(shareLink)
            .then(() => {
              setIsCopied(true);
              message.success('链接已复制到剪贴板');
              setTimeout(() => setIsCopied(false), 3000);
            })
            .catch(() => message.warning('分享成功，请手动复制链接'));
        },
        onError: () => {
          setIsSharing(false);
          message.error('分享失败，请稍后重试');
        },
      },
    );
  };

  // 复制分享链接
  const handleCopyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          setIsCopied(true);
          message.success('链接已复制到剪贴板');
          setTimeout(() => setIsCopied(false), 3000);
        })
        .catch(() => message.warning('分享成功，请手动复制链接'));
    }
  };

  // 关闭分享弹窗
  const handleCloseShareModal = () => {
    setShareModalVisible(false);
  };

  // 渲染页面内容
  const renderPageContent = useMemo(() => {
    if (isLoadingPage) {
      return (
        <div className="flex items-center justify-center py-20">
          <Spin size="large" tip="加载中..." />
        </div>
      );
    }

    if (pageLoadError) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <FileTextOutlined className="text-4xl text-red-500 mb-4" />
          <p className="text-lg text-gray-700 mb-2">加载页面失败</p>
          <p className="text-sm text-gray-500 mb-4">请检查网络连接或稍后再试</p>
          <Button type="primary" onClick={() => navigate('/pages/list')}>
            返回列表
          </Button>
        </div>
      );
    }

    if (!pageDetail) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <FileTextOutlined className="text-4xl text-gray-400 mb-4" />
          <p className="text-lg text-gray-700 mb-2">页面不存在</p>
          <p className="text-sm text-gray-500 mb-4">请检查URL或返回页面列表</p>
          <Button type="primary" onClick={() => navigate('/pages/list')}>
            返回列表
          </Button>
        </div>
      );
    }

    if (isPreviewMode) {
      return (
        <PreviewMode
          nodes={nodesList}
          currentIndex={currentSlideIndex}
          onNext={nextSlide}
          onPrev={prevSlide}
          onClose={togglePreviewMode}
          onMouseMove={handlePreviewMouseMove}
          showUI={uiState.showUI}
          showMinimap={showPreviewMinimap}
          onMinimapMouseEnter={handleMinimapMouseEnter}
          onMinimapMouseLeave={handleMinimapMouseLeave}
          onSlideSelect={handlePreviewSlideSelect}
          onSideHintClick={handleSideHintClick}
          contentRef={previewContentRef}
        />
      );
    }

    return (
      <div>
        {/* 内容部分 - 使用虚拟列表优化渲染 */}
        {nodesList.length > 0 ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <Spin tip="加载中..." />
              </div>
            }
          >
            <VirtualizedNodeList
              nodes={nodesList}
              activeNodeIndex={activeNodeIndex}
              onNodeSelect={handleNodeSelect}
              onDelete={handleDeleteNode}
              onStartSlideshow={handleStartSlideshow}
              onWideMode={handleWideMode}
            />
          </Suspense>
        ) : (
          <div className="text-center py-16 bg-white rounded-lg border border-dashed border-gray-300 shadow-sm">
            <FileTextOutlined className="text-5xl text-gray-300 mb-4" />
            <h3 className="text-xl text-gray-500 mb-2">暂无内容</h3>
            <p className="text-gray-400 mb-6">您可以添加新的内容组件</p>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => message.info('添加新组件功能开发中')}
            >
              添加组件
            </Button>
          </div>
        )}

        {/* 预览按钮 */}
        {nodesList.length > 0 && (
          <div className="fixed bottom-6 right-6 z-10">
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<PlayCircleOutlined />}
              onClick={togglePreviewMode}
              className="shadow-lg bg-blue-600 hover:bg-blue-700 border-none"
              title="幻灯片预览"
            />
          </div>
        )}
      </div>
    );
  }, [
    isLoadingPage,
    pageLoadError,
    pageDetail,
    isPreviewMode,
    nodesList,
    currentSlideIndex,
    nextSlide,
    prevSlide,
    togglePreviewMode,
    handlePreviewMouseMove,
    uiState.showUI,
    showPreviewMinimap,
    handleMinimapMouseEnter,
    handleMinimapMouseLeave,
    handlePreviewSlideSelect,
    handleSideHintClick,
    previewContentRef,
    form,
    handleSubmit,
    handleFormChange,
    handleBack,
    handleShare,
    isUpdating,
    activeNodeIndex,
    handleNodeSelect,
    handleDeleteNode,
    handleStartSlideshow,
    handleWideMode,
    navigate,
  ]);

  // 加载状态
  if (isLoadingPage) {
    return (
      <div className="flex justify-center items-center h-[70vh]">
        <Spin size="large" tip="加载页面中..." />
      </div>
    );
  }

  // 错误状态
  if (pageLoadError || !pageDetail) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="text-red-500 mb-4">无法加载页面信息</p>
          <Button onClick={handleBack} icon={<ArrowLeftOutlined />}>
            返回列表
          </Button>
        </div>
      </div>
    );
  }

  // 预览模式渲染
  if (isPreviewMode) {
    return (
      <Modal
        open={isPreviewMode}
        footer={null}
        closable={false}
        onCancel={togglePreviewMode}
        width="100%"
        style={{ top: 0, padding: 0, maxWidth: '100vw' }}
        bodyStyle={{ height: '100vh', padding: 0, overflow: 'hidden' }}
        className="preview-modal"
        maskStyle={{ background: 'rgba(0, 0, 0, 0.85)' }}
        wrapClassName="preview-modal-wrap"
      >
        <div className="bg-black h-full w-full flex flex-col">
          {/* 使用抽象的 PreviewMode 组件 */}
          <PreviewMode
            nodes={nodesList}
            currentSlideIndex={currentSlideIndex}
            showPreviewMinimap={showPreviewMinimap}
            uiState={uiState}
            title={form.getFieldValue('title')}
            onNext={nextSlide}
            onPrev={prevSlide}
            onClose={togglePreviewMode}
            onMouseMove={handlePreviewMouseMove}
            onSideHintClick={handleSideHintClick}
            onUiInteraction={handleUiInteraction}
            onPreviewSlideSelect={handlePreviewSlideSelect}
            onMinimapMouseEnter={handleMinimapMouseEnter}
            onMinimapMouseLeave={handleMinimapMouseLeave}
            getNodeTitle={getNodeTitle}
            previewContentRef={previewContentRef}
          />
        </div>
      </Modal>
    );
  }

  return (
    <PageLayout
      showMinimap={showMinimap}
      collapse={collapse}
      nodes={nodesList}
      activeNodeIndex={activeNodeIndex}
      onNodeSelect={handleNodeSelect}
      onReorderNodes={handleReorderNodes}
      toggleMinimap={toggleMinimap}
      toggleSidebar={toggleSidebar}
      headerContent={
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center">
            <Button
              onClick={handleBack}
              icon={<ArrowLeftOutlined />}
              type="text"
              className="mr-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            />
            <Form
              form={form}
              layout="inline"
              onFinish={handleSubmit}
              onValuesChange={handleFormChange}
              initialValues={{
                title: pageDetail.title,
                description: pageDetail.description,
              }}
              className="flex items-center"
            >
              <Form.Item
                name="title"
                rules={[{ required: true, message: '请输入页面标题' }]}
                className="mb-0"
              >
                <Input
                  placeholder="请输入页面标题"
                  bordered={false}
                  className="text-lg font-medium px-0"
                />
              </Form.Item>
            </Form>
          </div>

          <div className="flex items-center">
            {nodesList.length > 0 && (
              <Button
                type="text"
                onClick={togglePreviewMode}
                icon={<PlayCircleOutlined />}
                className="flex items-center mx-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              >
                幻灯片预览
              </Button>
            )}
            <Button
              type="text"
              onClick={handleShare}
              icon={<ShareAltOutlined />}
              className="flex items-center mx-2 text-green-600 hover:text-green-700 hover:bg-green-50"
            >
              复制分享链接
            </Button>
            {formChanged && (
              <Button
                type="primary"
                htmlType="submit"
                onClick={() => form.submit()}
                loading={isUpdating}
                icon={<SaveOutlined />}
                className="flex items-center bg-blue-600 hover:bg-blue-700 border-none"
              >
                保存更改
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* 页面描述区域 */}
      <div className="mb-6">
        <Form form={form} onFinish={handleSubmit} onValuesChange={handleFormChange}>
          <Form.Item name="description">
            <Input.TextArea
              placeholder="添加页面描述..."
              autoSize={{ minRows: 2, maxRows: 4 }}
              bordered={false}
              className="text-gray-700 text-base resize-none bg-transparent"
            />
          </Form.Item>
        </Form>
      </div>

      {/* 内容模块 */}
      {renderPageContent}

      {/* 宽屏模式弹窗 */}
      <Modal
        open={wideMode.isActive}
        footer={null}
        onCancel={handleCloseWideMode}
        width="85%"
        style={{ top: 20 }}
        bodyStyle={{
          maxHeight: 'calc(100vh - 100px)',
          padding: 0,
          overflow: 'hidden',
        }}
        className="wide-mode-modal"
        closeIcon={<CloseCircleOutlined className="text-gray-500 hover:text-red-500" />}
        maskStyle={{ background: 'rgba(0, 0, 0, 0.65)' }}
      >
        <div className="bg-white h-full w-full flex flex-col rounded-lg overflow-hidden">
          {/* 宽屏模式内容 */}
          <div className="flex-1 overflow-auto">
            {wideMode.nodeId && nodesList.find((n) => n.nodeId === wideMode.nodeId) ? (
              <div className="h-[calc(100vh-160px)]">
                <NodeRenderer
                  node={nodesList.find((n) => n.nodeId === wideMode.nodeId)!}
                  isFullscreen={false}
                  isModal={true}
                  isMinimap={false}
                  onDelete={handleDeleteNode}
                  onStartSlideshow={handleStartSlideshow}
                  onWideMode={handleWideMode}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">无法加载内容</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 分享弹窗 */}
      <Modal
        title={
          <div className="flex items-center text-lg font-medium">
            <ShareAltOutlined className="mr-2 text-green-500" /> 链接分享
          </div>
        }
        open={shareModalVisible}
        onCancel={handleCloseShareModal}
        footer={null}
        width={420}
        className="share-modal"
        maskClosable={false}
      >
        <div className="py-2">
          <div className="mb-4">
            <div className="text-gray-700 mb-2">谁可以查看此页面</div>
            <Select
              value={shareOption}
              onChange={(value) => setShareOption(value)}
              style={{ width: '100%' }}
              options={[
                {
                  value: 'internet',
                  label: (
                    <div className="flex items-center">
                      <GlobalOutlined className="mr-2 text-green-500" />
                      互联网获得链接的人
                    </div>
                  ),
                },
                {
                  value: '未开启',
                  label: (
                    <div className="flex items-center">
                      <UserOutlined className="mr-2 text-gray-500" />
                      未开启
                    </div>
                  ),
                  disabled: true,
                },
              ]}
            />
          </div>

          {!shareUrl ? (
            <Button
              type="primary"
              block
              icon={<ShareAltOutlined />}
              onClick={handleShareSubmit}
              loading={isSharing}
              className="bg-green-600 hover:bg-green-700 border-none mt-2"
            >
              复制分享链接
            </Button>
          ) : (
            <div className="mt-4">
              <div className="text-gray-700 mb-2">分享链接</div>
              <div className="flex items-center">
                <Input value={shareUrl} readOnly className="flex-1 bg-gray-50" />
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={handleCopyShareUrl}
                  className={`ml-2 flex items-center justify-center h-[32px] ${
                    isCopied ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                  } border-none`}
                >
                  {isCopied ? '已复制' : '复制'}
                </Button>
              </div>
              <div className="mt-4 text-gray-500 text-sm">获得此链接的人均可查看此页面内容</div>
            </div>
          )}
        </div>
      </Modal>
    </PageLayout>
  );
}

export default PageEdit;
