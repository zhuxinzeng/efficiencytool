// HAR 数据解析：请求列表、GraphQL 识别、重定向链构建、URL query 参数对比
export interface HarHeader {
  name: string;
  value: string;
}

/** 面板内部使用的精简 HAR 条目模型 */
export interface HarEntryLite {
  id: string;
  startedDateTime: string;
  /** 耗时 ms */
  time: number;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  requestHeaders: HarHeader[];
  responseHeaders: HarHeader[];
  /** 请求体文本（无则为空字符串） */
  postData: string;
  /** 请求体 mime（无则空） */
  postMime: string;
  /** 响应体文本（devtools 仅在已查看时可能有） */
  responseText: string;
  /** chrome HAR 扩展字段：重定向目标 */
  redirectUrl: string | null;
}

let seq = 0;

/** chrome.devtools.network.Request / getHAR 条目（HARFormatEntry）→ 内部精简模型 */
export function toHarLite(entry: HARFormatEntry): HarEntryLite {
  seq += 1;
  const headers = (list: HarHeader[] | undefined): HarHeader[] =>
    (list ?? []).map((h) => ({ name: h.name, value: h.value }));
  return {
    id: `har-${seq}-${entry.startedDateTime}`,
    startedDateTime: entry.startedDateTime,
    time: entry.time ?? 0,
    method: entry.request.method,
    url: entry.request.url,
    status: entry.response.status ?? 0,
    resourceType: (entry as { _resourceType?: string })._resourceType ?? 'other',
    requestHeaders: headers(entry.request.headers as HarHeader[] | undefined),
    responseHeaders: headers(entry.response.headers as HarHeader[] | undefined),
    postData: entry.request.postData?.text ?? '',
    postMime: entry.request.postData?.mimeType ?? '',
    responseText: entry.response.content?.text ?? '',
    redirectUrl: (entry.response as { redirectURL?: string }).redirectURL ?? null,
  };
}

export interface GraphQLRequest {
  query: string;
  variables: string;
  operationName: string;
}

/** 识别 GraphQL 请求：JSON body 含 query 字段，或 URL 明显指向 graphql 端点 */
export function extractGraphQL(entry: HarEntryLite): GraphQLRequest | null {
  const looksGraphql = /graphql/i.test(entry.url);
  if (entry.postData) {
    try {
      const parsed = JSON.parse(entry.postData) as { query?: unknown; variables?: unknown; operationName?: unknown };
      if (typeof parsed.query === 'string') {
        return {
          query: parsed.query,
          variables: typeof parsed.variables === 'string' ? parsed.variables : JSON.stringify(parsed.variables ?? {}, null, 2),
          operationName: typeof parsed.operationName === 'string' ? parsed.operationName : '',
        };
      }
    } catch {
      // body 不是 JSON：URL 指向 graphql 且 body 直接是 query 文本时按原生 query 处理
      if (looksGraphql && /^(query|mutation|subscription|\s*\{)/i.test(entry.postData.trim())) {
        return { query: entry.postData, variables: '{}', operationName: '' };
      }
    }
  }
  return null;
}

export interface QueryDiff {
  /** 相比上一步丢失的参数名 */
  lost: string[];
  /** 相比上一步新增的参数名 */
  gained: string[];
  /** 值发生变化的参数名 */
  changed: string[];
}

/** 对比两个 URL 的 query 参数差异 */
export function diffQuery(fromUrl: string, toUrl: string): QueryDiff {
  const parse = (url: string): URLSearchParams => {
    try {
      return new URL(url).searchParams;
    } catch {
      return new URLSearchParams('');
    }
  };
  const from = parse(fromUrl);
  const to = parse(toUrl);
  const lost: string[] = [];
  const gained: string[] = [];
  const changed: string[] = [];
  from.forEach((value, key) => {
    if (!to.has(key)) lost.push(key);
    else if (to.get(key) !== value) changed.push(key);
  });
  to.forEach((_v, key) => {
    if (!from.has(key)) gained.push(key);
  });
  return { lost, gained, changed };
}

export interface RedirectStep {
  status: number;
  url: string;
  location: string | null;
  method: string;
  /** 较上一步的参数差异 */
  diff: QueryDiff | null;
}

export interface RedirectChain {
  steps: RedirectStep[];
  /** 链中全部跳转步数（不含最终落地） */
  redirects: number;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** 构建重定向链：30x 条目按时间序匹配 redirectURL → 下一跳请求，串成链 */
export function buildRedirectChains(entries: HarEntryLite[]): RedirectChain[] {
  const sorted = [...entries].sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime));
  const chains: RedirectChain[] = [];
  const usedStart = new Set<string>();

  sorted.forEach((entry, index) => {
    if (!REDIRECT_STATUS.has(entry.status) || usedStart.has(entry.id)) return;
    // 一条链从该 30x 开始
    const steps: RedirectStep[] = [];
    let current = entry;
    let guard = 0;
    while (current && guard < 20) {
      guard += 1;
      const location =
        current.responseHeaders.find((h) => h.name.toLowerCase() === 'location')?.value ??
        current.redirectUrl ??
        null;
      const prevUrl = steps.length > 0 ? steps[steps.length - 1].url : null;
      steps.push({
        status: current.status,
        url: current.url,
        location,
        method: current.method,
        diff: prevUrl ? diffQuery(prevUrl, current.url) : null,
      });
      const target = current.redirectUrl ?? location;
      if (!target || !REDIRECT_STATUS.has(current.status)) break;
      // 在后续条目中查找 URL 匹配的下一跳
      const next = sorted
        .slice(index + 1)
        .find((e) => e.url === target || e.url === resolveUrl(current.url, target));
      if (!next) {
        // 浏览器最终落点可能未被记录（如被拦截），链到 location 为止
        break;
      }
      usedStart.add(next.id);
      current = next;
    }
    if (steps.length >= 1 && steps.some((s) => REDIRECT_STATUS.has(s.status))) {
      chains.push({ steps, redirects: steps.filter((s) => REDIRECT_STATUS.has(s.status)).length });
    }
  });

  return chains.reverse(); // 最新链在前
}

/** 相对 Location → 绝对 URL */
function resolveUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).href;
  } catch {
    return maybeRelative;
  }
}
