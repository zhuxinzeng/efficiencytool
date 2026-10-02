// 请求重放与修改：选择 HAR 请求 → 修改 URL/参数/请求头/请求体 → 一键重放
import { useMemo, useState } from 'react';
import {
  App, Button, Empty, Input, Popconfirm, Select, Space, Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useHar } from './useHar';
import type { HarEntryLite } from '../utils/har';

const { Text, Paragraph } = Typography;

interface HeaderRow {
  key: number;
  name: string;
  value: string;
}

interface ReplayResponse {
  status: number;
  statusText: string;
  headers: string;
  body: string;
  ms: number;
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

function statusColor(status: number): string {
  if (status >= 500) return 'red';
  if (status >= 400) return 'orange';
  if (status >= 300) return 'blue';
  if (status >= 200) return 'green';
  return 'default';
}

export function RequestReplayPanel() {
  const { entries, loading, refresh, supported } = useHar();
  const { message } = App.useApp();

  const [filter, setFilter] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [body, setBody] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [response, setResponse] = useState<ReplayResponse | null>(null);

  const filtered = useMemo(() => {
    const list = [...entries].reverse();
    const f = filter.trim().toLowerCase();
    if (!f) return list;
    return list.filter(
      (e) =>
        e.url.toLowerCase().includes(f) ||
        e.method.toLowerCase().includes(f) ||
        String(e.status).includes(f),
    );
  }, [entries, filter]);

  const loadEntry = (entry: HarEntryLite) => {
    setActiveId(entry.id);
    setMethod(entry.method);
    setUrl(entry.url);
    setHeaders(entry.requestHeaders.map((h, i) => ({ key: i, name: h.name, value: h.value })));
    setBody(entry.postData);
    setResponse(null);
  };

  const replay = async () => {
    if (!url.trim()) {
      message.warning('请先从左侧选择或直接输入一个请求');
      return;
    }
    setReplaying(true);
    setResponse(null);
    const started = performance.now();
    try {
      const headerObj: Record<string, string> = {};
      for (const h of headers) {
        if (h.name.trim()) headerObj[h.name.trim()] = h.value;
      }
      const init: RequestInit = {
        method,
        headers: headerObj,
        ...(body && !['GET', 'HEAD'].includes(method) ? { body } : {}),
      };
      const res = await fetch(url, init);
      const text = await res.text();
      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n'),
        body: text.length > 100_000 ? `${text.slice(0, 100_000)}\n…（超长已截断，共 ${text.length} 字符）` : text,
        ms: Math.round(performance.now() - started),
      });
    } catch (e) {
      setResponse({
        status: 0,
        statusText: '请求失败',
        headers: '',
        body: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        ms: Math.round(performance.now() - started),
      });
    } finally {
      setReplaying(false);
    }
  };

  const columns: ColumnsType<HarEntryLite> = [
    {
      title: '时间',
      dataIndex: 'startedDateTime',
      width: 76,
      render: (v: string) => new Date(v).toLocaleTimeString('zh-CN', { hour12: false }),
    },
    { title: '方法', dataIndex: 'method', width: 64, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 64,
      render: (v: number) => <Tag color={statusColor(v)}>{v || '-'}</Tag>,
    },
    { title: 'URL', dataIndex: 'url', ellipsis: true },
  ];

  const updateHeader = (key: number, patch: Partial<HeaderRow>) => {
    setHeaders((prev) => prev.map((h) => (h.key === key ? { ...h, ...patch } : h)));
  };

  return (
    <div style={{ display: 'flex', gap: 12, minHeight: 360 }}>
      {/* 左：请求列表 */}
      <div style={{ width: '42%', minWidth: 300, display: 'flex', flexDirection: 'column' }}>
        <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
          <Input
            allowClear
            placeholder="按 URL / 方法 / 状态过滤"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button>
        </Space.Compact>
        <Table<HarEntryLite>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 30, size: 'small', hideOnSinglePage: true }}
          loading={loading}
          onRow={(record) => ({ onClick: () => loadEntry(record), style: { cursor: 'pointer' } })}
          rowClassName={(record) => (record.id === activeId ? 'ant-table-row-selected' : '')}
          locale={{ emptyText: <Empty description={supported ? '暂无请求记录（DevTools 打开后访问页面即可捕获）' : '非 DevTools 环境'} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          scroll={{ y: 420 }}
        />
      </div>

      {/* 右：编辑与重放 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          选中请求后可修改任意部分再重放；扩展已豁免跨域限制。重放不携带浏览器 Cookie/凭据，需要时手动在请求头补充。
        </Paragraph>
        <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
          <Select value={method} onChange={setMethod} style={{ width: 104 }} options={METHODS.map((m) => ({ label: m, value: m }))} />
          <Input allowClear placeholder="https://api.example.com/path?query=1" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Space.Compact>

        {/* 请求头编辑 */}
        <div className="tool-section-title" style={{ marginTop: 4 }}>请求头（可增删改）</div>
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid rgba(5,5,5,0.08)', borderRadius: 8, padding: 8 }}>
          {headers.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>无请求头</Text>}
          {headers.map((h) => (
            <Space.Compact key={h.key} style={{ display: 'flex', marginBottom: 4 }}>
              <Input
                size="small"
                style={{ width: '38%' }}
                placeholder="Header"
                value={h.name}
                onChange={(e) => updateHeader(h.key, { name: e.target.value })}
              />
              <Input
                size="small"
                style={{ flex: 1 }}
                placeholder="Value"
                value={h.value}
                onChange={(e) => updateHeader(h.key, { value: e.target.value })}
              />
              <Button size="small" icon={<DeleteOutlined />} onClick={() => setHeaders((prev) => prev.filter((x) => x.key !== h.key))} />
            </Space.Compact>
          ))}
          <Button
            size="small"
            type="dashed"
            block
            icon={<PlusOutlined />}
            style={{ marginTop: 4 }}
            onClick={() => setHeaders((prev) => [...prev, { key: Date.now(), name: '', value: '' }])}
          >
            添加请求头
          </Button>
        </div>

        {/* 请求体 */}
        <div className="tool-section-title" style={{ marginTop: 12 }}>请求体</div>
        <Input.TextArea
          rows={4}
          placeholder="POST/PUT 等请求的 body（可修改后重放）"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />

        <Space style={{ marginTop: 12 }}>
          <Button type="primary" icon={<RocketOutlined />} loading={replaying} onClick={replay}>
            重放请求
          </Button>
          {activeId && (
            <Popconfirm title="重置为原始请求？" onConfirm={() => { const e = entries.find((x) => x.id === activeId); if (e) loadEntry(e); }}>
              <Button>重置修改</Button>
            </Popconfirm>
          )}
        </Space>

        {response && (
          <div style={{ marginTop: 12 }}>
            <Space style={{ marginBottom: 8 }}>
              <Tag color={statusColor(response.status)}>{response.status} {response.statusText}</Tag>
              <Text type="secondary">{response.ms} ms</Text>
            </Space>
            <div className="tool-section-title">响应头</div>
            <pre className="result-pre" style={{ maxHeight: 120 }}>{response.headers || '（无）'}</pre>
            <div className="tool-section-title">响应体</div>
            <pre className="result-pre" style={{ maxHeight: 260 }}>{response.body || '（空）'}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
