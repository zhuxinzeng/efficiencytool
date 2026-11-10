// 全局 webRequest 监听：跨 Tab 捕获 XHR / Fetch / Document
// 与 debugger 单 Tab 录制并存：debugger 当前 tab 优先（能拿响应体），其余 tab 由 webRequest 兜底
// 维护最近 WEBREQ_BUFFER_MS 的滚动缓冲；开始录制时把缓冲并入记录，解决“新开 tab 首屏来不及点开始”的问题
// 注意：webRequest 拿不到响应体；请求体/响应头取决于 Chrome 提供的数据
import {
  WEBREQ_BUFFER_LIMIT, WEBREQ_BUFFER_MS,
  type RecordingEntry,
} from '../shared/debugger-protocol';

/** webRequest 是否可用（浏览器 dev 预览时为 false） */
export const WEBREQ_SUPPORTED =
  typeof chrome !== 'undefined'
  && typeof chrome.webRequest !== 'undefined'
  && typeof chrome.webRequest.onBeforeRequest?.addListener === 'function';

/** SW 端注入的依赖：录制状态、当前 debugger tab、落库/截断函数 */
export interface WebRequestHooks {
  isRecording(): boolean;
  getDebuggerTabId(): number | null;
  addEntries(entries: RecordingEntry[]): void;
  truncateBody(text: string): { body: string; truncated: boolean };
}

export interface WebRequestRecorder {
  supported: boolean;
  setEnabled(enabled: boolean): void;
  flushBuffer(): void;
  clearBuffer(): void;
}

/** 只关心接口与页面导航；其余资源类型直接忽略 */
const ALLOWED_TYPES = new Set(['main_frame', 'sub_frame', 'xmlhttprequest']);
const MAX_PENDING = 800;
const PENDING_TTL = 60_000;

interface PendingWebReq {
  ts: number;
  tabId: number;
  pageUrl: string;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  status: number;
  mimeType: string;
  responseHeaders: Record<string, string>;
}

/** Chrome 类型里没有 documentUrl（实际运行时存在），用宽松结构兜底 */
interface DetailsWithDocumentUrl {
  documentUrl?: string;
}

interface WebReqBody {
  error?: string;
  formData?: Record<string, Array<string | ArrayBuffer>>;
  raw?: Array<{ bytes?: ArrayBuffer; file?: string }>;
}

let enabled = true;
let idSeq = -Date.now();
let buffer: RecordingEntry[] = [];
const pending = new Map<string, PendingWebReq>();
/** main_frame 当前文档 URL：documentUrl 缺失时作为 XHR 的页面归属兜底 */
const tabUrl = new Map<number, string>();

function nextId(): number {
  idSeq -= 1;
  return idSeq;
}

function headersToMap(list?: chrome.webRequest.HttpHeader[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of list ?? []) {
    if (!h.name) continue;
    if (typeof h.value === 'string') out[h.name] = h.value;
    else if (h.binaryValue) out[h.name] = `<binary ${h.binaryValue.byteLength} bytes>`;
    else out[h.name] = '';
  }
  return out;
}

function mimeOf(headers: Record<string, string>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') return value.split(';')[0].trim();
  }
  return '';
}

function decodeBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function bodyToString(body?: WebReqBody): string {
  if (!body) return '';
  if (body.error) return '';
  if (body.raw && body.raw.length > 0) {
    return body.raw.map((item) => {
      if (item.bytes) return decodeBytes(item.bytes);
      if (item.file) return `[file: ${item.file}]`;
      return '';
    }).join('');
  }
  if (body.formData) {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(body.formData)) {
      for (const value of values) {
        if (typeof value === 'string') params.append(key, value);
        else {
          const text = decodeBytes(value);
          params.append(key, text || `<binary ${value.byteLength} bytes>`);
        }
      }
    }
    return params.toString();
  }
  return '';
}

function resourceTypeOf(type: string): string {
  return type === 'xmlhttprequest' ? 'XHR' : 'Document';
}

/** webRequest 详情的最小公共结构（onBeforeRequest 的字段是 SetPartial，不能直接用 WebRequestDetails） */
type WebReqDetails = {
  tabId: number;
  type: string;
  url: string;
  initiator?: string;
};

function pageUrlOf(
  details: WebReqDetails,
  existing?: PendingWebReq,
): string {
  if (details.type === 'main_frame' || details.type === 'sub_frame') return details.url;
  const doc = (details as unknown as DetailsWithDocumentUrl).documentUrl;
  return doc || existing?.pageUrl || tabUrl.get(details.tabId) || details.initiator || '';
}

function isAllowed(
  details: WebReqDetails,
  hooks: WebRequestHooks,
): boolean {
  if (!enabled) return false;
  if (details.tabId < 0) return false;
  if (!ALLOWED_TYPES.has(details.type)) return false;
  // 当前 debugger 正在录这个 tab 时，交给 debugger（可拿响应体），避免重复
  if (hooks.isRecording() && details.tabId === hooks.getDebuggerTabId()) return false;
  return true;
}

function trimBuffer(): void {
  const cutoff = Date.now() - WEBREQ_BUFFER_MS;
  while (buffer.length > 0 && buffer[buffer.length - 1].ts < cutoff) buffer.pop();
  if (buffer.length > WEBREQ_BUFFER_LIMIT) buffer.length = WEBREQ_BUFFER_LIMIT;
}

function deliver(entry: RecordingEntry, hooks: WebRequestHooks): void {
  if (hooks.isRecording()) {
    if (entry.tabId === hooks.getDebuggerTabId()) return;
    hooks.addEntries([entry]);
    return;
  }
  buffer.unshift(entry);
  trimBuffer();
}

function makeEntry(
  p: PendingWebReq,
  patch: Partial<RecordingEntry> = {},
): RecordingEntry {
  const responseHeaders = patch.responseHeaders ?? p.responseHeaders;
  return {
    id: nextId(),
    ts: p.ts,
    pageUrl: p.pageUrl,
    method: p.method,
    url: patch.url ?? p.url,
    resourceType: p.resourceType,
    status: patch.status ?? p.status,
    mimeType: patch.mimeType ?? p.mimeType ?? mimeOf(responseHeaders),
    durationMs: Math.max(0, Date.now() - p.ts),
    requestHeaders: p.requestHeaders,
    requestBody: p.requestBody,
    responseHeaders,
    responseBody: patch.responseBody ?? '',
    responseTruncated: false,
    errorText: patch.errorText,
    source: 'webRequest',
    tabId: p.tabId,
  };
}

function prunePending(): void {
  if (pending.size <= MAX_PENDING) return;
  const cutoff = Date.now() - PENDING_TTL;
  for (const [id, p] of pending) {
    if (p.ts < cutoff) pending.delete(id);
  }
  if (pending.size <= MAX_PENDING) return;
  const sorted = [...pending.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const overflow = sorted.length - MAX_PENDING;
  for (let i = 0; i < overflow; i += 1) pending.delete(sorted[i][0]);
}

function onBeforeRequest(
  details: chrome.webRequest.OnBeforeRequestDetails,
  hooks: WebRequestHooks,
): void {
  if (!isAllowed(details, hooks)) return;
  if (details.type === 'main_frame') tabUrl.set(details.tabId, details.url);

  const existing = pending.get(details.requestId);
  const body = hooks.truncateBody(bodyToString(details.requestBody as WebReqBody | undefined)).body;
  if (existing) {
    // 重定向续跳：保留原始开始时间，更新目标 URL / 方法 / 请求体
    existing.url = details.url || existing.url;
    existing.method = details.method || existing.method;
    existing.pageUrl = pageUrlOf(details, existing) || existing.pageUrl;
    existing.resourceType = resourceTypeOf(details.type);
    if (body) existing.requestBody = body;
    return;
  }

  pending.set(details.requestId, {
    ts: Math.round(details.timeStamp) || Date.now(),
    tabId: details.tabId,
    pageUrl: pageUrlOf(details),
    method: details.method || 'GET',
    url: details.url,
    resourceType: resourceTypeOf(details.type),
    requestHeaders: {},
    requestBody: body,
    status: 0,
    mimeType: '',
    responseHeaders: {},
  });
  prunePending();
}

function onSendHeaders(
  details: chrome.webRequest.OnSendHeadersDetails,
): void {
  if (!enabled) return;
  const p = pending.get(details.requestId);
  if (!p) return;
  p.requestHeaders = headersToMap(details.requestHeaders);
}

function onHeadersReceived(
  details: chrome.webRequest.OnHeadersReceivedDetails,
): void {
  if (!enabled) return;
  const p = pending.get(details.requestId);
  if (!p) return;
  p.status = details.statusCode || p.status;
  p.responseHeaders = headersToMap(details.responseHeaders);
  p.mimeType = mimeOf(p.responseHeaders) || p.mimeType;
}

function onBeforeRedirect(
  details: chrome.webRequest.OnBeforeRedirectDetails,
  hooks: WebRequestHooks,
): void {
  if (!enabled) return;
  const p = pending.get(details.requestId);
  if (!p) return;

  const headers = headersToMap(details.responseHeaders);
  const entry = makeEntry(p, {
    url: details.url || p.url,
    status: details.statusCode || 0,
    mimeType: mimeOf(headers) || p.mimeType,
    responseHeaders: headers,
    responseBody: details.redirectUrl ? `(redirect → ${details.redirectUrl})` : '(redirect)',
  });
  deliver(entry, hooks);

  // 同一个 requestId 继续跟下一跳；下一跳的请求细节由新的 onBeforeRequest/onSendHeaders 补齐
  if (details.type === 'main_frame') tabUrl.set(details.tabId, details.redirectUrl || p.url);
  // 307/308 会保留原请求体；301/302/303 通常转成 GET，清掉旧 body/headers
  const keepBody = details.statusCode === 307 || details.statusCode === 308;
  p.url = details.redirectUrl || p.url;
  p.status = 0;
  p.mimeType = '';
  p.responseHeaders = {};
  if (!keepBody) {
    p.method = 'GET';
    p.requestHeaders = {};
    p.requestBody = '';
  }
}

function onCompleted(
  details: chrome.webRequest.OnCompletedDetails,
  hooks: WebRequestHooks,
): void {
  if (!enabled) return;
  const p = pending.get(details.requestId);
  if (!p) return;

  const finalUrl = details.url || p.url;
  if (details.type === 'main_frame') tabUrl.set(details.tabId, finalUrl);
  const headers = headersToMap(details.responseHeaders);
  const entry = makeEntry(p, {
    url: finalUrl,
    status: details.statusCode || p.status,
    mimeType: mimeOf(headers) || p.mimeType,
    responseHeaders: headers,
  });
  deliver(entry, hooks);
  pending.delete(details.requestId);
}

function onErrorOccurred(
  details: chrome.webRequest.OnErrorOccurredDetails,
  hooks: WebRequestHooks,
): void {
  if (!enabled) return;
  const p = pending.get(details.requestId);
  if (!p) return;
  const entry = makeEntry(p, {
    status: p.status,
    errorText: details.error || 'failed',
  });
  deliver(entry, hooks);
  pending.delete(details.requestId);
}

function setEnabled(next: boolean): void {
  if (!WEBREQ_SUPPORTED) return;
  // 值没变时不清空：SW 冷启动默认先缓冲，storage 读出“仍开启”后要保留唤醒瞬间的请求
  if (enabled === next) return;
  enabled = next;
  buffer = [];
  pending.clear();
}

function flushBuffer(hooks: WebRequestHooks): void {
  if (buffer.length === 0) return;
  const entries = buffer;
  buffer = [];
  hooks.addEntries(entries.map((entry) => ({ ...entry, prebuffer: true })));
}

function clearBuffer(): void {
  buffer = [];
  pending.clear();
}

export function initWebRequestRecorder(hooks: WebRequestHooks): WebRequestRecorder {
  if (!WEBREQ_SUPPORTED) {
    return {
      supported: false,
      setEnabled: () => undefined,
      flushBuffer: () => undefined,
      clearBuffer: () => undefined,
    };
  }

  const filter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'] };

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      onBeforeRequest(details, hooks);
      return undefined;
    },
    filter,
    ['requestBody'],
  );
  chrome.webRequest.onSendHeaders.addListener(
    (details) => onSendHeaders(details),
    filter,
    ['requestHeaders'],
  );
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      onHeadersReceived(details);
      return undefined;
    },
    filter,
    ['responseHeaders'],
  );
  chrome.webRequest.onBeforeRedirect.addListener(
    (details) => onBeforeRedirect(details, hooks),
    filter,
    ['responseHeaders'],
  );
  chrome.webRequest.onCompleted.addListener(
    (details) => onCompleted(details, hooks),
    filter,
    ['responseHeaders'],
  );
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => onErrorOccurred(details, hooks),
    filter,
  );

  // tab 关闭后清掉页面 URL 缓存，避免 tabId 复用时归属错页
  chrome.tabs.onRemoved?.addListener((tabId) => {
    tabUrl.delete(tabId);
  });

  return {
    supported: true,
    setEnabled,
    flushBuffer: () => flushBuffer(hooks),
    clearBuffer,
  };
}