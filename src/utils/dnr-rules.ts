// DNR 规则引擎：将业务规则（API Mock / HTTP 头 / CORS）转换为 declarativeNetRequest 动态规则并全量同步
// 业务规则持久化在 chrome.storage.local，DNR 动态规则 id 从 RULE_ID_BASE 起分段，避免影响其他来源的规则
import { storageGet, storageSet } from '../shared/storage';

/** 本扩展占用的动态规则 id 段起始值 */
const RULE_ID_BASE = 100000;

const KEY_MOCK = 'net.mockRules';
const KEY_HEADER = 'net.headerRules';
const KEY_CORS = 'net.corsConfig';
const KEY_SEQ = 'net.ruleIdSeq';

type DnrResourceType = `${chrome.declarativeNetRequest.ResourceType}`;

/** Mock 拦截的请求类型：接口调用 + 页面 + 子框架 */
const MOCK_RESOURCE_TYPES: DnrResourceType[] = ['xmlhttprequest', 'main_frame', 'sub_frame'];
/** 头修改/CORS 覆盖的请求类型：全量常见类型 */
const HEADER_RESOURCE_TYPES: DnrResourceType[] = [
  'main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'other',
];

export interface MockRule {
  id: number;
  name: string;
  enabled: boolean;
  /** DNR urlFilter，如 https://api.example.com/v1/*（支持 * 通配） */
  urlFilter: string;
  /** 请求方法过滤（空 = 全部） */
  method?: string;
  /** 直接阻断请求（模拟网络失败，不发响应） */
  block: boolean;
  /** 自定义响应的 Content-Type */
  contentType: string;
  /** 自定义响应体（文本） */
  responseBody: string;
  /**
   * 高级模式：不走 DNR，改由后台 chrome.debugger Fetch 拦截，
   * 支持 delayMs / statusCode / failureRate，需在 Mock 工具页开启「高级拦截」总开关
   */
  advanced?: boolean;
  /** 高级模式：响应延迟毫秒（Service Worker 生命周期上限，≤30000） */
  delayMs?: number;
  /** 高级模式：自定义响应状态码（默认 200） */
  statusCode?: number;
  /** 高级模式：随机失败率 0-100，命中时以网络层失败（ERR_FAILED）返回 */
  failureRate?: number;
}

export interface HeaderRule {
  id: number;
  name: string;
  enabled: boolean;
  urlFilter: string;
  /** 修改请求头还是响应头 */
  target: 'request' | 'response';
  /** set 增/改，remove 删 */
  operation: 'set' | 'remove';
  header: string;
  value: string;
}

export interface CorsConfig {
  enabled: boolean;
  /** 生效的 urlFilter（默认匹配全部请求） */
  urlFilter: string;
  /** Access-Control-Allow-Origin，默认 *（开启 credentials 时应为具体源） */
  origin: string;
  /** Access-Control-Allow-Credentials */
  credentials: boolean;
  /** Access-Control-Allow-Headers，默认 * */
  allowHeaders: string;
  /** Access-Control-Allow-Methods，默认 * */
  allowMethods: string;
}

/** 分配下一个业务规则 id（稳定持久） */
export async function nextRuleId(): Promise<number> {
  const seq = await storageGet<number>(KEY_SEQ, RULE_ID_BASE);
  await storageSet(KEY_SEQ, seq + 1);
  return seq;
}

export async function getMockRules(): Promise<MockRule[]> {
  return storageGet<MockRule[]>(KEY_MOCK, []);
}

export async function getHeaderRules(): Promise<HeaderRule[]> {
  return storageGet<HeaderRule[]>(KEY_HEADER, []);
}

export async function getCorsConfig(): Promise<CorsConfig> {
  return storageGet<CorsConfig>(KEY_CORS, {
    enabled: false,
    urlFilter: '*://*/*',
    origin: '*',
    credentials: false,
    allowHeaders: '*',
    allowMethods: '*',
  });
}

/** 保存并立即同步到 DNR */
export async function saveMockRules(rules: MockRule[]): Promise<void> {
  await storageSet(KEY_MOCK, rules);
  await syncAllRules();
}

export async function saveHeaderRules(rules: HeaderRule[]): Promise<void> {
  await storageSet(KEY_HEADER, rules);
  await syncAllRules();
}

export async function saveCorsConfig(config: CorsConfig): Promise<void> {
  await storageSet(KEY_CORS, config);
  await syncAllRules();
}

/** UTF-8 文本 → data URL（响应体中可能含中文） */
function toDataUrl(contentType: string, body: string): string {
  const bytes = new TextEncoder().encode(body);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${contentType || 'text/plain'};charset=utf-8;base64,${btoa(binary)}`;
}

function baseCondition(
  urlFilter: string,
  method: string | undefined,
  resourceTypes: DnrResourceType[],
): chrome.declarativeNetRequest.RuleCondition {
  return {
    urlFilter: urlFilter || '*://*/*',
    resourceTypes,
    ...(method ? { methods: [method] } : {}),
  };
}

/** Mock 规则 → DNR 规则（block 或重定向到 data URL） */
export function mockRuleToDnr(rule: MockRule): chrome.declarativeNetRequest.Rule {
  return {
    id: rule.id,
    priority: 2,
    condition: baseCondition(rule.urlFilter, rule.method || undefined, MOCK_RESOURCE_TYPES),
    action: rule.block
      ? { type: 'block' }
      : {
          type: 'redirect',
          redirect: { url: toDataUrl(rule.contentType, rule.responseBody) },
        },
  };
}

/** HTTP 头规则 → DNR 规则 */
export function headerRuleToDnr(rule: HeaderRule): chrome.declarativeNetRequest.Rule {
  const headerOp: chrome.declarativeNetRequest.ModifyHeaderInfo = {
    header: rule.header,
    operation: rule.operation === 'set' ? 'set' : 'remove',
    ...(rule.operation === 'set' ? { value: rule.value } : {}),
  };
  return {
    id: rule.id,
    priority: 1,
    condition: baseCondition(rule.urlFilter, undefined, HEADER_RESOURCE_TYPES),
    action: {
      type: 'modifyHeaders',
      ...(rule.target === 'request'
        ? { requestHeaders: [headerOp] }
        : { responseHeaders: [headerOp] }),
    },
  };
}

/** CORS 配置 → DNR 规则（注入响应头覆盖原有 CORS 头） */
export function corsConfigToDnr(config: CorsConfig): chrome.declarativeNetRequest.Rule | null {
  if (!config.enabled) return null;
  const ops: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [
    { header: 'Access-Control-Allow-Origin', operation: 'set', value: config.origin || '*' },
    { header: 'Access-Control-Allow-Headers', operation: 'set', value: config.allowHeaders || '*' },
    { header: 'Access-Control-Allow-Methods', operation: 'set', value: config.allowMethods || '*' },
  ];
  if (config.credentials) {
    ops.push({ header: 'Access-Control-Allow-Credentials', operation: 'set', value: 'true' });
  }
  return {
    id: RULE_ID_BASE - 1, // CORS 配置独占一个固定 id（99999）
    priority: 1,
    condition: baseCondition(config.urlFilter, undefined, HEADER_RESOURCE_TYPES),
    action: { type: 'modifyHeaders', responseHeaders: ops },
  };
}

const isOurRule = (r: chrome.declarativeNetRequest.Rule) => r.id >= RULE_ID_BASE - 1;

/**
 * 全量同步：读取业务规则 → 与 DNR 动态规则 diff 后替换
 * 仅管理本扩展 id 段内的规则，不影响其他来源
 */
export async function syncAllRules(): Promise<void> {
  const api = globalThis.chrome?.declarativeNetRequest;
  if (!api) return; // 非扩展环境（浏览器 dev 冒烟）跳过

  const [mocks, headers, cors] = await Promise.all([getMockRules(), getHeaderRules(), getCorsConfig()]);

  const addRules: chrome.declarativeNetRequest.Rule[] = [
    // advanced 规则由后台 chrome.debugger Fetch 拦截处理，不进 DNR（避免双重拦截）
    ...mocks.filter((r) => r.enabled && r.urlFilter && !r.advanced).map(mockRuleToDnr),
    ...headers.filter((r) => r.enabled && r.urlFilter && r.header).map(headerRuleToDnr),
  ];
  const corsRule = corsConfigToDnr(cors);
  if (corsRule) addRules.push(corsRule);

  const existing = (await api.getDynamicRules()).filter(isOurRule);
  await api.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });
}
