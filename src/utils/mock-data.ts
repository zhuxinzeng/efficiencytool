// Mock 数据生成：个人信息 / 企业信息 / 接口字段，生成结果可直接复制或导出 CSV
// 校验位（身份证 GB 11643、统一社会信用代码 GB 32100）与真实规则一致，可直接用于联调
import { randomChineseName, randomEmail, randomIdCard, randomMobile } from './random-data';
import { generateCompany } from './company';
import { randomRegion, randomRegionCode } from './regions';

export type MockGroup = 'person' | 'company' | 'api' | 'misc';

export interface MockField {
  id: string;
  label: string;
  group: MockGroup;
  gen: () => string;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function digits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r % 4) + 8;
    return v.toString(16);
  });
}

const STREETS = ['中山路', '人民路', '建设路', '解放路', '科技大道', '文三路', '天府大道', '珠江路', '望江路', '创意大道'];
const DISTRICTS = ['高新区', '西湖区', '朝阳区', '天河区', '浦东新区', '武侯区', '雨花台区', '洪山区', '雁塔区', '江北区'];
const UA_LIST = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
];
const PLATE_CITIES = ['京', '沪', '粤B', '浙A', '苏E', '川A', '鄂A', '陕A', '津', '渝'];
const PLATE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** 银行卡号（Luhn 校验通过，6222 开头模拟储蓄卡） */
function randomBankCard(): string {
  const body = `6222${digits(11)}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let n = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check;
}

function randomAddress(): string {
  const region = randomRegion();
  return `${region.city}市${pick(DISTRICTS)}${pick(STREETS)}${1 + Math.floor(Math.random() * 300)}号`;
}

function randomPassword(): string {
  const pool = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  let s = '';
  for (let i = 0; i < 12; i++) s += pool[Math.floor(Math.random() * pool.length)];
  return s;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function randomDateTime(): string {
  const now = Date.now();
  const t = now - Math.floor(Math.random() * 90 * 24 * 3600 * 1000);
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const MOCK_FIELDS: MockField[] = [
  { id: 'name', label: '姓名', group: 'person', gen: randomChineseName },
  { id: 'gender', label: '性别', group: 'person', gen: () => pick(['男', '女']) },
  { id: 'age', label: '年龄', group: 'person', gen: () => String(18 + Math.floor(Math.random() * 43)) },
  { id: 'mobile', label: '手机号', group: 'person', gen: randomMobile },
  { id: 'email', label: '邮箱', group: 'person', gen: randomEmail },
  { id: 'idCard', label: '身份证号', group: 'person', gen: () => randomIdCard() },
  { id: 'address', label: '地址', group: 'person', gen: randomAddress },
  { id: 'city', label: '城市', group: 'person', gen: () => `${randomRegion().city}市` },
  { id: 'postcode', label: '邮编', group: 'person', gen: () => `${1 + Math.floor(Math.random() * 8)}${digits(5)}` },
  { id: 'company', label: '企业名称', group: 'company', gen: () => generateCompany({ withPrefix: false }).name },
  { id: 'creditCode', label: '信用代码', group: 'company', gen: () => generateCompany().creditCode },
  { id: 'regionCode', label: '行政区划码', group: 'company', gen: randomRegionCode },
  { id: 'tel', label: '座机', group: 'company', gen: () => `0${digits(2)}-8${digits(7)}` },
  { id: 'uuid', label: 'UUID', group: 'api', gen: uuid },
  { id: 'token', label: 'Token', group: 'api', gen: () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('') },
  { id: 'ip', label: 'IPv4', group: 'api', gen: () => `${1 + Math.floor(Math.random() * 223)}.${digits(1)}${digits(1)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}` },
  { id: 'url', label: 'URL', group: 'api', gen: () => `https://${pick(['api', 'dev', 'test', 'm'])}.example.com/${pick(['v1', 'v2'])}/${pick(['user', 'order', 'item', 'pay'])}/${digits(4)}` },
  { id: 'userAgent', label: 'User-Agent', group: 'api', gen: () => pick(UA_LIST) },
  { id: 'timestamp', label: '时间戳', group: 'api', gen: () => String(Math.floor(Date.now() / 1000)) },
  { id: 'datetime', label: '日期时间', group: 'api', gen: randomDateTime },
  { id: 'date', label: '日期', group: 'api', gen: () => randomDateTime().slice(0, 10) },
  { id: 'amount', label: '金额', group: 'api', gen: () => (Math.random() * 9999).toFixed(2) },
  { id: 'integer', label: '整数', group: 'api', gen: () => String(1 + Math.floor(Math.random() * 999)) },
  { id: 'boolean', label: '布尔值', group: 'api', gen: () => pick(['true', 'false']) },
  { id: 'plate', label: '车牌号', group: 'misc', gen: () => `${pick(PLATE_CITIES)}${pick(PLATE_CHARS.split(''))}${digits(5)}` },
  { id: 'bankCard', label: '银行卡号', group: 'misc', gen: randomBankCard },
  { id: 'color', label: '颜色值', group: 'misc', gen: () => `#${[...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('')}` },
  { id: 'password', label: '密码', group: 'misc', gen: randomPassword },
];

export const MOCK_FIELD_MAP: Record<string, MockField> = Object.fromEntries(MOCK_FIELDS.map((f) => [f.id, f]));

export const MOCK_PRESETS: { key: string; label: string; fields: string[] }[] = [
  { key: 'person', label: '个人信息', fields: ['name', 'gender', 'mobile', 'email', 'idCard', 'address'] },
  { key: 'company', label: '企业信息', fields: ['company', 'creditCode', 'regionCode', 'tel', 'address'] },
  { key: 'api', label: '接口字段', fields: ['uuid', 'name', 'mobile', 'amount', 'timestamp', 'boolean'] },
];

/** 按字段与数量生成二维数据 */
export function generateRows(fieldIds: string[], count: number): Record<string, string>[] {
  const fields = fieldIds.map((id) => MOCK_FIELD_MAP[id]).filter(Boolean);
  return Array.from({ length: count }, () => {
    const row: Record<string, string> = {};
    for (const f of fields) row[f.id] = f.gen();
    return row;
  });
}

/** 行数据 → CSV（带 BOM，Excel 打开中文不乱码） */
export function toCsv(fieldIds: string[], rows: Record<string, string>[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = fieldIds.map((id) => esc(MOCK_FIELD_MAP[id]?.label ?? id)).join(',');
  const body = rows.map((r) => fieldIds.map((id) => esc(r[id] ?? '')).join(','));
  return `\uFEFF${[header, ...body].join('\n')}`;
}