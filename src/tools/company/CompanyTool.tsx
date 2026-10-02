// 企业信息生成：批量生成「（测）」前缀企业名称 + 通过国标校验的统一社会信用代码，附带代码校验器
import { useMemo, useState } from 'react';
import {
  Alert, Button, Divider, Input, InputNumber, Space, Switch, Table, Typography,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { generateCompanies, type CompanyInfo } from '../../utils/company';
import { parseUscc, validateUscc, type UsccParts } from '../../utils/uscc';
import { toTsv } from '../../shared/clipboard';
import { CopyBtn } from '../../components/CopyBtn';
import { useContainerWidth } from '../../shared/useContainerWidth';

const { Text, Paragraph } = Typography;

/** 代码结构详情网格：popup / 全屏共用，auto-fill 自适应列数，窄屏一行 2 个不拥挤 */
function UsccDetailGrid({ parts }: { parts: UsccParts }) {
  return (
    <div className="detail-grid">
      <div>
        <div className="detail-item-label">登记管理部门（第1位）</div>
        <div className="detail-item-value">{parts.departmentName}</div>
      </div>
      <div>
        <div className="detail-item-label">机构类别（第2位）</div>
        <div className="detail-item-value">{parts.categoryName}</div>
      </div>
      <div>
        <div className="detail-item-label">区划码（第3~8位）</div>
        <div className="detail-item-value mono">{parts.regionCode}</div>
      </div>
      <div>
        <div className="detail-item-label">主体标识码（第9~17位）</div>
        <div className="detail-item-value mono">{parts.orgCode}</div>
      </div>
      <div>
        <div className="detail-item-label">校验码（第18位）</div>
        <div className="detail-item-value mono">{parts.checkChar}</div>
      </div>
    </div>
  );
}

export function CompanyTool() {
  const [count, setCount] = useState(5);
  const [withPrefix, setWithPrefix] = useState(true);
  const [rows, setRows] = useState<CompanyInfo[]>(() => generateCompanies(5));
  const [checkInput, setCheckInput] = useState('');
  const { ref, compact } = useContainerWidth<HTMLDivElement>();

  const handleGenerate = () => {
    setRows(generateCompanies(count, { withPrefix }));
  };

  const tsv = useMemo(
    () => toTsv(['企业名称', '统一社会信用代码'], rows.map((r) => [r.name, r.creditCode])),
    [rows],
  );

  const columns: ColumnsType<CompanyInfo> = [
    {
      title: '企业名称',
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: '统一社会信用代码',
      dataIndex: 'creditCode',
      width: 158,
      render: (code: string) => <Text code style={{ fontSize: 12 }}>{code}</Text>,
    },
    {
      title: '操作',
      width: 64,
      render: (_, record) => <CopyBtn size="small" text={`${record.name}\t${record.creditCode}`} />,
    },
  ];

  // 校验器：输入即校验
  const trimmed = checkInput.trim().toUpperCase();
  const check = useMemo(() => {
    if (!trimmed) return null;
    const result = validateUscc(trimmed);
    return { ...result, parts: parseUscc(trimmed) };
  }, [trimmed]);

  return (
    <div ref={ref}>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        生成带「（测）」标识的企业名称，及符合 GB 32100-2015 校验规则的 18 位统一社会信用代码（内层组织机构代码按 GB 11714 生成，双层校验通过）。
      </Paragraph>

      <Space wrap style={{ marginBottom: 12 }} align="center">
        <span className="count-field">
          <span className="count-field-label">数量</span>
          <InputNumber min={1} max={50} value={count} onChange={(v) => setCount(v ?? 1)} controls={false} />
        </span>
        <Switch checked={withPrefix} onChange={setWithPrefix} checkedChildren="（测）前缀" unCheckedChildren="无前缀" />
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerate}>
          生成
        </Button>
        <CopyBtn text={tsv} successText="已复制全部（TSV，可直接粘贴 Excel）">复制全部</CopyBtn>
      </Space>

      {compact ? (
        // 窄壳（popup）：卡片式，名称/代码/结构详情全部完整展示
        <div className="data-card-list">
          {rows.map((r) => {
            const parts = parseUscc(r.creditCode);
            return (
              <div className="data-card" key={r.creditCode}>
                <div className="data-card-head">
                  <div className="data-card-title">{r.name}</div>
                  <CopyBtn size="small" type="text" text={`${r.name}\t${r.creditCode}`} />
                </div>
                <div>
                  <span className="code-chip code-chip-primary">{r.creditCode}</span>
                </div>
                {parts && <UsccDetailGrid parts={parts} />}
              </div>
            );
          })}
        </div>
      ) : (
        <Table<CompanyInfo>
          rowKey={(r) => r.creditCode}
          columns={columns}
          dataSource={rows}
          size="small"
          pagination={false}
          scroll={{ y: 300 }}
          expandable={{
            expandedRowRender: (record) => {
              const parts = parseUscc(record.creditCode);
              if (!parts) return null;
              return <UsccDetailGrid parts={parts} />;
            },
            rowExpandable: (record) => Boolean(parseUscc(record.creditCode)),
          }}
        />
      )}

      <Divider orientation="left" plain>校验任意统一社会信用代码</Divider>
      <Input
        placeholder="输入 18 位统一社会信用代码，如 91350100M000100Y43"
        allowClear
        value={checkInput}
        onChange={(e) => setCheckInput(e.target.value)}
      />
      {check && (
        <div style={{ marginTop: 12 }}>
          {check.valid ? (
            <Alert
              type="success"
              showIcon
              message="校验通过：符合 GB 32100-2015 编码规则"
              description={check.parts ? <UsccDetailGrid parts={check.parts} /> : undefined}
            />
          ) : (
            <Alert type="error" showIcon message="校验不通过" description={check.message} />
          )}
        </div>
      )}
    </div>
  );
}