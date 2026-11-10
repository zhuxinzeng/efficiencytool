// Mock 数据生成：勾选字段 + 数量，批量生成测试数据，支持表格预览、复制 CSV/JSON、下载 CSV
import { useMemo, useState } from 'react';
import {
  Button, Checkbox, InputNumber, Segmented, Space, Table, Tag, Typography, App,
} from 'antd';
import { DownloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  generateRows, MOCK_FIELD_MAP, MOCK_FIELDS, MOCK_PRESETS, toCsv, type MockGroup,
} from '../../utils/mock-data';
import { toTsv } from '../../shared/clipboard';
import { CopyBtn } from '../../components/CopyBtn';

const { Paragraph, Text } = Typography;

const GROUP_LABELS: Record<MockGroup, string> = {
  person: '个人信息',
  company: '企业信息',
  api: '接口字段',
  misc: '其他',
};

const GROUP_ORDER: MockGroup[] = ['person', 'company', 'api', 'misc'];

type Row = Record<string, string>;

export function MockTool() {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string[]>(MOCK_PRESETS[0].fields);
  const [count, setCount] = useState(5);
  const [rows, setRows] = useState<Row[]>(() => generateRows(MOCK_PRESETS[0].fields, 5));
  const [preset, setPreset] = useState<string>('person');

  const generate = (fieldIds = selected, n = count) => {
    if (!fieldIds.length) {
      message.warning('请至少勾选一个字段');
      return;
    }
    setRows(generateRows(fieldIds, Math.min(Math.max(n, 1), 200)));
  };

  const applyPreset = (key: string) => {
    setPreset(key);
    const p = MOCK_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setSelected(p.fields);
    generate(p.fields, count);
  };

  const columns: ColumnsType<Row> = useMemo(
    () =>
      selected.map((id) => ({
        title: MOCK_FIELD_MAP[id]?.label ?? id,
        dataIndex: id,
        key: id,
        ellipsis: true,
        width: 160,
        render: (v: string) => <span style={{ fontFamily: 'SF Mono, Menlo, Consolas, monospace', fontSize: 12 }}>{v}</span>,
      })),
    [selected],
  );

  const csv = useMemo(() => toCsv(selected, rows), [selected, rows]);
  const json = useMemo(
    () => JSON.stringify(rows.map((r) => Object.fromEntries(selected.map((id) => [id, r[id]]))), null, 2),
    [selected, rows],
  );
  const tsv = useMemo(
    () => toTsv(selected.map((id) => MOCK_FIELD_MAP[id]?.label ?? id), rows.map((r) => selected.map((id) => r[id] ?? ''))),
    [selected, rows],
  );

  const downloadCsv = () => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mock-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        批量生成联调测试数据：身份证、统一社会信用代码、银行卡号均通过对应国标校验位，可直接用于表单校验。
      </Paragraph>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Segmented
          value={preset}
          onChange={(v) => applyPreset(String(v))}
          options={MOCK_PRESETS.map((p) => ({ label: p.label, value: p.key }))}
          block
        />

        <div style={{ border: '1px solid rgba(5,5,5,0.06)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
          {GROUP_ORDER.map((group) => {
            const fields = MOCK_FIELDS.filter((f) => f.group === group);
            if (!fields.length) return null;
            return (
              <div key={group} style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{GROUP_LABELS[group]}</Text>
                <Checkbox.Group
                  value={selected}
                  onChange={(v) => {
                    setSelected(v as string[]);
                    setPreset('custom');
                  }}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}
                  options={fields.map((f) => ({ label: f.label, value: f.id }))}
                />
              </div>
            );
          })}
          <Space wrap size={8} style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>数量</Text>
            <InputNumber min={1} max={200} value={count} onChange={(v) => setCount(v ?? 1)} size="small" style={{ width: 72 }} />
            <Button type="primary" size="small" icon={<ThunderboltOutlined />} onClick={() => generate()}>
              生成
            </Button>
            <Button size="small" onClick={() => setSelected([])}>清空选择</Button>
            <Tag>{selected.length} 个字段 · {rows.length} 行</Tag>
          </Space>
        </div>

        <Space wrap size={8}>
          <CopyBtn size="small" text={csv} successText="已复制 CSV">复制 CSV</CopyBtn>
          <CopyBtn size="small" text={json} successText="已复制 JSON">复制 JSON</CopyBtn>
          <CopyBtn size="small" text={tsv} successText="已复制（可直接粘贴进 Excel）">复制表格</CopyBtn>
          <Button size="small" icon={<DownloadOutlined />} onClick={downloadCsv}>下载 CSV</Button>
        </Space>

        {rows.length && selected.length ? (
          <Table<Row>
            size="small"
            rowKey={(_r, i) => String(i)}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 'max-content', y: 320 }}
          />
        ) : (
          <div className="empty-hint">勾选字段后点击「生成」</div>
        )}
      </Space>
    </div>
  );
}