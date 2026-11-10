// 编码全家桶：Base64 / Base64URL / Hex / Unicode 转义 / HTML 实体 互转，附 Base64 图片预览
import { useMemo, useState } from 'react';
import {
  Alert, Button, Collapse, Image, Input, Radio, Segmented, Space, Tag, Typography, Upload,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { CopyBtn } from '../../components/CopyBtn';
import {
  CODEC_LABELS, convert, detectKind, guessImageMime, type CodecKind,
} from '../../utils/codec';

const { Paragraph, Text } = Typography;

type Kind = CodecKind | 'auto';
type Direction = 'encode' | 'decode';

const KIND_OPTIONS: { label: string; value: Kind }[] = [
  { label: '自动识别', value: 'auto' },
  { label: 'Base64', value: 'base64' },
  { label: 'Base64URL', value: 'base64url' },
  { label: 'Hex', value: 'hex' },
  { label: 'Unicode', value: 'unicode' },
  { label: 'HTML 实体', value: 'html' },
];

// 窄壳（popup 420px）下选项较多，横向可滚动，避免挤压换行
const kindBarStyle = { overflowX: 'auto' as const, paddingBottom: 2 };

function Base64ImagePanel() {
  const [dataUrl, setDataUrl] = useState('');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const previewSrc = useMemo(() => {
    if (dataUrl) return dataUrl;
    const text = raw.trim();
    if (!text) return '';
    if (/^data:image\//i.test(text)) return text;
    const compact = text.replace(/\s+/g, '');
    const mime = guessImageMime(compact);
    return mime ? `data:${mime};base64,${compact}` : '';
  }, [dataUrl, raw]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setDataUrl(String(reader.result || ''));
      setRaw('');
      setError(null);
    };
    reader.onerror = () => setError('读取文件失败');
    reader.readAsDataURL(file);
    return false;
  };

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space wrap>
        <Upload accept="image/*" showUploadList={false} beforeUpload={readFile}>
          <Button icon={<UploadOutlined />} size="small">选择图片转 Base64</Button>
        </Upload>
        {previewSrc && (
          <CopyBtn size="small" type="text" text={previewSrc} successText="已复制 Data URL">复制 Data URL</CopyBtn>
        )}
      </Space>
      <Input.TextArea
        className="codec-input"
        placeholder="或粘贴 Base64 / Data URL（可省略 data:image/...;base64, 前缀）"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setDataUrl('');
          setError(null);
        }}
        rows={3}
        allowClear
        style={{ resize: 'vertical', minHeight: 72 }}
      />
      {error && <Alert type="error" showIcon message={error} />}
      {previewSrc ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Image src={previewSrc} width={96} style={{ borderRadius: 8, border: '1px solid rgba(5,5,5,0.08)' }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {raw ? `长度约 ${Math.round(raw.replace(/\s+/g, '').length / 1024)} KB（Base64 字符数）` : '来自本地文件'}
          </Text>
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>识别到 PNG / JPEG / GIF / WebP / SVG 时显示预览</Text>
      )}
    </Space>
  );
}

export function CodecTool() {
  const [kind, setKind] = useState<Kind>('auto');
  const [direction, setDirection] = useState<Direction>('decode');
  const [input, setInput] = useState('');

  const detected = useMemo(() => (input.trim() ? detectKind(input) : null), [input]);
  const effectiveKind: CodecKind | null = kind === 'auto' ? detected : kind;

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, text: '' };
    if (!effectiveKind) {
      return { ok: false as const, text: '未能识别编码类型，请手动选择上方类型' };
    }
    try {
      return { ok: true as const, text: convert(effectiveKind, input, direction) };
    } catch (e) {
      return { ok: false as const, text: e instanceof Error ? e.message : String(e) };
    }
  }, [input, effectiveKind, direction]);

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        编码全家桶：Base64 / Base64URL / Hex / Unicode 转义 / HTML 实体互转，纯本地计算。自动识别会根据内容猜测类型，识别失败时手动切换即可。
      </Paragraph>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={kindBarStyle}>
          <Segmented
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            options={KIND_OPTIONS}
            size="small"
          />
        </div>

        <Space wrap size={8}>
          <Radio.Group
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="encode">编码</Radio.Button>
            <Radio.Button value="decode">解码</Radio.Button>
          </Radio.Group>
          {kind === 'auto' && (
            <Tag color={detected ? 'blue' : 'default'}>
              {detected ? `识别为 ${CODEC_LABELS[detected]}` : '等待输入'}
            </Tag>
          )}
        </Space>

        <Input.TextArea
          className="codec-input"
          placeholder={direction === 'encode' ? '输入待编码的文本' : '粘贴待解码的文本，如 SGVsbG8='}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          allowClear
          style={{ resize: 'vertical', minHeight: 96 }}
        />

        {result.ok ? (
          result.text ? (
            <div>
              <pre className="result-pre">{result.text}</pre>
              <Space size={8} style={{ marginTop: 8 }} wrap>
                <CopyBtn type="primary" text={result.text} block>复制结果</CopyBtn>
                <Button size="small" onClick={() => { setInput(result.text); setDirection(direction === 'encode' ? 'decode' : 'encode'); }}>
                  结果反向继续
                </Button>
              </Space>
            </div>
          ) : null
        ) : (
          <Alert type="error" showIcon message="转换失败" description={result.text} />
        )}

        <Collapse
          size="small"
          items={[
            {
              key: 'image',
              label: 'Base64 图片（上传转码 / 粘贴预览）',
              children: <Base64ImagePanel />,
            },
          ]}
        />
      </Space>
    </div>
  );
}