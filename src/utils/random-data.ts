// 随机数据生成：中文姓名、手机号、身份证号（GB 11643 校验位）、邮箱
import { randomRegionCode } from './regions';

export type Gender = '男' | '女';

const SURNAMES =
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';

const GIVEN_CHARS =
  '伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超霞平刚桂香玉华健峰博文辉鹏飞宇欣怡佳俊子萱昊雨桐诗琪梦洁彤宸逸泽铭瑞晨曦悦欣然思远志成天龙若涵芷晴';

/** 真实手机号段（三大运营商主流段） */
const MOBILE_PREFIXES = [
  '130', '131', '132', '133', '135', '136', '137', '138', '139',
  '150', '151', '152', '153', '155', '156', '157', '158', '159',
  '166', '170', '176', '177', '178',
  '180', '181', '182', '183', '184', '185', '186', '187', '188', '189',
  '191', '192', '193', '195', '196', '197', '198', '199',
];

/** 身份证校验：前 17 位权重与校验码表（GB 11643-1999） */
const IDCARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const IDCARD_CHECK_TABLE = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

/** 邮箱域名 */
const EMAIL_DOMAINS = ['qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com', 'sina.com'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** 随机中文姓名 */
export function randomChineseName(): string {
  const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  const givenLength = Math.random() < 0.8 ? 2 : 1;
  let given = '';
  for (let i = 0; i < givenLength; i++) {
    given += GIVEN_CHARS[Math.floor(Math.random() * GIVEN_CHARS.length)];
  }
  // 姓名用字池偏中性
  return surname + given;
}

/** 随机手机号（真实号段） */
export function randomMobile(): string {
  return pick(MOBILE_PREFIXES) + randomDigits(8);
}

/** 身份证校验位计算（GB 11643-1999） */
export function idCardCheckChar(first17: string): string | null {
  if (!/^\d{17}$/.test(first17)) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(first17[i]) * IDCARD_WEIGHTS[i];
  return IDCARD_CHECK_TABLE[sum % 11];
}

/** 校验 18 位身份证号 */
export function validateIdCard(code: string): boolean {
  if (!/^\d{17}[\dX]$/.test(code)) return false;
  const check = idCardCheckChar(code.slice(0, 17));
  return check === code[17];
}

/** 随机身份证号：真实行政区划 + 出生日期（默认 18~60 岁）+ 性别可控 + 国标校验位 */
export function randomIdCard(options: { gender?: Gender; minAge?: number; maxAge?: number } = {}): string {
  const { gender, minAge = 18, maxAge = 60 } = options;
  const now = new Date();
  const age = minAge + Math.floor(Math.random() * (maxAge - minAge + 1));
  const birth = new Date(now.getFullYear() - age, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28));
  const y = String(birth.getFullYear()).padStart(4, '0');
  const m = String(birth.getMonth() + 1).padStart(2, '0');
  const d = String(birth.getDate()).padStart(2, '0');
  // 顺序码第 3 位（第 17 位整体）奇数 = 男，偶数 = 女
  let seq = randomDigits(2);
  seq += gender === '男' ? String(1 + 2 * Math.floor(Math.random() * 5)) : String(2 * (1 + Math.floor(Math.random() * 4)));
  const first17 = `${randomRegionCode()}${y}${m}${d}${seq}`;
  const check = idCardCheckChar(first17);
  if (!check) throw new Error('身份证生成失败'); // 理论不可达
  return first17 + check;
}

/** 随机邮箱 */
export function randomEmail(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  let local = '';
  const len = 6 + Math.floor(Math.random() * 5);
  for (let i = 0; i < len; i++) {
    local += Math.random() < 0.7 ? letters[Math.floor(Math.random() * letters.length)] : String(Math.floor(Math.random() * 10));
  }
  return `${local}@${pick(EMAIL_DOMAINS)}`;
}

export interface RandomPerson {
  name: string;
  mobile: string;
  idCard: string;
  email: string;
}

/** 生成一条完整的个人信息 */
export function generateRandomPerson(gender?: Gender): RandomPerson {
  return {
    name: randomChineseName(),
    mobile: randomMobile(),
    idCard: randomIdCard({ gender }),
    email: randomEmail(),
  };
}
