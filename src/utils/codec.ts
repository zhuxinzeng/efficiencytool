// 编码/解码纯函数：Base64、Base64URL、Hex、Unicode 转义、HTML 实体
// 全部本地计算，不依赖后端；UTF-8 往返使用 TextEncoder / TextDecoder

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');
const utf8DecoderStrict = new TextDecoder('utf-8', { fatal: true });

export type CodecKind = 'base64' | 'base64url' | 'hex' | 'unicode' | 'html';

export const CODEC_LABELS: Record<CodecKind, string> = {
  base64: 'Base64',
  base64url: 'Base64URL',
  hex: 'Hex',
  unicode: 'Unicode',
  html: 'HTML 实体',
};

/** 字节 → Base64（分块避免超长参数导致栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Base64 → 字节（容错：忽略空白，自动补齐 padding） */
export function base64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!cleaned) return new Uint8Array();
  if (/[^A-Za-z0-9+/=]/.test(cleaned)) throw new Error('包含非 Base64 字符');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 文本 → Base64（UTF-8 安全） */
export function encodeBase64Text(text: string, urlSafe = false): string {
  const b64 = bytesToBase64(utf8Encoder.encode(text));
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

/** Base64 → 文本；非 UTF-8 二进制会报错，避免出现乱码 */
export function decodeBase64Text(input: string): string {
  const bytes = base64ToBytes(input);
  try {
    return utf8DecoderStrict.decode(bytes);
  } catch {
    throw new Error('解码结果不是合法 UTF-8 文本（可能是图片等二进制数据）');
  }
}

/** 文本 → Hex（UTF-8 字节） */
export function textToHex(text: string, upper = false, separator = ''): string {
  const hex = [...utf8Encoder.encode(text)].map((b) => b.toString(16).padStart(2, '0')).join(separator);
  return upper ? hex.toUpperCase() : hex;
}

/** Hex → 文本（允许 0x 前缀、空格、逗号、换行分隔） */
export function hexToText(input: string): string {
  const cleaned = input.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (!cleaned) return '';
  if (cleaned.length % 2 !== 0) throw new Error('Hex 长度为奇数，无法按字节解析');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return utf8Decoder.decode(bytes);
}

/** 文本 → \uXXXX 转义（可选 \u{XXXXX} 形式，支持增补平面字符） */
export function unicodeEscape(text: string, brace = false): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 128) {
      out += ch;
    } else if (brace) {
      out += `\\u{${cp.toString(16).toUpperCase()}}`;
    } else if (cp > 0xffff) {
      // 增补平面：转为代理对
      const high = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const low = ((cp - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${high.toString(16).toUpperCase()}\\u${low.toString(16).toUpperCase()}`;
    } else {
      out += `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return out;
}

/** \uXXXX / \u{XXXXX} / \xXX → 文本 */
export function unicodeUnescape(text: string): string {
  return text
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** 文本 → HTML 实体（保留 ASCII 可见字符，其余转数字实体） */
export function htmlEntityEncode(text: string): string {
  return text.replace(/[&<>"'\u0080-\uffff]/g, (ch) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    if (map[ch]) return map[ch];
    return `&#x${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase()};`;
  });
}

/** HTML 实体 → 文本（用 textarea 解析，不执行脚本） */
export function htmlEntityDecode(text: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

/** 自动识别编码类型：返回最可能的一种，识别不出返回 null */
export function detectKind(input: string): CodecKind | null {
  const text = input.trim();
  if (!text) return null;
  if (/\\u\{?[0-9a-fA-F]{2,6}\}?|\\x[0-9a-fA-F]{2}/.test(text)) return 'unicode';
  if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/.test(text)) return 'html';

  const compact = text.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0 && compact.length >= 4 && /[a-fA-F]/.test(compact)) {
    return 'hex';
  }
  if (/^[A-Za-z0-9\-_+/=]+$/.test(compact) && compact.length >= 4) {
    try {
      const decoded = decodeBase64Text(compact);
      const printable = [...decoded].filter((c) => c.charCodeAt(0) >= 32 || c === '\n' || c === '\t').length;
      if (decoded.length > 0 && printable / decoded.length > 0.9) {
        return /[-_]/.test(compact) && !/[+/]/.test(compact) ? 'base64url' : 'base64';
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** 统一转换入口 */
export function convert(kind: CodecKind, text: string, direction: 'encode' | 'decode'): string {
  if (!text) return '';
  switch (kind) {
    case 'base64':
      return direction === 'encode' ? encodeBase64Text(text) : decodeBase64Text(text);
    case 'base64url':
      return direction === 'encode' ? encodeBase64Text(text, true) : decodeBase64Text(text);
    case 'hex':
      return direction === 'encode' ? textToHex(text) : hexToText(text);
    case 'unicode':
      return direction === 'encode' ? unicodeEscape(text) : unicodeUnescape(text);
    case 'html':
      return direction === 'encode' ? htmlEntityEncode(text) : htmlEntityDecode(text);
    default:
      return '';
  }
}

/** 猜测图片 MIME（用于裸 Base64 预览） */
export function guessImageMime(base64: string): string | null {
  const head = base64.slice(0, 12);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('PHN2Zy')) return 'image/svg+xml';
  return null;
}