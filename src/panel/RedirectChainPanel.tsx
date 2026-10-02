// 重定向链查看器：可视化 301/302 跳转链，逐步对比 query 参数丢失/新增/变化（排查丢参数）
import { useMemo, useState } from 'react';
import { Button, Empty, Steps, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useHar } from './useHar';
import { buildRedirectChains, diffQuery, type RedirectChain } from '../utils/har';

const { Text, Paragraph } = Typography;

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname : '';
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

function DiffTags({ chain, stepUrl }: { chain: RedirectChain; stepUrl: string }) {
  // 与链起点对比（累计视角），排查「跳转后丢了哪个参数」最直观
  const start = chain.steps[0]?.url;
  if (!start) return null;
  const diff = diffQuery(start, stepUrl);
  const tags: React.ReactNode[] = [];
  diff.lost.forEach((k) => tags.push(<Tag key={`lost-${k}`} color="red">丢失 {k}</Tag>));
  diff.gained.forEach((k) => tags.push(<Tag key={`gain-${k}`} color="green">新增 {k}</Tag>));
  diff.changed.forEach((k) => tags.push(<Tag key={`chg-${k}`} color="orange">变化 {k}</Tag>));
  if (tags.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>与起点参数一致</Text>;
  return <span>{tags}</span>;
}

export function RedirectChainPanel() {
  const { entries, loading, refresh, supported } = useHar();
  const [expanded, setExpanded] = useState<number>(0);

  const chains = useMemo(() => buildRedirectChains(entries), [entries]);

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 8 }}>
        自动梳理 DevTools 打开期间捕获的 301/302/303/307/308 跳转链；逐步展示跳转 URL 与较起点丢失/新增/变化的 query 参数，便于排查「跳转丢参数」。
      </Paragraph>

      <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} style={{ marginBottom: 12 }}>刷新</Button>

      {chains.length === 0 ? (
        <Empty description={supported ? '暂未捕获到重定向请求（在页面触发跳转后出现）' : '非 DevTools 环境'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        chains.map((chain, index) => (
          <div key={index} style={{ border: '1px solid rgba(5,5,5,0.08)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">{chain.redirects} 次重定向</Tag>
              <Text strong>{shortUrl(chain.steps[0]?.url ?? '')}</Text>
              <Text type="secondary"> → </Text>
              <Text strong>{shortUrl(chain.steps[chain.steps.length - 1]?.url ?? '')}</Text>
              <Button type="link" size="small" onClick={() => setExpanded(expanded === index ? -1 : index)}>
                {expanded === index ? '收起' : '展开'}
              </Button>
            </div>
            {expanded === index && (
              <Steps
                direction="vertical"
                size="small"
                items={chain.steps.map((step, i) => ({
                  title: (
                    <span>
                      <Tag color={step.status >= 300 && step.status < 400 ? 'blue' : step.status >= 400 ? 'orange' : 'green'}>
                        {step.status}
                      </Tag>
                      <Text strong>{step.method}</Text>
                    </span>
                  ),
                  description: (
                    <div style={{ wordBreak: 'break-all' }}>
                      <Text code style={{ fontSize: 12 }}>{step.url}</Text>
                      {step.location && i < chain.steps.length - 1 && (
                        <div><Text type="secondary" style={{ fontSize: 12 }}>Location → {step.location}</Text></div>
                      )}
                      {i > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <DiffTags chain={chain} stepUrl={step.url} />
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        ))
      )}
    </div>
  );
}
