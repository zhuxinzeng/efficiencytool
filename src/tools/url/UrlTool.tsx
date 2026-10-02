// URL 编解码：encodeURIComponent / encodeURI 双模式，实时转换，解码失败给出提示
import { useMemo, useState } from 'react';
import { Alert, Input, Radio, Segmented, Space, Typography } from 'antd';
import { CopyBtn } from '../../components/CopyBtn';

const { Paragraph } = Typography;

type Mode = 'encode' | 'decode';
type Scope = 'component' | 'uri';

export function UrlTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('encode');
  const [scope, setScope] = useState<Scope>('component');

  const result = useMemo(() => {
    if (!input) return { ok: true as const, text: '' };
    try {
      const text =
        mode === 'encode'
          ? scope === 'component'
            ? encodeURIComponent(input)
            : encodeURI(input)
          : scope === 'component'
            ? decodeURIComponent(input)
            : decodeURI(input);
      return { ok: true as const, text };
    } catch (e) {
      return { ok: false as const, text: e instanceof Error ? e.message : String(e) };
    }
  }, [input, mode, scope]);

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        URL 编解码：Component 模式转义全部保留字符（一般用于参数值），URI 模式仅转义非法字符（用于完整地址）。
      </Paragraph>

      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space wrap>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { label: '编码', value: 'encode' },
              { label: '解码', value: 'decode' },
            ]}
          />
          <Radio.Group
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="component">encodeURIComponent</Radio.Button>
            <Radio.Button value="uri">encodeURI</Radio.Button>
          </Radio.Group>
        </Space>

        <Input.TextArea
          placeholder={mode === 'encode' ? '输入待编码的 URL 或文本' : '输入待解码的 URL 编码文本'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 6 }}
          allowClear
        />

        {result.ok ? (
          result.text ? (
            <div>
              <pre className="result-pre">{result.text}</pre>
              <CopyBtn text={result.text} block style={{ marginTop: 8 }}>复制结果</CopyBtn>
            </div>
          ) : null
        ) : (
          <Alert type="error" showIcon message="转换失败" description={result.text} />
        )}
      </Space>
    </div>
  );
}
