import { Divider, Modal, Menu } from '@arco-design/web-react';
import { IconImport, IconLink, IconPen } from '@arco-design/web-react/icon';
import { useImportResourceStore } from '@refly-packages/ai-workspace-common/stores/import-resource';

// 组件
import { ImportFromWeblink } from './intergrations/import-from-weblink';

// 样式
import './index.scss';
import { useState } from 'react';

const MenuItem = Menu.Item;

export const ImportResourceModal = () => {
  const importResourceStore = useImportResourceStore();
  const [selectedMenuItem, setSelectedMenuItem] = useState('import-from-weblink');

  return (
    <Modal
      visible={importResourceStore.importResourceModalVisible}
      footer={null}
      onCancel={() => {
        importResourceStore.setImportResourceModalVisible(false);
      }}
      className="import-resource-modal"
      style={{ width: '60%', height: 'calc(100% - 240px)', minWidth: 1000 }}
    >
      <div className="import-resource-container">
        <div className="import-resource-left-panel">
          <div className="left-panel-header">
            <div className="left-panel-header-title">
              <IconImport />
              <span className="left-panel-header-title-text">资源集成</span>
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <Menu
              className="left-panel-menu"
              selectedKeys={[selectedMenuItem]}
              onClickMenuItem={(key) => {
                setSelectedMenuItem(key);
              }}
            >
              <h2 className="left-panel-menu-title">集成</h2>
              <MenuItem key="import-from-weblink" className="left-panel-menu-item">
                <span className="menu-item-icon">
                  <IconLink />
                </span>
                网页链接
              </MenuItem>
              <MenuItem key="import-from-paste-text" className="left-panel-menu-item">
                <span className="menu-item-icon">
                  <IconPen />
                </span>
                复制文本
              </MenuItem>
            </Menu>
          </div>
        </div>
        <div className="import-resource-right-panel">
          {selectedMenuItem === 'import-from-weblink' ? <ImportFromWeblink /> : null}
        </div>
      </div>
    </Modal>
  );
};
