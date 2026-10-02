// 接口录制：保存当前 Tab 的 XHR/Fetch 请求与响应，页面跳转后仍可查看（chrome.debugger + storage 持久化）
// 布局：列表仅展示方法/状态/接口，点击行弹窗查看完整详情
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Alert, App, Badge, Button, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography,
} from 'antd';
import {
  ClearOutlined, CopyOutlined, DownloadOutlined, PlayCircleOutlined, StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getDebuggerState, recClear, recList, recStart, recStop, subscribeDebuggerPush,
} from '../../shared/debugger-client';
import {
  REC_ENTRY_LIMIT, type DebuggerState, type RecordingEntry,
} from '../../shared/debugger-protocol';

const { Paragraph, Text } = Typography;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function statusColor(status: number): string {
  if (status === 0) return 'default';
  if (status < 300) return 'success';
  if (status < 400) return 'warning';
  return 'error';
}

function prettyMaybe(text: string): string {
  const t = text.trim();
  if (!t) return '';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text;
  }
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || url;
  } catch {
    return url;
  }
}

export function NetRecordTool() {
  const { message } = App.useApp();
  const [state, setState] = useState<DebuggerState | null>(null);
  const [entries, setEntries] = useState<RecordingEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [method, setMethod] = useState<string>('all');
  const [pageFilter, setPageFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [starting, setStarting] = useState(false);
  const [detail, setDetail] = useState<RecordingEntry | null>(null);

  useEffect(() => {
    void (async () => {
      setState(await getDebuggerState());
      setEntries(await recList());
    })();
    return subscribeDebuggerPush((push) => {
      if (push.type === 'dbg/state') {
        setState(push.state);
      } else if (push.type === 'dbg/recEntries') {
        setEntries((prev) => {
          const ids = new Set(push.entries.map((e) => e.id));
          const merged = [...push.entries, ...prev.filter((e) => !ids.has(e.id))];
          return merged.slice(0, REC_ENTRY_LIMIT);
        });
      }
    });
  }, []);

  const recording = !!state?.recording;

  const pageOptions = useMemo(() => {
    const pages = new Map<string, number>();
    for (const e of entries) {
      if (!e.pageUrl) continue;
      pages.set(e.pageUrl, (pages.get(e.pageUrl) || 0) + 1);
    }
    return [
      { label: `全部页面（${entries.length}）`, value: 'all' },
      ...[...pages.entries()].map(([url, count]) => ({
        label: `${shortPath(url)}（${count}）`,
        value: url,
      })),
    ];
  }, [entries]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return entries.filter((e) => {
      if (method !== 'all' && e.method !== method) return false;
      if (pageFilter !== 'all' && e.pageUrl !== pageFilter) return false;
      if (kindFilter === 'api' && e.resourceType === 'Document') return false;
      if (kindFilter === 'doc' && e.resourceType !== 'Document') return false;
      if (kindFilter === 'redirect' && !(e.status >= 300 && e.status < 400)) return false;
      if (!kw) return true;
      return (
        e.url.toLowerCase().includes(kw)
        || e.pageUrl.toLowerCase().includes(kw)
        || e.requestBody.toLowerCase().includes(kw)
        || e.responseBody.toLowerCase().includes(kw)
      );
    });
  }, [entries, keyword, method, pageFilter, kindFilter]);

  const start = async () => {
    setStarting(true);
    try {
      const resp = await recStart();
      if (!resp.ok) message.error(resp.error || '开启失败');
      else {
        if (resp.state) setState(resp.state);
        message.success('已开始录制当前标签页（跳转后记录仍保留）');
      }
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    const resp = await recStop();
    if (!resp.ok) message.error(resp.error || '停止失败');
    else if (resp.state) setState(resp.state);
  };

  const clear = async () => {
    const resp = await recClear();
    if (!resp.ok) message.error(resp.error || '清空失败');
    else {
      setEntries([]);
      if (resp.state) setState(resp.state);
      setDetail(null);
      message.success('已清空录制记录');
    }
  };

  const exportJson = () => {
    const data = JSON.stringify(
      { exportedAt: new Date().toISOString(), count: filtered.length, entries: filtered.slice().reverse() },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-recording-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${filtered.length} 条`);
  };

  const copyText = async (text: string, tip: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(tip);
    } catch {
      message.error('复制失败');
    }
  };

  const columns: ColumnsType<RecordingEntry> = [
    {
      title: '方法',
      dataIndex: 'method',
      width: 88,
      render: (m: string) => <Tag color={m === 'GET' ? 'blue' : m === 'POST' ? 'green' : 'purple'}>{m}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (s: number, r) => (
        r.errorText
          ? <Tag color="error">{r.errorText}</Tag>
          : (
            <Space size={4}>
              <Tag color={statusColor(s)}>{s || '-'}</Tag>
              {s >= 300 && s < 400 ? <Tag color="orange">跳转</Tag> : null}
            </Space>
          )
      ),
    },
    {
      title: '接口',
      dataIndex: 'url',
      ellipsis: true,
      render: (url: string, r) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
            title={url}
          >
            {shortPath(url)}
          </div>
          {r.resourceType === 'Document' ? (
            <Text type="secondary" style={{ fontSize: 11 }}>页面导航</Text>
          ) : null}
          {r.responseBody.startsWith('(redirect') ? (
            <Text type="secondary" style={{ fontSize: 11 }}>{r.responseBody}</Text>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 }}>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        录制当前标签页的 XHR / Fetch / Document（含页面 301/302 跳转链）。跨站后记录仍保留。
        筛选可切「仅重定向」查看 3xx；点击一行看 Location 与完整详情。
      </Paragraph>

      <Alert
        type={recording ? 'success' : 'warning'}
        showIcon
        message={
          recording
            ? `录制中：标签页 #${state?.tabId ?? '-'}，已保存 ${entries.length} 条（上限 ${REC_ENTRY_LIMIT}，单条 body 超 64KB 会截断）`
            : `未开启：点击「开始录制」附加到当前活动标签页。已有历史 ${entries.length} 条，停止后仍可查看 / 导出`
        }
      />

      <Space size={8} wrap>
        {recording ? (
          <Popconfirm title="停止录制？（已保存的记录不会丢）" onConfirm={() => void stop()}>
            <Button danger icon={<StopOutlined />}>停止录制</Button>
          </Popconfirm>
        ) : (
          <Button type="primary" icon={<PlayCircleOutlined />} loading={starting} onClick={() => void start()}>
            开始录制
          </Button>
        )}
        <Badge status={recording ? 'processing' : 'default'} text={recording ? '实时写入中' : '已停止'} />
        <Popconfirm title="清空全部录制记录？" onConfirm={() => void clear()}>
          <Button icon={<ClearOutlined />} disabled={entries.length === 0}>清空</Button>
        </Popconfirm>
        <Button icon={<DownloadOutlined />} disabled={filtered.length === 0} onClick={exportJson}>
          导出 JSON（{filtered.length}）
        </Button>
      </Space>

      <Space size={8} wrap style={{ width: '100%' }}>
        <Input.Search
          placeholder="搜索 URL / 页面 / 请求体 / 响应体"
          allowClear
          style={{ width: 'min(280px, 100%)', flex: '1 1 200px' }}
          onSearch={setKeyword}
          onChange={(e) => !e.target.value && setKeyword('')}
        />
        <Select
          style={{ width: 110 }}
          value={method}
          onChange={setMethod}
          options={[
            { label: '全部方法', value: 'all' },
            ...['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ label: m, value: m })),
          ]}
        />
        <Select
          style={{ width: 120 }}
          value={kindFilter}
          onChange={setKindFilter}
          options={[
            { label: '全部类型', value: 'all' },
            { label: '仅接口', value: 'api' },
            { label: '仅页面导航', value: 'doc' },
            { label: '仅重定向', value: 'redirect' },
          ]}
        />
        <Select
          style={{ minWidth: 180, flex: '1 1 220px', maxWidth: 420 }}
          value={pageFilter}
          onChange={setPageFilter}
          options={pageOptions}
          popupMatchSelectWidth={false}
        />
      </Space>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table<RecordingEntry>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 40, size: 'small', showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          onRow={(record) => ({
            onClick: () => setDetail(record),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText: (
              <Empty
                description={recording ? '暂无接口，在页面上操作一下触发请求' : '未开始录制，或历史已被清空'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
        />
      </div>

      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width="min(920px, 96vw)"
        destroyOnClose
        title={
          detail ? (
            <Space wrap size={8}>
              <Tag color={detail.method === 'GET' ? 'blue' : detail.method === 'POST' ? 'green' : 'purple'}>
                {detail.method}
              </Tag>
              <Tag color={statusColor(detail.status)}>状态 {detail.status || '-'}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(detail.ts)}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{detail.durationMs}ms</Text>
            </Space>
          ) : null
        }
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        {detail ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">接口路径</Text>
              <Paragraph copyable style={{ marginBottom: 0, fontSize: 13 }}>{shortPath(detail.url)}</Paragraph>
            </div>
            <div>
              <Text type="secondary">完整 URL</Text>
              <Paragraph copyable style={{ marginBottom: 0, fontSize: 12 }}>{detail.url}</Paragraph>
            </div>
            <div>
              <Text type="secondary">所属页面</Text>
              <Paragraph copyable style={{ marginBottom: 0, fontSize: 12 }}>{detail.pageUrl || '-'}</Paragraph>
            </div>
            <Space wrap>
              <Tag>{detail.resourceType}</Tag>
              {detail.mimeType && <Tag>{detail.mimeType}</Tag>}
              {detail.responseTruncated && <Tag color="orange">响应已截断</Tag>}
              {detail.errorText && <Tag color="error">{detail.errorText}</Tag>}
            </Space>

            <DetailBlock
              title="请求头"
              text={JSON.stringify(detail.requestHeaders, null, 2)}
              onCopy={() => void copyText(JSON.stringify(detail.requestHeaders, null, 2), '请求头已复制')}
            />
            <DetailBlock
              title="请求体"
              text={prettyMaybe(detail.requestBody) || '(空)'}
              disabled={!detail.requestBody}
              onCopy={() => void copyText(detail.requestBody, '请求体已复制')}
            />
            <DetailBlock
              title="响应头"
              text={JSON.stringify(detail.responseHeaders, null, 2)}
              onCopy={() => void copyText(JSON.stringify(detail.responseHeaders, null, 2), '响应头已复制')}
            />
            <DetailBlock
              title="响应体"
              text={prettyMaybe(detail.responseBody) || '(空)'}
              disabled={!detail.responseBody}
              onCopy={() => void copyText(detail.responseBody, '响应体已复制')}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}

function DetailBlock(props: {
  title: string;
  text: string;
  disabled?: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <Space style={{ marginBottom: 4 }}>
        <Text strong>{props.title}</Text>
        <Button size="small" type="text" icon={<CopyOutlined />} disabled={props.disabled} onClick={props.onCopy} />
      </Space>
      <pre style={preStyle}>{props.text}</pre>
    </div>
  );
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 8,
  background: 'rgba(0,0,0,0.04)',
  borderRadius: 6,
  fontSize: 12,
  maxHeight: 280,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
