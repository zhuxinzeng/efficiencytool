// 紧凑壳（H5 / 侧边栏 / popup）：卡片首页 → 工具详情，无左侧菜单
// 全屏带左侧菜单请用 full.tsx；本壳右上角可跳到全屏窗口
import { useEffect, useState, type CSSProperties } from 'react';
import { Avatar, Button, Card, Space, Typography } from 'antd';
import { ArrowLeftOutlined, ExpandOutlined } from '@ant-design/icons';
import { TOOL_GROUPS, ALL_TOOLS, type ToolMeta } from './registry';
import { openResizableWindow, openSidePanel } from './open-full';

const { Title, Text } = Typography;

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  background: 'linear-gradient(135deg, #1677ff, #722ed1)',
  color: '#fff',
  flex: 'none',
};

function LogoIcon() {
  return (
    <svg viewBox="0 0 128 128" width="22" height="22" aria-hidden>
      <path fill="#fff" d="M73.5 14 38 70h21l-7.5 44L92 56H68l14-42z" />
    </svg>
  );
}

function ToolCard({ tool, onOpen }: { tool: ToolMeta; onOpen: () => void }) {
  return (
    <Card
      size="small"
      hoverable
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      styles={{ body: { padding: '12px 10px' } }}
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space size={8}>
          <Avatar size="small" style={{ background: 'linear-gradient(135deg, #1677ff, #722ed1)' }} icon={tool.icon} />
          <Text strong>{tool.title}</Text>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>{tool.subtitle}</Text>
      </Space>
    </Card>
  );
}

function readHashToolId(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return ALL_TOOLS.some((t) => t.id === hash) ? hash : null;
}

export type CompactVariant = 'popup' | 'sidepanel';
export type ExpandMode = 'sidepanel' | 'window';

export interface CompactShellProps {
  /** popup：固定宽；sidepanel：随侧边栏宽度铺满，无左侧菜单 */
  variant?: CompactVariant;
  /** 右上角展开：打开侧边栏，或打开带左侧菜单的全屏窗口 */
  expandMode?: ExpandMode;
}

export function CompactShell({
  variant = 'popup',
  expandMode = 'window',
}: CompactShellProps) {
  // sidepanel 支持 hash 直达某工具；popup 仅内存态
  const [activeId, setActiveId] = useState<string | null>(() =>
    (variant === 'sidepanel' ? readHashToolId() : null),
  );

  useEffect(() => {
    if (variant !== 'sidepanel') return;
    const onHash = () => setActiveId(readHashToolId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [variant]);

  const openTool = (id: string) => {
    setActiveId(id);
    if (variant === 'sidepanel') window.location.hash = id;
  };

  const backHome = () => {
    setActiveId(null);
    if (variant === 'sidepanel') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  const onExpand = () => {
    if (expandMode === 'sidepanel') {
      void openSidePanel();
      return;
    }
    // 全屏窗口：带左侧菜单栏
    openResizableWindow(activeId ?? undefined);
  };

  const rootClass = variant === 'sidepanel' ? 'sidepanel-root' : 'popup-root';
  const tool = ALL_TOOLS.find((t) => t.id === activeId);

  if (!tool) {
    return (
      <div className={rootClass}>
        <header style={headerStyle}>
          <LogoIcon />
          <Title level={5} style={{ color: '#fff', margin: 0, flex: 1 }}>效率工具箱</Title>
          <Button
            type="text"
            size="small"
            style={{ color: '#fff' }}
            icon={<ExpandOutlined />}
            onClick={onExpand}
            title={expandMode === 'window' ? '打开全屏（含左侧菜单）' : '打开侧边栏'}
          />
        </header>
        <main className="popup-body">
          {TOOL_GROUPS.map((group) => (
            <section key={group.id}>
              <div className="tool-group-title">{group.title}</div>
              <div className="tool-grid">
                {group.tools.map((t) => (
                  <ToolCard key={t.id} tool={t} onOpen={() => openTool(t.id)} />
                ))}
              </div>
            </section>
          ))}
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12, textAlign: 'center' }}>
            {variant === 'sidepanel'
              ? '侧边栏独立于页面：跨域名跳转仍可继续录制；无左侧菜单，点右上角打开全屏后显示左侧菜单'
              : '点右上角可打开全屏工具台（含左侧菜单）'}
          </Text>
        </main>
      </div>
    );
  }

  const ToolComponent = tool.component;
  return (
    <div className={rootClass}>
      <header style={headerStyle}>
        <Button type="text" size="small" style={{ color: '#fff' }} icon={<ArrowLeftOutlined />} onClick={backHome} />
        <Title level={5} style={{ color: '#fff', margin: 0, flex: 1 }}>{tool.title}</Title>
        <Button
          type="text"
          size="small"
          style={{ color: '#fff' }}
          icon={<ExpandOutlined />}
          onClick={onExpand}
          title={expandMode === 'window' ? '打开全屏（含左侧菜单）' : '打开侧边栏'}
        />
      </header>
      <main className="popup-body">
        <ToolComponent />
      </main>
    </div>
  );
}
