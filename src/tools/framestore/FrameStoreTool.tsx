// 框架状态：探测当前页 Pinia / Vuex / Redux，树形查看，Pinia/Vuex 支持路径写入
import { useMemo, useState } from 'react';
import {
  Alert, App, Button, Empty, Input, Modal, Radio, Select, Space, Spin, Tag, Tree, Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  CopyOutlined, EditOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import { storeGet, storeList, storeSet } from '../../shared/store-client';
import type { StoreFramework, StoreSnapshot, StoreSummary } from '../../shared/store-protocol';

const { Paragraph, Text } = Typography;

type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'json';

function frameworkColor(f: StoreFramework): string {
  if (f === 'pinia') return 'green';
  if (f === 'vuex') return 'blue';
  return 'purple';
}

function detectKind(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

function parseEditValue(kind: ValueKind, raw: string): unknown {
  if (kind === 'null') return null;
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error('数字格式不正确');
    return n;
  }
  if (kind === 'string') return raw;
  return JSON.parse(raw) as unknown;
}

/** state → antd Tree；key 为 JSON path 数组的序列化 */
function buildTree(value: unknown, path: string[] = []): DataNode[] {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        const childPath = [...path, String(index)];
        const key = childPath.join('\u0001');
        const isLeaf = item === null || typeof item !== 'object';
        return {
          key,
          title: renderTitle(`[${index}]`, item, isLeaf),
          children: isLeaf ? undefined : buildTree(item, childPath),
          isLeaf,
          path: childPath,
          raw: item,
        } as DataNode & { path: string[]; raw: unknown };
      });
    }
    return Object.keys(value as object).map((k) => {
      const childPath = [...path, k];
      const item = (value as Record<string, unknown>)[k];
      const key = childPath.join('\u0001');
      const isLeaf = item === null || typeof item !== 'object';
      return {
        key,
        title: renderTitle(k, item, isLeaf),
        children: isLeaf ? undefined : buildTree(item, childPath),
        isLeaf,
        path: childPath,
        raw: item,
      } as DataNode & { path: string[]; raw: unknown };
    });
  }
  return [{
    key: path.join('\u0001') || 'root',
    title: renderTitle('(root)', value, true),
    isLeaf: true,
    path,
    raw: value,
  } as DataNode & { path: string[]; raw: unknown }];
}

function previewValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > 48 ? `${JSON.stringify(v.slice(0, 48))}…` : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === 'object') return `Object(${Object.keys(v as object).length})`;
  return String(v);
}

function renderTitle(name: string, value: unknown, isLeaf: boolean) {
  return (
    <Space size={6} wrap>
      <Text code style={{ fontSize: 12 }}>{name}</Text>
      {isLeaf ? <Text type="secondary" style={{ fontSize: 12 }}>{previewValue(value)}</Text> : (
        <Text type="secondary" style={{ fontSize: 12 }}>{previewValue(value)}</Text>
      )}
    </Space>
  );
}

function filterTree(nodes: DataNode[], kw: string): DataNode[] {
  if (!kw) return nodes;
  const lower = kw.toLowerCase();
  const walk = (list: DataNode[]): DataNode[] => {
    const out: DataNode[] = [];
    for (const n of list) {
      const titleText = typeof n.title === 'string' ? n.title : (n.key as string);
      const selfHit = String(n.key).toLowerCase().includes(lower) || String(titleText).toLowerCase().includes(lower)
        || previewValue((n as { raw?: unknown }).raw).toLowerCase().includes(lower);
      const kids = n.children ? walk(n.children) : [];
      if (selfHit || kids.length) {
        out.push({ ...n, children: kids.length ? kids : n.children });
      }
    }
    return out;
  };
  return walk(nodes);
}

export function FrameStoreTool() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<StoreSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<StoreSnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editPath, setEditPath] = useState<string[]>([]);
  const [editKind, setEditKind] = useState<ValueKind>('string');
  const [editText, setEditText] = useState('');
  const [probeError, setProbeError] = useState<string | null>(null);

  const selectedMeta = list.find((s) => `${s.framework}:${s.id}` === selected) ?? null;

  const treeData = useMemo(() => {
    if (!snapshot) return [];
    return filterTree(buildTree(snapshot.state), keyword.trim());
  }, [snapshot, keyword]);

  const probe = async () => {
    setLoading(true);
    setProbeError(null);
    try {
      const resp = await storeList();
      if (!resp.ok) {
        setList([]);
        setSnapshot(null);
        setSelected(null);
        setProbeError(resp.error);
        return;
      }
      setList(resp.list);
      if (resp.list.length === 0) {
        setSnapshot(null);
        setSelected(null);
        message.info('未探测到 Pinia / Vuex / Redux（页面可能未挂载，或 store 未暴露到可访问位置）');
        return;
      }
      message.success(`探测到 ${resp.list.length} 个 store`);
      const first = resp.list[0]!;
      const key = `${first.framework}:${first.id}`;
      setSelected(key);
      await loadSnapshot(first.framework, first.id);
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshot = async (framework: StoreFramework, id: string) => {
    setSnapLoading(true);
    try {
      const resp = await storeGet(framework, id);
      if (!resp.ok) {
        message.error(resp.error);
        setSnapshot(null);
        return;
      }
      setSnapshot(resp.snapshot);
    } finally {
      setSnapLoading(false);
    }
  };

  const onSelectStore = async (value: string) => {
    setSelected(value);
    const [framework, ...rest] = value.split(':');
    const id = rest.join(':');
    await loadSnapshot(framework as StoreFramework, id);
  };

  const openEdit = (path: string[], raw: unknown) => {
    if (!snapshot?.editable) {
      message.warning('当前 store 为只读（Redux 或无 replaceState 的 Vuex）');
      return;
    }
    if (path.length === 0) {
      message.warning('请选择具体字段节点再编辑');
      return;
    }
    const kind = detectKind(raw);
    setEditPath(path);
    setEditKind(kind);
    setEditText(kind === 'json' || kind === 'string' ? (kind === 'json' ? JSON.stringify(raw, null, 2) : String(raw)) : String(raw));
    if (kind === 'boolean') setEditText(raw ? 'true' : 'false');
    if (kind === 'null') setEditText('null');
    setEditOpen(true);
  };

  const applyEdit = async () => {
    if (!snapshot) return;
    try {
      const value = parseEditValue(editKind, editText);
      const resp = await storeSet(snapshot.framework, snapshot.id, editPath, value);
      if (!resp.ok) {
        message.error(resp.error);
        return;
      }
      message.success('已写入页面 store');
      setEditOpen(false);
      await loadSnapshot(snapshot.framework, snapshot.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const copyState = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot.state, null, 2));
      message.success('状态 JSON 已复制');
    } catch {
      message.error('复制失败');
    }
  };

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        探测当前活动标签页的 <Text strong>Pinia / Vuex / Redux</Text> 状态树。
        Pinia（$patch）与 Vuex（replaceState）支持简单字段写入；Redux 默认只读（无通用 patch）。
        依赖页面是否暴露 store，不保证所有项目都能检测到。
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="使用前请先切换到业务页面，再点「探测当前页」。探测的是活动标签页，不是侧边栏自身。"
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void probe()}>
          探测当前页
        </Button>
        <Button
          icon={<ReloadOutlined />}
          disabled={!selectedMeta}
          loading={snapLoading}
          onClick={() => selectedMeta && void loadSnapshot(selectedMeta.framework, selectedMeta.id)}
        >
          刷新状态
        </Button>
        <Button icon={<CopyOutlined />} disabled={!snapshot} onClick={() => void copyState()}>
          复制 JSON
        </Button>
      </Space>

      {probeError ? (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={probeError} />
      ) : null}

      {list.length > 0 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Select
            style={{ width: '100%', maxWidth: 480 }}
            value={selected ?? undefined}
            onChange={(v) => void onSelectStore(v)}
            options={list.map((s) => ({
              value: `${s.framework}:${s.id}`,
              label: (
                <Space size={6}>
                  <Tag color={frameworkColor(s.framework)}>{s.framework}</Tag>
                  <span>{s.label}</span>
                  {!s.editable ? <Tag>只读</Tag> : <Tag color="success">可写</Tag>}
                </Space>
              ),
            }))}
          />

          {selectedMeta?.hint ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{selectedMeta.hint}</Text>
          ) : null}

          <Input
            allowClear
            placeholder="过滤字段名 / 预览值"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ maxWidth: 360 }}
          />

          <Spin spinning={snapLoading}>
            {snapshot ? (
              <div style={{ border: '1px solid rgba(5,5,5,0.06)', borderRadius: 8, padding: 8, maxHeight: 480, overflow: 'auto' }}>
                {snapshot.truncated ? (
                  <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="状态较大或含不可序列化值，展示已截断/替换" />
                ) : null}
                <Tree
                  showLine
                  defaultExpandAll={false}
                  treeData={treeData}
                  onSelect={(_keys, info) => {
                    const node = info.node as DataNode & { path?: string[]; raw?: unknown; isLeaf?: boolean };
                    if (!node.path) return;
                    // 叶子直接编辑；非叶子也允许编辑整段 JSON
                    openEdit(node.path, node.raw);
                  }}
                  titleRender={(node) => {
                    const n = node as DataNode & { path?: string[]; raw?: unknown; isLeaf?: boolean };
                    const label = typeof node.title === 'function' ? null : node.title;
                    return (
                      <Space size={4}>
                        {label}
                        {snapshot.editable && n.path && n.path.length > 0 ? (
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(n.path!, n.raw);
                            }}
                          />
                        ) : null}
                      </Space>
                    );
                  }}
                />
                {treeData.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配节点" /> : null}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择 store 后显示状态树" />
            )}
          </Spin>
        </Space>
      ) : (
        !loading && !probeError ? (
          <Empty description="点击「探测当前页」开始" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : null
      )}

      <Modal
        title={`编辑 · ${editPath.join('.') || '(root)'}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => void applyEdit()}
        okText="写入页面"
        destroyOnClose
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text type="secondary">类型</Text>
            <div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={editKind}
                onChange={(e) => setEditKind(e.target.value as ValueKind)}
                options={[
                  { label: 'string', value: 'string' },
                  { label: 'number', value: 'number' },
                  { label: 'boolean', value: 'boolean' },
                  { label: 'null', value: 'null' },
                  { label: 'json', value: 'json' },
                ]}
              />
            </div>
          </div>
          {editKind === 'boolean' ? (
            <Radio.Group
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              options={[
                { label: 'true', value: 'true' },
                { label: 'false', value: 'false' },
              ]}
            />
          ) : editKind === 'null' ? (
            <Text type="secondary">将写入 null</Text>
          ) : (
            <Input.TextArea
              rows={editKind === 'json' ? 10 : 4}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            写入会直接改动页面内存状态，可能导致 UI 与业务逻辑不一致，仅用于本地调试。
          </Text>
        </Space>
      </Modal>
    </div>
  );
}
