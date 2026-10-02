// 全屏壳：带左侧菜单栏；仅独立窗口 / 新标签页使用
// 侧边栏（H5 紧凑、无左侧菜单）请用 sidepanel.tsx
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Card, Layout, Menu, Space, Tag, Tooltip, Typography } from 'antd';
import { ExpandOutlined } from '@ant-design/icons';
import { TOOL_GROUPS, ALL_TOOLS } from './shared/registry';
import { ThemeProvider } from './shared/theme';
import { openResizableWindow } from './shared/open-full';
import './styles/app.css';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

function readHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return ALL_TOOLS.some((t) => t.id === hash) ? hash : ALL_TOOLS[0].id;
}

function FullApp() {
  const [activeId, setActiveId] = useState(readHash);

  useEffect(() => {
    const onHashChange = () => setActiveId(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const tool = ALL_TOOLS.find((t) => t.id === activeId) ?? ALL_TOOLS[0];
  const ToolComponent = tool.component;

  const handleSelect = ({ key }: { key: string }) => {
    setActiveId(key);
    window.location.hash = key;
  };

  return (
    <Layout className="full-root">
      <Sider
        width={216}
        theme="light"
        // 全屏固定展示左侧菜单，不折叠成汉堡按钮（侧边栏 H5 壳另有入口）
        collapsible={false}
        style={{
          borderRight: '1px solid rgba(5,5,5,0.06)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            height: 56,
            flex: 'none',
          }}
        >
          <svg viewBox="0 0 128 128" width="24" height="24" aria-hidden>
            <defs>
              <linearGradient id="logo" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#1677ff" />
                <stop offset="1" stopColor="#722ed1" />
              </linearGradient>
            </defs>
            <rect width="128" height="128" rx="28" fill="url(#logo)" />
            <path fill="#fff" d="M73.5 14 38 70h21l-7.5 44L92 56H68l14-42z" />
          </svg>
          <Text strong>效率工具箱</Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[tool.id]}
          onSelect={handleSelect}
          items={TOOL_GROUPS.map((group) => ({
            type: 'group' as const,
            label: group.title,
            children: group.tools.map((t) => ({ key: t.id, icon: t.icon, label: t.title })),
          }))}
          style={{ borderInlineEnd: 'none', flex: 1, overflowY: 'auto', minHeight: 0 }}
        />
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid rgba(5,5,5,0.06)', flex: 'none' }}>
          <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.5 }}>
            全屏模式：左侧菜单常驻。侧边栏紧凑入口无此菜单。
          </Text>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: 'linear-gradient(135deg, #1677ff, #722ed1)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px 0 24px',
            gap: 8,
          }}
        >
          <h1 className="full-header-title" style={{ flex: 1, minWidth: 0 }}>
            {tool.title}
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 400, fontSize: 13 }}>{tool.subtitle}</Text>
          </h1>
          <Tooltip title="再开一个独立窗口">
            <Button
              type="text"
              size="small"
              style={{ color: '#fff' }}
              icon={<ExpandOutlined />}
              onClick={() => openResizableWindow(tool.id)}
            />
          </Tooltip>
        </Header>
        <Content className={`full-content${tool.wide ? ' is-wide' : ''}`}>
          <Card className={tool.wide ? 'full-card-fill' : undefined}>
            <ToolComponent />
          </Card>
          {tool.tags?.length ? (
            <Space style={{ marginTop: 16 }}>
              {tool.tags.map((tag) => (
                <Tag key={tag} color={tag.startsWith('GB') ? 'blue' : undefined}>
                  {tag}
                </Tag>
              ))}
            </Space>
          ) : null}
        </Content>
      </Layout>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <FullApp />
  </ThemeProvider>,
);
