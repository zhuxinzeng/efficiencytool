// 算法自检脚本：npm run verify
// 覆盖：国标测试向量、批量生成自洽性、名称与代码的地区一致性
import assert from 'node:assert/strict';
import { usccCheckChar, validateUscc, generateUscc, parseUscc } from '../src/utils/uscc.ts';
import { orgCodeCheckChar, validateOrgCode, randomOrgCode } from '../src/utils/orgcode.ts';
import { validateIdCard, randomIdCard } from '../src/utils/random-data.ts';
import { generateCompanies, TEST_PREFIX } from '../src/utils/company.ts';
import { REGIONS } from '../src/utils/regions.ts';
import {
  base64ToBytes, decodeBase64Text, detectKind, encodeBase64Text, hexToText, textToHex,
  unicodeEscape, unicodeUnescape,
} from '../src/utils/codec.ts';
import {
  colorScale, contrastRatio, parseColor, toHex, toHslString, toOklchString, wcag,
} from '../src/utils/color.ts';
import { generateRows, MOCK_FIELDS, toCsv } from '../src/utils/mock-data.ts';
import { parseDelimited } from '../src/utils/file-to-markdown.ts';

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  PASS  ${label}`);
}

console.log('== 国标测试向量 ==');
check('GB 32100-2015 附录 B：前 17 位 91350100M000100Y4 校验码应为 3', () => {
  assert.equal(usccCheckChar('91350100M000100Y4'), '3');
});
check('GB 32100-2015 附录 B：91350100M000100Y43 校验通过', () => {
  assert.ok(validateUscc('91350100M000100Y43').valid);
});
check('GB 11714-1997 附录 B：本体 D2143569 校验码应为 X', () => {
  assert.equal(orgCodeCheckChar('D2143569'), 'X');
});
check('GB 32100 主体标识码样例：M000100Y4 通过 GB 11714 校验', () => {
  assert.ok(validateOrgCode('M000100Y4'));
});

console.log('== 批量生成自洽（10000 条） ==');
check('统一社会信用代码全部通过双层校验', () => {
  for (let i = 0; i < 10000; i++) {
    const code = generateUscc('330106');
    const result = validateUscc(code);
    assert.ok(result.valid, `第 ${i} 条校验失败：${code} ${result.message}`);
  }
});
check('组织机构代码全部通过 GB 11714 校验', () => {
  for (let i = 0; i < 10000; i++) {
    assert.ok(validateOrgCode(randomOrgCode()));
  }
});
check('身份证号全部通过 GB 11643 校验', () => {
  for (let i = 0; i < 10000; i++) {
    assert.ok(validateIdCard(randomIdCard()));
  }
});

console.log('== 企业信息一致性 ==');
check('名称带（测）前缀、代码通过校验、名称与代码行政区划一致', () => {
  for (let i = 0; i < 2000; i++) {
    const info = generateCompanies(1)[0];
    assert.ok(info.name.startsWith(TEST_PREFIX), `前缀缺失：${info.name}`);
    assert.ok(validateUscc(info.creditCode).valid, `校验失败：${info.creditCode}`);
    const region = REGIONS.find((r) => r.city === info.region);
    assert.ok(region, `未知地区：${info.region}`);
    assert.ok(
      region!.codes.includes(info.creditCode.slice(2, 8)),
      `地区不一致：${info.region} vs ${info.creditCode.slice(2, 8)}`,
    );
    const parts = parseUscc(info.creditCode);
    assert.ok(parts, `解析失败：${info.creditCode}`);
    assert.equal(parts!.category, '91', '应为企业（91）');
  }
});

console.log('== 编码全家桶 ==');
check('Base64 中文往返（UTF-8）', () => {
  const text = '效率工具箱 / efficiencytool ✅';
  const b64 = encodeBase64Text(text);
  assert.equal(decodeBase64Text(b64), text);
});
check('Base64URL 不含 + / =，且可解回原文', () => {
  const text = 'a+b/c?d=e&f=中文';
  const urlSafe = encodeBase64Text(text, true);
  assert.ok(!/[+/=]/.test(urlSafe));
  assert.equal(decodeBase64Text(urlSafe), text);
});
check('Hex 往返（含中文）', () => {
  const text = 'Hello 效率';
  assert.equal(hexToText(textToHex(text)), text);
  assert.equal(hexToText(textToHex(text, true, ' ')), text);
});
check('Unicode 转义往返（含增补平面字符）', () => {
  const text = '中文😀';
  assert.equal(unicodeUnescape(unicodeEscape(text)), text);
  assert.equal(unicodeUnescape(unicodeEscape(text, true)), text);
});
check('自动识别：Base64 / Hex / Unicode / HTML 实体', () => {
  assert.equal(detectKind('5Lit5paH'), 'base64');
  assert.equal(detectKind('e4b8ade69687'), 'hex');
  assert.equal(detectKind('\\u4e2d\\u6587'), 'unicode');
  assert.equal(detectKind('&#20013;&#25991;'), 'html');
});
check('Base64 解码二进制不产生乱码（应报错）', () => {
  assert.throws(() => decodeBase64Text('//79'), /UTF-8/);
  assert.ok(base64ToBytes('SGVsbG8=').length === 5);
});

console.log('== 颜色工具 ==');
check('HEX / RGB / HSL 解析一致', () => {
  const a = parseColor('#1677ff');
  const b = parseColor('rgb(22, 119, 255)');
  const c = parseColor('hsl(215, 100%, 54%)');
  assert.ok(a && b && c);
  assert.equal(toHex(a!), '#1677ff');
  assert.equal(toHex(b!), '#1677ff');
  // HSL 只保留整数百分比，允许每通道 ±2 的往返误差
  assert.ok(Math.max(Math.abs(c!.r - a!.r), Math.abs(c!.g - a!.g), Math.abs(c!.b - a!.b)) <= 2);
});
check('OKLCH 往返误差可接受', () => {
  const base = parseColor('#1677ff')!;
  const oklch = toOklchString(base);
  const back = parseColor(oklch);
  assert.ok(back, `解析失败：${oklch}`);
  assert.ok(Math.abs(back!.r - base.r) <= 1 && Math.abs(back!.g - base.g) <= 1 && Math.abs(back!.b - base.b) <= 1);
});
check('WCAG 对比度：黑白为 21:1，同色为 1:1', () => {
  const black = parseColor('#000000')!;
  const white = parseColor('#ffffff')!;
  assert.ok(Math.abs(contrastRatio(black, white) - 21) < 0.01);
  assert.equal(contrastRatio(black, black), 1);
  assert.ok(wcag(black, white).aaaNormal);
  assert.ok(!wcag(white, white).aaNormal);
});
check('色阶 9 级，中间为原色', () => {
  const base = parseColor('#1677ff')!;
  const scale = colorScale(base);
  assert.equal(scale.length, 9);
  assert.equal(toHex(scale[4]), toHex(base));
  assert.ok(toHslString(base).startsWith('hsl('));
});

console.log('== Mock 数据 ==');
check('全部字段可生成且非空', () => {
  const rows = generateRows(MOCK_FIELDS.map((f) => f.id), 20);
  assert.equal(rows.length, 20);
  for (const row of rows) {
    for (const f of MOCK_FIELDS) assert.ok(row[f.id]?.length, `字段 ${f.id} 为空`);
  }
});
check('Mock 的身份证 / 信用代码 / 银行卡通过校验', () => {
  const rows = generateRows(['idCard', 'creditCode', 'bankCard'], 200);
  for (const row of rows) {
    assert.ok(validateIdCard(row.idCard), `身份证失败：${row.idCard}`);
    assert.ok(validateUscc(row.creditCode).valid, `信用代码失败：${row.creditCode}`);
    const digitsOnly = row.bankCard.split('').map(Number);
    let sum = 0;
    // Luhn：从右往左，校验位不翻倍，每隔一位翻倍
    for (let i = 0; i < digitsOnly.length; i++) {
      let n = digitsOnly[digitsOnly.length - 1 - i];
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    assert.equal(sum % 10, 0, `银行卡 Luhn 失败：${row.bankCard}`);
  }
});
check('CSV 导出带表头与 BOM', () => {
  const rows = generateRows(['name', 'mobile'], 3);
  const csv = toCsv(['name', 'mobile'], rows);
  assert.ok(csv.startsWith('\uFEFF姓名,手机号'));
  assert.equal(csv.trim().split('\n').length, 4);
});

console.log('== 文件转 Markdown ==');
check('CSV 解析支持引号包裹、逗号与换行', () => {
  const rows = parseDelimited('a,b\n"x,1","y""2"\n3,4', ',');
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'y"2'], ['3', '4']]);
});

console.log(`\n全部通过：${passed} 组断言 ✅`);
