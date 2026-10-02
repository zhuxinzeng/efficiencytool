// GraphQL 调试器：识别页面发出的 GraphQL 请求 → 编辑 query/variables 重放 → introspection 查看 Schema
import { useMemo, useState } from 'react';
import { Alert, App, Button, Empty, Input, Space, Table, Tag, Tree, Typography } from 'antd';
import { DatabaseOutlined, RocketOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useHar } from './useHar';
import { extractGraphQL, type HarEntryLite } from '../utils/har';

const { Text, Paragraph } = Typography;

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types { kind name description fields(includeDeprecated: true) { name description type { ...TypeRef } } }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
}`;

interface SchemaField {
  name: string;
  description: string;
  typeRef: string;
}

interface SchemaData {
  queryType: string | null;
  mutationType: string | null;
  fieldsByType: Record<string, SchemaField[]>;
  types: { kind: string; name: string; description: string }[];
}

/** 把内省结果中的类型引用（TypeRef fragment）拼成可读字符串 */
function typeRefToString(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const { kind, name, ofType } = node as { kind?: string; name?: string; ofType?: unknown };
  if (name) return name;
  if (kind === 'NON_NULL') return `${typeRefToString(ofType)}!`;
  if (kind === 'LIST') return `[${typeRefToString(ofType)}]`;
  return kind ?? '';
}

function parseSchema(data: unknown): SchemaData | null {
  const schema = (data as { __schema?: Record<string, unknown> } | null)?.__schema;
  if (!schema) return null;
  const types = (schema.types as { kind: string; name: string; description?: string; fields?: unknown[] }[]) ?? [];
  const fieldsByType: Record<string, SchemaField[]> = {};
  for (const t of types) {
    if (t.fields) {
      fieldsByType[t.name] = t.fields.map((f) => {
        const field = f as { name: string; description?: string; type?: unknown };
        return { name: field.name, description: field.description ?? '', typeRef: typeRefToString(field.type) };
      });
    }
  }
  return {
    queryType: (schema.queryType as { name: string } | null)?.name ?? null,
    mutationType: (schema.mutationType as { name: string } | null)?.name ?? null,
    fieldsByType,
    types: types.map((t) => ({ kind: t.kind, name: t.name, description: t.description ?? '' })),
  };
}

export function GraphqlPanel() {
  const { entries, loading, supported } = useHar();
  const { message } = App.useApp();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [query, setQuery] = useState('');
  const [variables, setVariables] = useState('{}');
  const [operationName, setOperationName] = useState('');
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState('');
  const [schema, setSchema] = useState<SchemaData | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState('');

  // 识别出的 GraphQL 请求列表（含直接 body 为 query 的请求）
  const graphqlEntries = useMemo(() => {
    return entries
      .map((e) => ({ entry: e, gql: extractGraphQL(e) }))
      .filter((x) => x.gql !== null) as { entry: HarEntryLite; gql: NonNullable<ReturnType<typeof extractGraphQL>> }[];
  }, [entries]);

  const loadEntry = (entry: HarEntryLite, gql: NonNullable<ReturnType<typeof extractGraphQL>>) => {
    setActiveId(entry.id);
    setEndpoint(entry.url);
    setQuery(gql.query);
    setVariables(gql.variables || '{}');
    setOperationName(gql.operationName);
    setResponse('');
    setSchema(null);
    setSchemaError('');
  };

  const run = async () => {
    if (!endpoint.trim() || !query.trim()) {
      message.warning('请先选择一个 GraphQL 请求或填写 endpoint 与 query');
      return;
    }
    setRunning(true);
    try {
      const parsedVars = variables.trim() ? JSON.parse(variables) : {};
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: parsedVars, ...(operationName ? { operationName } : {}) }),
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // 非 JSON 响应原样展示
      }
      setResponse(`HTTP ${res.status} ${res.statusText}\n\n${pretty}`);
    } catch (e) {
      setResponse(`请求失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const fetchSchema = async () => {
    if (!endpoint.trim()) {
      message.warning('请先选择一个 GraphQL 请求以确定 endpoint');
      return;
    }
    setSchemaLoading(true);
    setSchemaError('');
    setSchema(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      });
      const json = (await res.json()) as { data?: unknown; errors?: unknown };
      if (json.errors && !json.data) {
        setSchemaError(`服务端返回错误：${JSON.stringify(json.errors, null, 2)}`);
      } else {
        const parsed = parseSchema(json.data);
        if (parsed) {
          setSchema(parsed);
        } else {
          setSchemaError('未能解析 introspection 结果（该端点可能禁用了 introspection）');
        }
      }
    } catch (e) {
      setSchemaError(`请求失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSchemaLoading(false);
    }
  };

  const columns: ColumnsType<HarEntryLite> = [
    {
      title: '时间',
      dataIndex: 'startedDateTime',
      width: 76,
      render: (v: string) => new Date(v).toLocaleTimeString('zh-CN', { hour12: false }),
    },
    { title: '状态', dataIndex: 'status', width: 64, render: (v: number) => <Tag color={v >= 400 ? 'orange' : 'green'}>{v}</Tag> },
    { title: 'Endpoint', dataIndex: 'url', ellipsis: true },
  ];

  const schemaTreeData = schema
    ? [
        ...(schema.queryType && schema.fieldsByType[schema.queryType]
          ? [{
              title: `Query（查询，${schema.fieldsByType[schema.queryType].length} 个字段）`,
              key: 'Query',
              children: schema.fieldsByType[schema.queryType].map((f) => ({
                title: <span><Text strong>{f.name}</Text><Text type="secondary">({f.typeRef})</Text>{f.description ? <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{f.description}</Text> : null}</span>,
                key: `Query.${f.name}`,
              })),
            }]
          : []),
        ...(schema.mutationType && schema.fieldsByType[schema.mutationType]
          ? [{
              title: `Mutation（变更，${schema.fieldsByType[schema.mutationType].length} 个字段）`,
              key: 'Mutation',
              children: schema.fieldsByType[schema.mutationType].map((f) => ({
                title: <span><Text strong>{f.name}</Text><Text type="secondary">({f.typeRef})</Text></span>,
                key: `Mutation.${f.name}`,
              })),
            }]
          : []),
        {
          title: `全部类型（${schema.types.length}）`,
          key: 'types',
          children: schema.types
            .filter((t) => t.kind === 'OBJECT' && t.name.startsWith('__') === false)
            .map((t) => ({
              title: <span><Text strong>{t.name}</Text><Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{t.description}</Text></span>,
              key: `type.${t.name}`,
              children: (schema.fieldsByType[t.name] ?? []).map((f) => ({
                title: <span>{f.name}<Text type="secondary">: {f.typeRef}</Text></span>,
                key: `type.${t.name}.${f.name}`,
              })),
            })),
        },
      ]
    : [];

  return (
    <div style={{ display: 'flex', gap: 12, minHeight: 360 }}>
      <div style={{ width: '38%', minWidth: 260 }}>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          自动识别页面发出的 GraphQL 请求（JSON body 含 query 字段，或 URL 指向 graphql 端点）。
        </Paragraph>
        <Table<HarEntryLite>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={graphqlEntries.map((x) => x.entry)}
          pagination={{ pageSize: 20, size: 'small', hideOnSinglePage: true }}
          loading={loading}
          onRow={({ id }) => ({
            onClick: () => {
              const found = graphqlEntries.find((x) => x.entry.id === id);
              if (found) loadEntry(found.entry, found.gql);
            },
            style: { cursor: 'pointer' },
          })}
          rowClassName={(record) => (record.id === activeId ? 'ant-table-row-selected' : '')}
          locale={{ emptyText: <Empty description={supported ? '暂未捕获 GraphQL 请求（在页面触发相关请求后出现）' : '非 DevTools 环境'} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          scroll={{ y: 380 }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <Input
          allowClear
          placeholder="GraphQL endpoint（选择左侧请求后自动填充）"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <Input.TextArea
          rows={8}
          placeholder="query { ... }（选择请求后可编辑后重放）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <div className="tool-section-title" style={{ marginTop: 8 }}>variables（JSON）</div>
        <Input.TextArea
          rows={4}
          placeholder='{ "id": 1 }'
          value={variables}
          onChange={(e) => setVariables(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" icon={<RocketOutlined />} loading={running} onClick={run}>执行 query</Button>
          <Button icon={<DatabaseOutlined />} loading={schemaLoading} onClick={fetchSchema}>查看 Schema</Button>
        </Space>

        {schemaError && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Schema 获取失败" description={<pre className="result-pre" style={{ maxHeight: 140 }}>{schemaError}</pre>} />}
        {schema && (
          <div style={{ marginTop: 12 }}>
            <div className="tool-section-title">Schema（introspection）</div>
            <Tree treeData={schemaTreeData} defaultExpandParent height={280} showLine />
          </div>
        )}
        {response && (
          <div style={{ marginTop: 12 }}>
            <div className="tool-section-title">执行结果</div>
            <pre className="result-pre" style={{ maxHeight: 300 }}>{response}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
