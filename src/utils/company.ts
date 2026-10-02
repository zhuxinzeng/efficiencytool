// 企业名称生成：行政区划 + 字号 + 行业表述 + 组织形式，前缀「（测）」
// 信用代码与名称共用同一行政区划，保证数据自洽
import { randomRegion, type Region } from './regions';
import { generateUscc } from './uscc';

/** 字号用字池（常见企业用字，观感真实） */
const TRADE_NAME_CHARS =
  '宏达瑞丰中科青云天启汇智朗博星辰悦优联正元恒信创锐志航慧拓维远睿晨曦卓立嘉泰鑫源隆基盛景同创合众禾明轩越承泽翰诚耀领联众嘉禾锦程腾跃旭峰朗科';

/** 行业表述 */
const INDUSTRIES = [
  '科技', '信息技术', '网络科技', '软件', '智能科技', '数据科技', '电子商务',
  '商贸', '贸易', '文化传媒', '广告', '生物科技', '新材料', '新能源',
  '供应链管理', '企业管理', '通讯技术', '电子技术', '互联网', '信息咨询',
];

/** 组织形式 */
const FORMS = ['有限公司', '有限责任公司', '股份有限公司', '集团有限公司'];

/** 测试标识前缀（用户要求：企业名称前加「（测）」） */
export const TEST_PREFIX = '（测）';

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 生成 2~3 字字号（用字不重复） */
function randomTradeName(): string {
  const length = Math.random() < 0.75 ? 2 : 3;
  const used = new Set<string>();
  let name = '';
  while (name.length < length) {
    const ch = TRADE_NAME_CHARS[Math.floor(Math.random() * TRADE_NAME_CHARS.length)];
    if (used.has(ch)) continue;
    used.add(ch);
    name += ch;
  }
  return name;
}

export interface CompanyInfo {
  /** 企业名称，如「（测）杭州瑞丰科技有限公司」 */
  name: string;
  /** 18 位统一社会信用代码（通过 GB 32100 校验） */
  creditCode: string;
  /** 名称与代码共同使用的行政区划 */
  region: string;
}

/** 生成单条企业信息 */
export function generateCompany(options: { withPrefix?: boolean } = {}): CompanyInfo {
  const { withPrefix = true } = options;
  const region: Region = randomRegion();
  const regionCode = pick(region.codes);
  const name = `${region.city}${randomTradeName()}${pick(INDUSTRIES)}${pick(FORMS)}`;
  return {
    name: withPrefix ? `${TEST_PREFIX}${name}` : name,
    creditCode: generateUscc(regionCode),
    region: region.city,
  };
}

/** 批量生成（逐条独立，允许重复率极低） */
export function generateCompanies(count: number, options: { withPrefix?: boolean } = {}): CompanyInfo[] {
  return Array.from({ length: count }, () => generateCompany(options));
}
