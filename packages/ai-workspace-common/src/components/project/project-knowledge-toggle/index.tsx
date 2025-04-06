import React, { useState } from 'react';
import { Switch, Tooltip, Select, Spin, Avatar } from 'antd';
import { LuBrain, LuCheck } from 'react-icons/lu';
import { FiHelpCircle } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { IconDown, IconProject } from '@refly-packages/ai-workspace-common/components/common/icon';
import { useKnowledgeBaseStoreShallow } from '@refly-packages/ai-workspace-common/stores/knowledge-base';
import { useProjectSelectorStoreShallow } from '@refly-packages/ai-workspace-common/stores/project-selector';
import { useGetProjectCanvasId } from '@refly-packages/ai-workspace-common/hooks/use-get-project-canvasId';
import getClient from '@refly-packages/ai-workspace-common/requests/proxiedRequest';
import { Project } from '@refly/openapi-schema';
import './index.scss';

// Custom styles for switch component
const switchStyles = {
  backgroundColor: '#00968F',
};

interface ProjectKnowledgeToggleProps {
  currentProjectId?: string;
  className?: string;
  projectSelectorClassName?: string;
  enableSelectProject?: boolean;
  onProjectChange?: (projectId: string) => void;
  onSwitchChange?: (checked: boolean) => void;
}

export const ProjectKnowledgeToggle: React.FC<ProjectKnowledgeToggleProps> = ({
  currentProjectId,
  className = '',
  projectSelectorClassName = '',
  enableSelectProject = true,
  onProjectChange,
  onSwitchChange,
}) => {
  const { t } = useTranslation();
  const { projectId: contextProjectId } = useGetProjectCanvasId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  // Knowledge base state
  const { kbEnabled, setKbEnabled } = useKnowledgeBaseStoreShallow((state) => ({
    kbEnabled: state.isKnowledgeBaseEnabled ?? false,
    setKbEnabled: state.updateIsKnowledgeBaseEnabled,
  }));

  // Global project selector state for synchronization
  const { selectedProjectId, setSelectedProjectId } = useProjectSelectorStoreShallow((state) => ({
    selectedProjectId: state.selectedProjectId,
    setSelectedProjectId: state.setSelectedProjectId,
  }));

  // Use provided project ID, selected project ID, or the one from context
  const effectiveProjectId = currentProjectId || selectedProjectId || contextProjectId;

  React.useEffect(() => {
    if (effectiveProjectId && !selectedProjectId) {
      setSelectedProjectId(effectiveProjectId);
    }
  }, [effectiveProjectId, selectedProjectId, setSelectedProjectId]);

  // Fetch project list
  React.useEffect(() => {
    const fetchProjects = async () => {
      setLoading(true);
      try {
        const res = await getClient().listProjects({
          query: { pageSize: 100 },
        });

        if (res?.data?.data) {
          setProjects(res.data.data);

          // Set current project
          const current = res.data.data.find((p) => p.projectId === effectiveProjectId);
          if (current) {
            setCurrentProject(current);
          }
        }
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [effectiveProjectId]);

  const handleProjectChange = async (projectId: string) => {
    if (projectId === effectiveProjectId) return;

    // Update the global selected project ID
    setSelectedProjectId(projectId);

    if (onProjectChange) {
      onProjectChange(projectId);
    }
  };

  return (
    <div className={`project-kb-toggle mt-auto border-t border-gray-100 pt-2 pb-2 ${className}`}>
      <div className="rounded-lg flex items-center justify-between bg-gray-50 p-2 pt-0 pb-0 border border-solid  hover:border-[#00968F]/30 transition-all cursor-pointer">
        <div className="flex items-center gap-2 flex-shrink overflow-hidden">
          <LuBrain
            className={`transition-colors duration-300 flex-shrink-0 ${kbEnabled ? 'text-[#00968F]' : 'text-gray-500'}`}
            size={16}
          />

          {/* Project Selector Dropdown */}
          <Select
            loading={loading}
            className={`project-selector transition-all overflow-hidden ${projectSelectorClassName}`}
            placeholder={t('project.selectProject')}
            value={currentProject?.projectId}
            onChange={handleProjectChange}
            bordered={false}
            dropdownStyle={{ minWidth: '250px' }}
            optionLabelProp="label"
            suffixIcon={!enableSelectProject ? null : <IconDown size={12} />}
            disabled={!enableSelectProject}
            style={{
              padding: 0,
            }}
            dropdownRender={(menu) => (
              <div className="rounded-md overflow-hidden shadow-lg">
                <div className="px-3 py-2 text-xs text-gray-600 border-b border-gray-100 bg-gray-50">
                  {t('project.switchProject')}
                </div>
                {loading ? (
                  <div className="flex justify-center items-center py-4">
                    <Spin size="small" />
                  </div>
                ) : (
                  menu
                )}
              </div>
            )}
          >
            {projects.map((project) => (
              <Select.Option
                key={project.projectId}
                value={project.projectId}
                label={
                  <span className="text-sm text-gray-600 truncate inline-block">
                    {project.name || t('common.untitled')}
                  </span>
                }
              >
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    {project.coverUrl ? (
                      <Avatar size={20} src={project.coverUrl} className="flex-shrink-0" />
                    ) : (
                      <IconProject size={20} className="text-gray-500 flex-shrink-0" />
                    )}
                    <span className="truncate max-w-[150px] text-sm">
                      {project.name || t('common.untitled')}
                    </span>
                  </div>
                  {project.projectId === effectiveProjectId && (
                    <LuCheck className="text-[#00968F]" size={16} />
                  )}
                </div>
              </Select.Option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-1">
          <Switch
            size="small"
            checked={kbEnabled}
            onChange={(checked) => {
              setKbEnabled(checked);
              if (onSwitchChange) {
                onSwitchChange(checked);
              }
            }}
            className="shadow-sm"
            style={{ ...(kbEnabled ? switchStyles : {}) }}
          />
          <Tooltip
            title={
              <div className="p-1 max-w-xs">
                <div className="font-medium mb-1 text-[#00968F]">Knowledge Base</div>
                <div className="text-xs text-gray-400">
                  When enabled, your external knowledge base will be used in chat mode.
                  <br />
                  <span className="mt-1 block">
                    Seed selection mode is now set to "Off", your external knowledge base will not
                    be used.
                  </span>
                </div>
              </div>
            }
            open={tooltipVisible}
            onOpenChange={setTooltipVisible}
            placement="top"
            overlayInnerStyle={{ padding: '8px', borderRadius: '6px' }}
          >
            <div className="cursor-pointer flex items-center">
              <FiHelpCircle
                className="text-gray-400 hover:text-gray-600 transition-colors"
                size={16}
              />
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
