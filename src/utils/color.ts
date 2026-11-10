// 颜色工具：解析（HEX / RGB / HSL / OKLCH / 具名色）、格式互转、对比度（WCAG）、色阶生成
// 解析失败时返回 null；带 alpha 的颜色在计算对比度时按白底合成

export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function parseHex(input: string): RGBA | null {
  const m = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(m)) return null;
  if (m.length === 3 || m.length === 4) {
    const [r, g, b, a] = [...m].map((c) => parseInt(c + c, 16));
    return { r, g, b, a: m.length === 4 ? a / 255 : 1 };
  }
  if (m.length === 6 || m.length === 8) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    const a = m.length === 8 ? parseInt(m.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

function num(token: string, max: number): number {
  const t = token.trim();
  if (t.endsWith('%')) return (parseFloat(t) / 100) * max;
  return parseFloat(t);
}

function parseRgbLike(input: string): RGBA | null {
  const m = input.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const r = clamp(Math.round(num(parts[0], 255)), 0, 255);
  const g = clamp(Math.round(num(parts[1], 255)), 0, 255);
  const b = clamp(Math.round(num(parts[2], 255)), 0, 255);
  const a = parts[3] == null ? 1 : clamp(num(parts[3], 1), 0, 1);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b, a };
}

export function hslToRgb(h: number, s: number, l: number, a = 1): RGBA {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
    a,
  };
}

function parseHslLike(input: string): RGBA | null {
  const m = input.match(/^hsla?\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]);
  const s = num(parts[1], 1);
  const l = num(parts[2], 1);
  const a = parts[3] == null ? 1 : clamp(num(parts[3], 1), 0, 1);
  if ([h, s, l].some(Number.isNaN)) return null;
  return hslToRgb(h, s, l, a);
}

function parseOklchLike(input: string): RGBA | null {
  const m = input.match(/^oklch\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
  const C = parseFloat(parts[1]);
  const H = parseFloat(parts[2]);
  const a = parts[3] == null ? 1 : clamp(num(parts[3], 1), 0, 1);
  if ([L, C, H].some(Number.isNaN)) return null;
  return oklchToRgba(L, C, H, a);
}

/** 解析任意 CSS 颜色字符串；识别不了返回 null */
export function parseColor(input: string): RGBA | null {
  const text = input.trim();
  if (!text) return null;
  const hex = parseHex(text);
  if (hex) return hex;
  const rgb = parseRgbLike(text);
  if (rgb) return rgb;
  const hsl = parseHslLike(text);
  if (hsl) return hsl;
  const oklch = parseOklchLike(text);
  if (oklch) return oklch;

  // 交给浏览器解析（具名色、hwb、lab、color() 等）
  if (typeof document !== 'undefined') {
    const el = document.createElement('span');
    el.style.color = '';
    el.style.color = text;
    if (el.style.color) {
      el.style.display = 'none';
      document.body.appendChild(el);
      const computed = getComputedStyle(el).color;
      document.body.removeChild(el);
      const fromComputed = parseRgbLike(computed) ?? parseOklchLike(computed);
      if (fromComputed) return fromComputed;
    }
  }
  return null;
}

export function toHex(c: RGBA, withAlpha = false): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return withAlpha && c.a < 1 ? base + h(c.a * 255) : base;
}

export function toRgbString(c: RGBA): string {
  return c.a < 1
    ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Number(c.a.toFixed(3))})`
    : `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

export function toHslString(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c);
  const alpha = c.a < 1 ? `, ${Number(c.a.toFixed(3))}` : '';
  return c.a < 1
    ? `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%${alpha})`
    : `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

export function rgbToHsl(c: RGBA): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(Math.round(c * 255), 0, 255);
}

/** sRGB → OKLCH */
export function rgbToOklch(c: RGBA): { l: number; c: number; h: number } {
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.sqrt(A * A + B * B);
  let hue = (Math.atan2(B, A) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l: L, c: chroma, h: hue };
}

/** OKLCH → sRGB */
export function oklchToRgba(L: number, C: number, H: number, a = 1): RGBA {
  const hRad = (H * Math.PI) / 180;
  const A = C * Math.cos(hRad);
  const B = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), a };
}

export function toOklchString(c: RGBA): string {
  const { l, c: chroma, h } = rgbToOklch(c);
  return `oklch(${(l * 100).toFixed(1)}% ${chroma.toFixed(3)} ${h.toFixed(1)})`;
}

/** 相对亮度（WCAG 2.1） */
export function relativeLuminance(c: RGBA): number {
  const [r, g, b] = [c.r, c.g, c.b].map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 前景/背景对比度；半透明色按白底合成 */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export interface WcagResult {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  /** 是否可用于非文本 UI 元素（3:1） */
  ui: boolean;
}

export function wcag(fg: RGBA, bg: RGBA): WcagResult {
  const ratio = contrastRatio(fg, bg);
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
    ui: ratio >= 3,
  };
}

/** 线性混合：weight 为 b 的占比 */
export function mix(a: RGBA, b: RGBA, weight: number): RGBA {
  const w = clamp(weight, 0, 1);
  return {
    r: Math.round(a.r * (1 - w) + b.r * w),
    g: Math.round(a.g * (1 - w) + b.g * w),
    b: Math.round(a.b * (1 - w) + b.b * w),
    a: a.a * (1 - w) + b.a * w,
  };
}

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };

/** 生成 9 级色阶：由浅到深，第 5 级为原色 */
export function colorScale(c: RGBA): RGBA[] {
  const steps: RGBA[] = [];
  for (let i = 4; i >= 1; i--) steps.push(mix(c, WHITE, i / 5));
  steps.push(c);
  for (let i = 1; i <= 4; i++) steps.push(mix(c, BLACK, i / 5));
  return steps;
}