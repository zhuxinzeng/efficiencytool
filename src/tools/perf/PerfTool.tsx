// 页面性能分析：采集当前标签页 Core Web Vitals / 资源 / 长任务，并给出优化建议
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert, App, Button, Card, Col, Empty, Progress, Row, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CopyOutlined, DownloadOutlined, QuestionCircleOutlined, ReloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { perfSnapshot } from '../../shared/perf-client';
import type {
  PerfMetric, PerfRating, PerfResourceRow, PerfSeverity, PerfSnapshot, PerfTypeAgg,
} from '../../shared/perf-protocol';

const { Paragraph, Text, Title } = Typography;

function formatMs(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function ratingColor(r: PerfRating): string {
  if (r === 'good') return '#52c41a';
  if (r === 'needs-improvement') return '#faad14';
  if (r === 'poor') return '#ff4d4f';
  return '#8c8c8c';
}

function ratingTag(r: PerfRating): ReactNode {
  const map: Record<PerfRating, { color: string; text: string }> = {
    good: { color: 'success', text: '良好' },
    'needs-improvement': { color: 'warning', text: '需改进' },
    poor: { color: 'error', text: '较差' },
    unknown: { color: 'default', text: '未知' },
  };
  const m = map[r];
  return <Tag color={m.color}>{m.text}</Tag>;
}

function severityTag(s: PerfSeverity): ReactNode {
  const map: Record<PerfSeverity, { color: string; text: string }> = {
    critical: { color: 'error', text: '严重' },
    warning: { color: 'warning', text: '建议' },
    info: { color: 'processing', text: '提示' },
  };
  const m = map[s];
  return <Tag color={m.color}>{m.text}</Tag>;
}

function scoreStroke(score: number): string {
  if (score >= 90) return '#52c41a';
  if (score >= 75) return '#73d13d';
  if (score >= 50) return '#faad14';
  return '#ff4d4f';
}

function MetricCard({ metric }: { metric: PerfMetric }) {
  const display = metric.unit === 'score' && metric.value != null
    ? metric.value.toFixed(3)
    : formatMs(metric.value);
  return (
    <Card size="small" styles={{ body: { padding: '12px 14px' } }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Text strong style={{ fontSize: 13 }}>{metric.id}</Text>
          {ratingTag(metric.rating)}
          {metric.detail && (
            <Tooltip title={metric.detail}>
              <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />
            </Tooltip>
          )}
        </Space>
        <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: ratingColor(metric.rating) }}>
          {display}
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {metric.label} · {metric.thresholdHint}
        </Text>
      </Space>
    </Card>
  );
}

export function PerfTool() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  const [resourceTab, setResourceTab] = useState<'size' | 'duration'>('size');

  const analyze = async () => {
    setLoading(true);
    setError(null);
    const resp = await perfSnapshot();
    setLoading(false);
    if (!resp.ok) {
      setError(resp.error);
      setSnapshot(null);
      message.error(resp.error);
      return;
    }
    setSnapshot(resp.snapshot);
    message.success(`分析完成 · 评分 ${resp.snapshot.score}（${resp.snapshot.scoreLabel}）`);
  };

  const copySummary = async () => {
    if (!snapshot) return;
    const lines = [
      `页面性能分析 ${snapshot.url}`,
      `评分 ${snapshot.score}（${snapshot.scoreLabel}）`,
      ...snapshot.metrics.map((m) => {
        const v = m.unit === 'score' && m.value != null ? m.value.toFixed(3) : formatMs(m.value);
        return `${m.id}: ${v} [${m.rating}]`;
      }),
      '',
      '优化建议：',
      ...snapshot.suggestions.map((s) => `[${s.severity}] ${s.title} — ${s.detail}`),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    message.success('已复制分析摘要');
  };

  const exportJson = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `perf-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success('已导出 JSON');
  };

  const resourceRows = useMemo(() => {
    if (!snapshot) return [];
    return resourceTab === 'size' ? snapshot.resources.topBySize : snapshot.resources.topByDuration;
  }, [snapshot, resourceTab]);

  const resourceColumns: ColumnsType<PerfResourceRow> = [
    {
      title: '资源',
      dataIndex: 'shortName',
      ellipsis: true,
      render: (v: string, row) => (
        <Tooltip title={row.name}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 72,
      render: (t: string) => <Tag style={{ marginInlineEnd: 0 }}>{t}</Tag>,
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      width: 80,
      sorter: (a, b) => a.duration - b.duration,
      render: (v: number) => formatMs(v),
    },
    {
      title: '传输',
      dataIndex: 'transferSize',
      width: 88,
      sorter: (a, b) => a.transferSize - b.transferSize,
      render: (v: number) => formatBytes(v),
    },
    {
      title: '阻塞',
      dataIndex: 'renderBlocking',
      width: 64,
      render: (v: boolean) => (v ? <Tag color="error">是</Tag> : <Text type="secondary">—</Text>),
    },
  ];

  const typeColumns: ColumnsType<PerfTypeAgg> = [
    { title: '类型', dataIndex: 'type', width: 88 },
    { title: '数量', dataIndex: 'count', width: 64 },
    {
      title: '传输体积',
      dataIndex: 'transferSize',
      render: (v: number) => formatBytes(v),
    },
    {
      title: '累计耗时',
      dataIndex: 'duration',
      render: (v: number) => formatMs(v),
    },
  ];

  const timingItems = snapshot
    ? [
        { label: '重定向', value: snapshot.timing.redirect },
        { label: 'DNS', value: snapshot.timing.dns },
        { label: 'TCP', value: snapshot.timing.tcp },
        { label: 'TLS', value: snapshot.timing.tls },
        { label: 'TTFB', value: snapshot.timing.ttfb },
        { label: '下载', value: snapshot.timing.download },
        { label: 'DOM Ready', value: snapshot.timing.domContentLoaded },
        { label: 'Load', value: snapshot.timing.load },
      ]
    : [];

  return (
    <div className="perf-tool">
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        分析<strong>当前活动标签页</strong>的加载与运行时性能（Core Web Vitals、导航分段、资源与长任务），
        并给出可落地的优化建议。请先打开业务 http/https 页面；SPA 软路由请硬刷新后再测首屏。
      </Paragraph>

      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={() => void analyze()}>
          {snapshot ? '重新分析' : '分析当前页'}
        </Button>
        <Button icon={<ReloadOutlined />} disabled={loading} onClick={() => void analyze()}>
          刷新结果
        </Button>
        <Button icon={<CopyOutlined />} disabled={!snapshot} onClick={() => void copySummary()}>
          复制摘要
        </Button>
        <Button icon={<DownloadOutlined />} disabled={!snapshot} onClick={exportJson}>
          导出 JSON
        </Button>
      </Space>

      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />
      )}

      {!snapshot && !error && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="点击「分析当前页」采集 Performance 指标"
        />
      )}

      {snapshot && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small">
            <Row gutter={[16, 16]} align="middle">
              <Col flex="120px">
                <Progress
                  type="dashboard"
                  percent={snapshot.score}
                  size={100}
                  strokeColor={scoreStroke(snapshot.score)}
                  format={(p) => (
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{p}</div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{snapshot.scoreLabel}</div>
                    </div>
                  )}
                />
              </Col>
              <Col flex="auto">
                <Title level={5} style={{ margin: '0 0 6px' }}>{snapshot.title || '未命名页面'}</Title>
                <Paragraph
                  copyable
                  ellipsis={{ rows: 2 }}
                  style={{ marginBottom: 8, fontSize: 12 }}
                  type="secondary"
                >
                  {snapshot.url}
                </Paragraph>
                <Space wrap size={[8, 8]}>
                  <Tag>导航：{snapshot.navigationType}</Tag>
                  <Tag>资源 {snapshot.resources.total}</Tag>
                  <Tag>传输 {formatBytes(snapshot.resources.transferTotal)}</Tag>
                  <Tag>DOM {snapshot.document.domNodes}</Tag>
                  <Tag>
                    长任务 {snapshot.longTasks.count}
                    {snapshot.longTasks.count > 0 ? ` / 最长 ${formatMs(snapshot.longTasks.maxDuration)}` : ''}
                  </Tag>
                  {snapshot.lcp && (
                    <Tag color="blue">
                      LCP &lt;{snapshot.lcp.tag}&gt;
                      {snapshot.lcp.url ? ` · ${formatBytes(snapshot.lcp.size)}` : ''}
                    </Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(snapshot.collectedAt).toLocaleString()}
                  </Text>
                </Space>
              </Col>
            </Row>
          </Card>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>核心指标</Text>
            <Row gutter={[10, 10]}>
              {snapshot.metrics.map((m) => (
                <Col key={m.id} xs={12} sm={8} md={6} lg={6} xl={3} style={{ minWidth: 132, flex: '1 1 132px', maxWidth: '100%' }}>
                  <MetricCard metric={m} />
                </Col>
              ))}
            </Row>
          </div>

          <Card size="small" title="导航时间分段">
            <Row gutter={[8, 8]}>
              {timingItems.map((t) => (
                <Col key={t.label} xs={12} sm={6} md={3}>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{t.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{formatMs(t.value)}</div>
                </Col>
              ))}
            </Row>
          </Card>

          <Card
            size="small"
            title="优化建议"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{snapshot.suggestions.length} 条</Text>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {snapshot.suggestions.map((s) => (
                <Alert
                  key={s.id}
                  type={s.severity === 'critical' ? 'error' : s.severity === 'warning' ? 'warning' : 'info'}
                  showIcon
                  message={(
                    <Space size={8} wrap>
                      {severityTag(s.severity)}
                      <Text strong>{s.title}</Text>
                      {s.relatedMetric && <Tag>{s.relatedMetric}</Tag>}
                    </Space>
                  )}
                  description={<Text style={{ fontSize: 13 }}>{s.detail}</Text>}
                />
              ))}
            </Space>
          </Card>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={10}>
              <Card size="small" title="资源类型汇总">
                <Table<PerfTypeAgg>
                  size="small"
                  rowKey="type"
                  pagination={false}
                  columns={typeColumns}
                  dataSource={snapshot.resources.byType}
                  scroll={{ x: true }}
                />
                <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                  脚本 {snapshot.document.scripts} · 样式表 {snapshot.document.stylesheets}
                  {' · '}
                  图片 {snapshot.document.images} · iframe {snapshot.document.iframes}
                </div>
              </Card>
            </Col>
            <Col xs={24} lg={14}>
              <Card
                size="small"
                title="资源排行"
                extra={(
                  <Space size={4}>
                    <Button
                      size="small"
                      type={resourceTab === 'size' ? 'primary' : 'default'}
                      onClick={() => setResourceTab('size')}
                    >
                      按体积
                    </Button>
                    <Button
                      size="small"
                      type={resourceTab === 'duration' ? 'primary' : 'default'}
                      onClick={() => setResourceTab('duration')}
                    >
                      按耗时
                    </Button>
                  </Space>
                )}
              >
                <Table<PerfResourceRow>
                  size="small"
                  rowKey={(r) => `${r.name}-${r.startTime}`}
                  pagination={false}
                  columns={resourceColumns}
                  dataSource={resourceRows}
                  scroll={{ x: 520 }}
                />
              </Card>
            </Col>
          </Row>

          {snapshot.notes.length > 0 && (
            <Alert
              type="info"
              showIcon
              message="说明"
              description={(
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {snapshot.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            />
          )}
        </Space>
      )}
    </div>
  );
}
