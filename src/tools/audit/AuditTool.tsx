// 字体与颜色审计：注入当前标签页，统计实际渲染的字体族/字号/字重、颜色用量与 CSS 变量
import { useMemo, useState } from 'react';
import {
  Alert, App, Button, Descriptions, Segmented, Space, Table, Tag, Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { auditPage } from '../../shared/audit-client';
import type {
  AuditColorUsage, AuditFontUsage, AuditSnapshot, AuditUsageEntry, AuditVarEntry,
} from '../../shared/audit-protocol';
import { CopyBtn } from '../../components/CopyBtn';

const { Paragraph, Text } = Typography;

type Tab = 'fonts' | 'sizes' | 'colors' | 'vars';

const KIND_LABELS: Record<string, string> = { text: '文字', background: '背景', border: '边框' };

export function AuditTool() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('fonts');

  const run = async () => {
    setLoading(true);
    setError(null);
    const resp = await auditPage();
    setLoading(false);
    if (!resp.ok) {
      setError(resp.error);
      setSnapshot(null);
      message.error(resp.error);
      return;
    }
    setSnapshot(resp.snapshot);
    message.success(`审计完成：${resp.snapshot.fonts.length} 种字体 · ${resp.snapshot.colors.length} 种颜色`);
  };

  const fontColumns: ColumnsType<AuditFontUsage> = [
    {
      title: '字体族', dataIndex: 'family', key: 'family', ellipsis: true,
      render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '元素数', dataIndex: 'count', key: 'count', width: 72, align: 'right',
      sorter: (a, b) => a.count - b.count,
    },
    {
      title: '常见字号 / 字重', key: 'detail',
      render: (_v, r) => (
        <Space size={4} wrap>
          {r.sizes.map((s) => <Tag key={s.value} style={{ marginInlineEnd: 0 }}>{s.value} ×{s.count}</Tag>)}
          {r.weights.map((w) => <Tag key={w.value} color="blue" style={{ marginInlineEnd: 0 }}>{w.value}</Tag>)}
        </Space>
      ),
    },
  ];

  const sizeColumns: ColumnsType<AuditUsageEntry> = [
    { title: '字号', dataIndex: 'value', key: 'value', render: (v: string) => <Text code>{v}</Text> },
    { title: '元素数', dataIndex: 'count', key: 'count', width: 90, align: 'right', sorter: (a, b) => a.count - b.count },
    {
      title: '预览', key: 'preview',
      render: (_v, r) => <span style={{ fontSize: r.value }}>示例 Aa 中文</span>,
    },
  ];

  const colorColumns: ColumnsType<AuditColorUsage> = [
    {
      title: '色值', dataIndex: 'hex', key: 'hex', width: 120,
      render: (v: string) => (
        <Space size={6}>
          <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: v, border: '1px solid rgba(5,5,5,0.12)' }} />
          <Text code style={{ fontSize: 12 }}>{v}</Text>
        </Space>
      ),
    },
    { title: '原始值', dataIndex: 'raw', key: 'raw', ellipsis: true, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '用途', dataIndex: 'kinds', key: 'kinds', width: 130,
      render: (kinds: string[]) => kinds.map((k) => <Tag key={k} style={{ marginInlineEnd: 4 }}>{KIND_LABELS[k] ?? k}</Tag>),
    },
    { title: '次数', dataIndex: 'count', key: 'count', width: 72, align: 'right', sorter: (a, b) => a.count - b.count },
    { title: '示例文本', dataIndex: 'sample', key: 'sample', ellipsis: true, render: (v: string) => v || <Text type="secondary">—</Text> },
  ];

  const varColumns: ColumnsType<AuditVarEntry> = [
    { title: '变量名', dataIndex: 'name', key: 'name', width: 200, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '值', dataIndex: 'value', key: 'value', ellipsis: true,
      render: (v: string) => (
        <Space size={6}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
          <CopyBtn size="small" type="text" text={v} />
        </Space>
      ),
    },
  ];

  const palette = useMemo(
    () => snapshot?.colors.map((c) => c.hex).join('\n') ?? '',
    [snapshot],
  );
  const varsCss = useMemo(
    () => snapshot?.cssVars.map((v) => `${v.name}: ${v.value};`).join('\n') ?? '',
    [snapshot],
  );

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        审计当前页面真实渲染的字体与颜色：字体族 / 字号 / 字重分布、颜色用量（文字 / 背景 / 边框）以及 CSS 变量，便于还原设计稿或清理样式债务。
      </Paragraph>

      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
          {snapshot ? '重新审计' : '开始审计'}
        </Button>
        {snapshot && (
          <>
            <CopyBtn size="small" text={palette} successText="已复制色值清单">复制色值</CopyBtn>
            <CopyBtn size="small" text={varsCss} successText="已复制 CSS 变量">复制 CSS 变量</CopyBtn>
            <CopyBtn size="small" text={JSON.stringify(snapshot, null, 2)} successText="已复制 JSON">复制 JSON</CopyBtn>
          </>
        )}
      </Space>

      {error && <Alert type="error" showIcon message="审计失败" description={error} style={{ marginBottom: 12 }} />}

      {snapshot && (
        <>
          <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="页面">{snapshot.title || '（无标题）'}</Descriptions.Item>
            <Descriptions.Item label="元素统计">
              {snapshot.scannedCount} / {snapshot.elementCount} 个元素参与统计
            </Descriptions.Item>
            <Descriptions.Item label="已加载字体">
              {snapshot.loadedFonts.length
                ? <Space size={4} wrap>{snapshot.loadedFonts.map((f) => <Tag key={f}>{f}</Tag>)}</Space>
                : <Text type="secondary">document.fonts 未返回字体（可能未使用 Web Font）</Text>}
            </Descriptions.Item>
          </Descriptions>

          {snapshot.notes.map((n) => (
            <Alert key={n} type="info" showIcon message={n} style={{ marginBottom: 8 }} />
          ))}

          <Segmented
            block
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            options={[
              { label: `字体 ${snapshot.fonts.length}`, value: 'fonts' },
              { label: `字号 ${snapshot.fontSizes.length}`, value: 'sizes' },
              { label: `颜色 ${snapshot.colors.length}`, value: 'colors' },
              { label: `CSS 变量 ${snapshot.cssVars.length}`, value: 'vars' },
            ]}
            style={{ marginBottom: 10 }}
          />

          {tab === 'fonts' && (
            <Table<AuditFontUsage>
              size="small" rowKey="family" columns={fontColumns} dataSource={snapshot.fonts}
              pagination={false} scroll={{ x: 'max-content', y: 340 }}
            />
          )}
          {tab === 'sizes' && (
            <Table<AuditUsageEntry>
              size="small" rowKey="value" columns={sizeColumns} dataSource={snapshot.fontSizes}
              pagination={false} scroll={{ x: 'max-content', y: 340 }}
            />
          )}
          {tab === 'colors' && (
            <Table<AuditColorUsage>
              size="small" rowKey="hex" columns={colorColumns} dataSource={snapshot.colors}
              pagination={false} scroll={{ x: 'max-content', y: 340 }}
            />
          )}
          {tab === 'vars' && (
            snapshot.cssVars.length ? (
              <Table<AuditVarEntry>
                size="small" rowKey="name" columns={varColumns} dataSource={snapshot.cssVars}
                pagination={false} scroll={{ x: 'max-content', y: 340 }}
              />
            ) : (
              <div className="empty-hint">未发现 CSS 变量（可能样式表跨域）</div>
            )
          )}
        </>
      )}

      {!snapshot && !error && (
        <div className="empty-hint">点击「开始审计」采集当前页面样式（需在普通 http/https 页面）</div>
      )}
    </div>
  );
}