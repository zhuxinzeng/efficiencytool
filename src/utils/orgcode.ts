// 组织机构代码（GB 11714-1997）：8 位本体 + 1 位校验码，共 9 位
// 校验：C9 = 11 - MOD(Σ(Ci×Wi), 11)；结果为 10 时用 X，为 11 时用 0
// 字符值采用 36 字符集索引（A=10 … Z=35），与统一社会信用代码的 31 字符集（附录 A）不同，注意区分。

/** GB 11714-1997 代码字符集（36 个字符） */
const ORG_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 加权因子（位置 1~8） */
const ORG_WEIGHTS = [3, 7, 9, 10, 5, 8, 4, 2];

/** 本体可用字母：为兼容统一社会信用代码外层 31 字符集，避开 I/O/S/V/Z */
const ORG_SAFE_LETTERS = 'ABCDEFGHJKLMNPQRTUWXY';

function pickChar(chars: string): string {
  return chars[Math.floor(Math.random() * chars.length)];
}

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

/** 计算校验码：C9 = 11 - MOD(Σ(Ci×Wi), 11)；10 → X，11 → 0 */
export function orgCodeCheckChar(body: string): string | null {
  if (body.length !== 8) return null;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const value = ORG_CHARSET.indexOf(body[i]);
    if (value < 0) return null;
    sum += value * ORG_WEIGHTS[i];
  }
  const c9 = 11 - (sum % 11);
  if (c9 === 10) return 'X';
  if (c9 === 11) return '0';
  return String(c9);
}

/** 校验 9 位组织机构代码（GB 11714） */
export function validateOrgCode(code: string): boolean {
  if (code.length !== 9) return false;
  const check = orgCodeCheckChar(code.slice(0, 8));
  return check !== null && check === code[8];
}

/** 随机生成 9 位组织机构代码：约半数为纯数字，半数为字母开头（更贴近真实观感） */
export function randomOrgCode(): string {
  let body: string;
  if (Math.random() < 0.5) {
    body = Array.from({ length: 8 }, randomDigit).join('');
  } else {
    // 形如 MA1234XY：首位 M，次位/末位随机安全字母，其余数字
    body = `M${pickChar(ORG_SAFE_LETTERS)}${Array.from({ length: 5 }, randomDigit).join('')}${pickChar(ORG_SAFE_LETTERS)}`;
  }
  const check = orgCodeCheckChar(body);
  if (!check) throw new Error('组织机构代码生成失败'); // 理论不可达：字符集已受控
  return body + check;
}
