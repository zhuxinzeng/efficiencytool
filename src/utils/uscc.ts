// 统一社会信用代码（GB 32100-2015）：18 位
//   第 1 位 登记管理部门 | 第 2 位 机构类别 | 第 3~8 位 登记管理机关行政区划码 | 第 9~17 位 主体标识码（组织机构代码） | 第 18 位 校验码
// 校验：C18 = 31 - MOD(Σ(Ci×Wi), 31)，为 31 时取 0；字符值 = 31 字符集下标（去掉 I/O/S/V/Z）
// 权重：Wi = MOD(3^(i-1), 31)
import { randomOrgCode, validateOrgCode } from './orgcode';

/** GB 32100-2015 附录 A 代码字符集（31 个字符，不含 I/O/S/V/Z） */
export const USCC_CHARSET = '0123456789ABCDEFGHJKLMNPQRTUWXY';
/** 各位置加权因子（i = 1..17），对应表 4 */
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

/** 登记管理部门（第 1 位） */
export const USCC_DEPARTMENTS: Record<string, string> = {
  '1': '机构编制',
  '2': '民政',
  '3': '外交',
  '4': '司法行政',
  '5': '文化',
  '6': '农业',
  '7': '其他',
  '8': '其他',
  '9': '工商（市场监管）',
};

/** 常见机构类别（第 1~2 位组合） */
export const USCC_CATEGORIES: Record<string, string> = {
  '11': '机关',
  '12': '事业单位',
  '21': '社会团体',
  '22': '民办非企业单位',
  '23': '基金会',
  '91': '企业',
  '92': '个体工商户',
  '93': '农民专业合作社',
};

/** 计算第 18 位校验码；输入前 17 位，返回字符集内字符或 null（含非法字符） */
export function usccCheckChar(first17: string): string | null {
  if (first17.length !== 17) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const value = USCC_CHARSET.indexOf(first17[i]);
    if (value < 0) return null;
    sum += value * USCC_WEIGHTS[i];
  }
  const c18 = (31 - (sum % 31)) % 31;
  return USCC_CHARSET[c18];
}

export interface UsccCheckResult {
  valid: boolean;
  /** 校验失败原因，valid 时为空 */
  message?: string;
}

/** 校验完整 18 位统一社会信用代码（格式 + 外层校验码 + 内层组织机构代码） */
export function validateUscc(code: string): UsccCheckResult {
  if (code.length !== 18) {
    return { valid: false, message: `长度应为 18 位，当前 ${code.length} 位` };
  }
  const badChar = [...code].find((ch) => USCC_CHARSET.indexOf(ch) < 0);
  if (badChar) {
    return { valid: false, message: `包含非法字符「${badChar}」（仅允许 0-9 与大写字母，不含 I/O/S/V/Z）` };
  }
  const expected = usccCheckChar(code.slice(0, 17));
  if (expected !== code[17]) {
    return { valid: false, message: `校验码不符：应为「${expected}」，实际为「${code[17]}」` };
  }
  if (!validateOrgCode(code.slice(8, 17))) {
    return { valid: false, message: '内层组织机构代码（第 9~17 位）未通过 GB 11714 校验' };
  }
  return { valid: true };
}

export interface UsccParts {
  /** 第 1 位 */
  department: string;
  departmentName: string;
  /** 第 2 位与第 1 位组合 */
  category: string;
  categoryName: string;
  /** 第 3~8 位 */
  regionCode: string;
  /** 第 9~17 位 */
  orgCode: string;
  /** 第 18 位 */
  checkChar: string;
}

/** 解析代码结构（不做校验，长度/字符集不合法时返回 null） */
export function parseUscc(code: string): UsccParts | null {
  if (code.length !== 18) return null;
  if ([...code].some((ch) => USCC_CHARSET.indexOf(ch) < 0)) return null;
  const category = code.slice(0, 2);
  return {
    department: code[0],
    departmentName: USCC_DEPARTMENTS[code[0]] ?? '其他',
    category,
    categoryName: USCC_CATEGORIES[category] ?? '其他机构',
    regionCode: code.slice(2, 8),
    orgCode: code.slice(8, 17),
    checkChar: code[17],
  };
}

/**
 * 生成统一社会信用代码
 * @param regionCode 6 位行政区划码（第 3~8 位）
 * @param category   2 位部门+机构类别，默认 '91'（企业）
 */
export function generateUscc(regionCode: string, category = '91'): string {
  if (!/^\d{6}$/.test(regionCode)) throw new Error('行政区划码应为 6 位数字');
  if (!/^[0-9A-Z]{2}$/.test(category)) throw new Error('机构类别应为 2 位数字或大写字母');
  const first17 = `${category}${regionCode}${randomOrgCode()}`;
  const check = usccCheckChar(first17);
  if (!check) throw new Error('信用代码生成失败'); // 理论不可达：字符集已受控
  return first17 + check;
}
