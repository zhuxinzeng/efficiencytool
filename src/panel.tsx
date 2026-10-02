// DevTools 面板壳：请求重放 / GraphQL 调试 / 重定向链 三个标签页
import { createRoot } from 'react-dom/client';
import { Alert, Tabs } from 'antd';
import { ExperimentOutlined, LinkOutlined, RocketOutlined } from '@ant-design/icons';
import { ThemeProvider } from './shared/theme';
import { HarProvider, useHar } from './panel/useHar';
import { RequestReplayPanel } from './panel/RequestReplay';
import { GraphqlPanel } from './panel/GraphqlPanel';
import { RedirectChainPanel } from './panel/RedirectChainPanel';
import './styles/app.css';

function PanelApp() {
  const { supported } = useHar();

  return (
    <div style={{ padding: 12 }}>
      {!supported && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="当前非 DevTools 扩展环境"
          description="请求列表仅在 Chrome DevTools 的「效率工具箱」面板中可用，仅加载扩展后打开 F12 查看。"
        />
      )}
      <Tabs
        items={[
          { key: 'replay', label: '请求重放', icon: <RocketOutlined />, children: <RequestReplayPanel /> },
          { key: 'graphql', label: 'GraphQL 调试', icon: <ExperimentOutlined />, children: <GraphqlPanel /> },
          { key: 'redirect', label: '重定向链', icon: <LinkOutlined />, children: <RedirectChainPanel /> },
        ]}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <HarProvider>
      <PanelApp />
    </HarProvider>
  </ThemeProvider>,
);
