// 取色器 + 颜色转换：屏幕取色、任意 CSS 颜色互转（HEX/RGB/HSL/OKLCH）、WCAG 对比度、色阶
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, ColorPicker, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { AimOutlined, SwapOutlined } from '@ant-design/icons';
import { CopyBtn } from '../../components/CopyBtn';
import {
  colorScale, contrastRatio, mix, parseColor, toHex, toHslString, toOklchString, toRgbString, wcag,
  type RGBA,
} from '../../utils/color';

const { Paragraph, Text } = Typography;

interface EyeDropperResult {
  sRGBHex: string;
}

declare global {
  interface Window {
    EyeDropper?: new () => { open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult> };
  }
}

const hasEyeDropper = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="field-row" style={{ marginTop: 6 }}>
      <span className="field-label" style={{ width: 64 }}>{label}</span>
      <div className="field-value">
        <Text code style={{ fontSize: 12 }}>{value}</Text>
        <CopyBtn size="small" type="text" text={value} />
      </div>
    </div>
  );
}

function LevelTag({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <Tag color={ok ? 'success' : 'error'}>{children} {ok ? '通过' : '不通过'}</Tag>;
}

export function ColorTool() {
  const [fgText, setFgText] = useState('#1677ff');
  const [bgText, setBgText] = useState('#ffffff');
  const [recent, setRecent] = useState<string[]>(['#1677ff', '#722ed1', '#52c41a', '#faad14', '#ff4d4f']);

  const fg = useMemo(() => parseColor(fgText), [fgText]);
  const bg = useMemo(() => parseColor(bgText) ?? { r: 255, g: 255, b: 255, a: 1 }, [bgText]);

  const pushRecent = (hex: string) => {
    setRecent((prev) => [hex, ...prev.filter((c) => c !== hex)].slice(0, 12));
  };

  const applyColor = (value: string) => {
    setFgText(value);
    const parsed = parseColor(value);
    if (parsed) pushRecent(toHex(parsed));
  };

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      applyColor(result.sRGBHex);
    } catch {
      // 用户取消取色，无需提示
    }
  };

  // 半透明前景按背景合成后再算对比度，接近真实观感
  const effectiveFg: RGBA | null = fg ? (fg.a < 1 ? mix(bg, fg, fg.a) : fg) : null;
  const contrast = effectiveFg ? contrastRatio(effectiveFg, bg) : 0;
  const levels = effectiveFg ? wcag(effectiveFg, bg) : null;
  const scale = fg ? colorScale(fg) : [];

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        屏幕取色 + 颜色格式互转（HEX / RGB / HSL / OKLCH），并对前景/背景做 WCAG 对比度校验，可直接复制成 CSS 变量或色阶。
      </Paragraph>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap size={8}>
          <Tooltip title={hasEyeDropper ? '从屏幕任意位置取色' : '当前浏览器不支持 EyeDropper'}>
            <Button icon={<AimOutlined />} onClick={pickFromScreen} disabled={!hasEyeDropper}>
              屏幕取色
            </Button>
          </Tooltip>
          <ColorPicker
            value={fg ? toHex(fg) : '#1677ff'}
            showText
            onChangeComplete={(c) => applyColor(c.toHexString())}
          />
          <Input
            value={fgText}
            onChange={(e) => setFgText(e.target.value)}
            placeholder="#1677ff / rgb(22,119,255) / oklch(62% 0.19 259)"
            style={{ width: 240 }}
            allowClear
          />
        </Space>

        {!fg && <Alert type="warning" showIcon message="无法识别该颜色，请输入 HEX / RGB / HSL / OKLCH 或具名色" />}

        {fg && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
              <div
                style={{
                  flex: 'none', width: 96, height: 96, borderRadius: 12,
                  background: toHex(fg, true), border: '1px solid rgba(5,5,5,0.08)',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <ValueRow label="HEX" value={toHex(fg)} />
                <ValueRow label="RGB" value={toRgbString(fg)} />
                <ValueRow label="HSL" value={toHslString(fg)} />
                <ValueRow label="OKLCH" value={toOklchString(fg)} />
                <ValueRow label="CSS 变量" value={`--color-primary: ${toHex(fg)};`} />
              </div>
            </div>

            <div className="tool-section">
              <div className="tool-section-title">WCAG 对比度</div>
              <Space wrap size={8} align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>背景</Text>
                <ColorPicker
                  value={toHex(bg)}
                  showText
                  onChangeComplete={(c) => setBgText(c.toHexString())}
                />
                <Input
                  value={bgText}
                  onChange={(e) => setBgText(e.target.value)}
                  style={{ width: 160 }}
                  allowClear
                />
                <Button
                  size="small"
                  icon={<SwapOutlined />}
                  onClick={() => {
                    const nextFg = bgText;
                    setBgText(fgText);
                    setFgText(nextFg);
                  }}
                >
                  互换
                </Button>
                <Tag color={contrast >= 7 ? 'success' : contrast >= 4.5 ? 'blue' : contrast >= 3 ? 'warning' : 'error'}>
                  {contrast.toFixed(2)} : 1
                </Tag>
              </Space>
              {levels && (
                <Space wrap size={6} style={{ marginTop: 8 }}>
                  <LevelTag ok={levels.aaNormal}>AA 正文</LevelTag>
                  <LevelTag ok={levels.aaLarge}>AA 大字</LevelTag>
                  <LevelTag ok={levels.aaaNormal}>AAA 正文</LevelTag>
                  <LevelTag ok={levels.aaaLarge}>AAA 大字</LevelTag>
                  <LevelTag ok={levels.ui}>UI 元素 3:1</LevelTag>
                </Space>
              )}
              <div
                style={{
                  marginTop: 8, padding: '10px 12px', borderRadius: 10,
                  background: toHex(bg, true), color: toHex(fg, true),
                  border: '1px solid rgba(5,5,5,0.06)', fontSize: 13,
                }}
              >
                示例文本：前端联调中的正文与说明文字
              </div>
            </div>

            <div className="tool-section">
              <div className="tool-section-title">色阶（点击取用）</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {scale.map((c) => (
                  <button
                    key={toHex(c)}
                    type="button"
                    title={toHex(c)}
                    onClick={() => applyColor(toHex(c))}
                    style={{
                      flex: 1, height: 44, borderRadius: 8, cursor: 'pointer',
                      background: toHex(c), border: '1px solid rgba(5,5,5,0.08)',
                    }}
                  />
                ))}
              </div>
              <CopyBtn
                size="small"
                type="text"
                style={{ marginTop: 4 }}
                text={scale.map((c, i) => `--color-${i + 1}: ${toHex(c)};`).join('\n')}
                successText="已复制色阶变量"
              >
                复制色阶为 CSS 变量
              </CopyBtn>
            </div>
          </>
        )}

        <div className="tool-section">
          <div className="tool-section-title">最近使用</div>
          <Space wrap size={6}>
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => applyColor(c)}
                title={c}
                style={{
                  width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                  background: c, border: '1px solid rgba(5,5,5,0.12)',
                }}
              />
            ))}
          </Space>
        </div>
      </Space>
    </div>
  );
}