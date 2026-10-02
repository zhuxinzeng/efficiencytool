// JSON 工具：格式化（缩进 2/4）、压缩、校验，错误信息直接展示
import { useMemo, useState } from 'react';
import { Alert, Button, Input, Segmented, Space, Typography } from 'antd';
import { CompressOutlined, FormatPainterOutlined } from '@ant-design/icons';
import { CopyBtn } from '../../components/CopyBtn';

const { Paragraph } = Typography;

export function JsonTool() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState(2);
  const [output, setOutput] = useState('');
  const [jsonError, setJsonError] = useState('');

  const process = (minify: boolean) => {
    try {
      const value = JSON.parse(input);
      setOutput(JSON.stringify(value, null, minify ? 0 : indent));
      setJsonError('');
    } catch (e) {
      setOutput('');
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };

  // 输入变化即清除错误与输出
  const handleChange = (v: string) => {
    setInput(v);
    setOutput('');
    setJsonError('');
  };

  const lines = useMemo(() => output.split('\n').length, [output]);

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        JSON 格式化、压缩与校验；解析错误会展示浏览器给出的位置信息。
      </Paragraph>

      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Input.TextArea
          placeholder='粘贴 JSON 文本，如 {"name":"测试","list":[1,2,3]}'
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          autoSize={{ minRows: 4, maxRows: 10 }}
          allowClear
        />

        <Space wrap>
          <Button type="primary" icon={<FormatPainterOutlined />} disabled={!input.trim()} onClick={() => process(false)}>
            格式化
          </Button>
          <Segmented
            value={indent}
            onChange={(v) => setIndent(v as number)}
            options={[
              { label: '2 空格', value: 2 },
              { label: '4 空格', value: 4 },
            ]}
          />
          <Button icon={<CompressOutlined />} disabled={!input.trim()} onClick={() => process(true)}>
            压缩
          </Button>
        </Space>

        {jsonError && <Alert id="json-error" type="error" showIcon message="JSON 解析失败" description={jsonError} />}

        {output && (
          <div>
            <pre className="result-pre" style={{ maxHeight: 320 }}>{output}</pre>
            <CopyBtn text={output} block style={{ marginTop: 8 }}>复制结果（共 {lines} 行）</CopyBtn>
          </div>
        )}
      </Space>
    </div>
  );
}
