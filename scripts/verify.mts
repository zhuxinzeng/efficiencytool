// 算法自检脚本：npm run verify
// 覆盖：国标测试向量、批量生成自洽性、名称与代码的地区一致性
import assert from 'node:assert/strict';
import { usccCheckChar, validateUscc, generateUscc, parseUscc } from '../src/utils/uscc.ts';
import { orgCodeCheckChar, validateOrgCode, randomOrgCode } from '../src/utils/orgcode.ts';
import { validateIdCard, randomIdCard } from '../src/utils/random-data.ts';
import { generateCompanies, TEST_PREFIX } from '../src/utils/company.ts';
import { REGIONS } from '../src/utils/regions.ts';

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

console.log(`\n全部通过：${passed} 组断言 ✅`);
