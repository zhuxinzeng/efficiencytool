// chrome.debugger 引擎（Service Worker 端）
// WS 消息监控 / 网络限速 / 高级 Mock 三类能力共享一次 debugger attach，仅作用于开启时所在的活动标签页
// 监听器全部在模块顶层同步注册（保证 SW 每次被事件唤醒后仍可接收 debugger / runtime 事件）
import {
  getMockRules, type MockRule,
} from '../utils/dnr-rules';
import { storageGet, storageSet } from '../shared/storage';
import {
  THROTTLE_PRESETS, WS_PAYLOAD_LIMIT,
  KEY_RECORDING_ENTRIES, REC_BODY_LIMIT, REC_ENTRY_LIMIT,
  type DebugPush, type DebugRequest, type DebugResponse,
  type DebuggerState, type RecordingEntry, type ThrottlePreset, type ThrottlePresetId, type WsEvent,
} from '../shared/debugger-protocol';

/** 与 UI 端 debugger-client 保持一致的持久化 key */
const KEY_STATE = 'debugger.state';

const OFFLINE: DebuggerState = {
  tabId: null,
  wsMonitoring: false,
  advMockActive: false,
  recording: false,
  throttlePreset: 'off',
  throttleCustom: { latency: 0, download: 0, upload: 0 },
  wsConnections: {},
  recordingCount: 0,
};

/** 运行时状态（SW 内存；tabId/开关/限速持久化，wsConnections 仅内存） */
let state: DebuggerState = { ...OFFLINE };

/** WS 事件批量缓冲：避免高频帧时消息风暴 */
let eventBuffer: WsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let eventSeq = 0;

// ---------- 基础封装 ----------

const hasDebugger = typeof globalThis.chrome !== 'undefined' && typeof chrome.debugger?.attach === 'function';

function target() {
  return { tabId: state.tabId! };
}

function sendCommand<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  return chrome.debugger.sendCommand(target(), method, params) as unknown as Promise<T>;
}

async function persist(): Promise<void> {
  await storageSet(KEY_STATE, {
    tabId: state.tabId,
    wsMonitoring: state.wsMonitoring,
    advMockActive: state.advMockActive,
    recording: state.recording,
    throttlePreset: state.throttlePreset,
    throttleCustom: state.throttleCustom,
    recordingCount: state.recordingCount,
  });
}

function pushState(): void {
  if (typeof chrome.runtime?.sendMessage === 'function') {
    chrome.runtime.sendMessage({ type: 'dbg/state', state } satisfies DebugPush).catch(() => {
      // 无 UI 接收（popup/页面未打开）时忽略
    });
  }
}

/** 任一功能开启即需要 attach */
const anyFeatureOn = () =>
  state.wsMonitoring || state.advMockActive || state.recording || state.throttlePreset !== 'off';

/** 查询活动标签页（无需 tabs 权限；host_permissions 使 url 可见） */
async function activeTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = tabs[0]?.id;
  if (id == null) throw new Error('未找到当前活动标签页');
  return id;
}

/** 确保已 attach 到活动标签页（幂等：重复 attach 的报错静默忽略） */
async function ensureAttached(): Promise<void> {
  if (state.tabId == null) {
    const tabId = await activeTabId();
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (e) {
      // 本扩展已附加（SW 重启等场景）→ 视为成功；其余错误（页面不可调试等）抛出
      if (!String(e).includes('Already attached')) throw e;
    }
    state.tabId = tabId;
    await persist();
    pushState();
  }
  await sendCommand('Network.enable');
}

/** 全部功能关闭后释放 debugger（消除浏览器调试横幅） */
async function maybeDetach(): Promise<void> {
  if (anyFeatureOn() || state.tabId == null) return;
  try {
    await chrome.debugger.detach({ tabId: state.tabId });
  } catch {
    // 已被用户手动取消
  }
  state = { ...OFFLINE };
  await persist();
  pushState();
}

// ---------- WS 消息监控 ----------

interface FramePayload {
  opcode: number;
  payloadData: string;
}

function decodeFrame(frame: FramePayload): { payload: string; size: number } {
  // CDP 约定：文本帧 payloadData 即 UTF-8 文本；二进制帧为 base64
  if (frame.opcode === 2) {
    let size = 0;
    try {
      size = atob(frame.payloadData).length;
    } catch {
      size = frame.payloadData.length;
    }
    return { payload: `<binary ${size} bytes>`, size };
  }
  const text = frame.payloadData || '';
  if (text.length > WS_PAYLOAD_LIMIT) {
    return { payload: `${text.slice(0, WS_PAYLOAD_LIMIT)}…(已截断)`, size: text.length };
  }
  return { payload: text, size: text.length };
}

function emitFrame(wsId: string, direction: 'sent' | 'received', frame: FramePayload): void {
  const { payload, size } = decodeFrame(frame);
  const event: WsEvent = {
    id: ++eventSeq,
    ts: Date.now(),
    wsId,
    url: state.wsConnections[wsId] ?? '',
    direction,
    opcode: frame.opcode,
    payload,
    size,
  };
  eventBuffer.push(event);
  if (flushTimer == null) {
    // 250ms 批量推送：高频帧场景下避免 runtime 消息风暴
    flushTimer = setTimeout(flushEvents, 250);
  }
}

function flushEvents(): void {
  flushTimer = null;
  if (eventBuffer.length === 0) return;
  const events = eventBuffer;
  eventBuffer = [];
  if (typeof chrome.runtime?.sendMessage === 'function') {
    chrome.runtime.sendMessage({ type: 'dbg/wsEvents', events } satisfies DebugPush).catch(() => {
      // 无 UI 接收时丢弃
    });
  }
}

// ---------- 网络限速 ----------

async function applyThrottleParams(p: { latency: number; download: number; upload: number }): Promise<void> {
  await sendCommand('Network.emulateNetworkConditions', {
    offline: false,
    latency: Math.max(0, Math.round(p.latency)),
    downloadThroughput: Math.max(0, Math.round(p.download)),
    uploadThroughput: Math.max(0, Math.round(p.upload)),
  });
}

function presetParams(presetId: ThrottlePresetId): { latency: number; download: number; upload: number } | null {
  if (presetId === 'off') return null;
  if (presetId === 'custom') return state.throttleCustom;
  const preset = THROTTLE_PRESETS.find((p: ThrottlePreset) => p.id === presetId);
  return preset ? { latency: preset.latency, download: preset.download, upload: preset.upload } : null;
}

async function applyThrottle(): Promise<void> {
  const params = presetParams(state.throttlePreset);
  if (!params) {
    await sendCommand('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    return;
  }
  await applyThrottleParams(params);
}

// ---------- 高级 Mock（Fetch 拦截） ----------

/** DNR urlFilter（* 通配）→ RegExp 子串匹配 */
function urlFilterToRegExp(urlFilter: string): RegExp {
  const escaped = urlFilter.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(escaped);
}

function matchRule(url: string, method: string, rules: MockRule[]): MockRule | null {
  for (const rule of rules) {
    if (!rule.enabled || !rule.urlFilter) continue;
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue;
    if (urlFilterToRegExp(rule.urlFilter).test(url)) return rule;
  }
  return null;
}

/** UTF-8 文本 → base64（Fetch.fulfillRequest 的 body 格式） */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function enableFetch(): Promise<void> {
  const rules = (await getMockRules()).filter((r) => r.enabled && r.advanced && r.urlFilter);
  if (rules.length === 0) {
    // 没有高级规则时关闭 Fetch 拦截（空 patterns = 全量拦截，代价过高）
    await sendCommand('Fetch.disable').catch(() => undefined);
    return;
  }
  // 只注册规则涉及的 pattern，未命中的请求不经过 SW，页面性能无额外损耗
  const patterns = [...new Set(rules.map((r) => {
    const filter = r.urlFilter.trim();
    return filter.startsWith('*') || filter.includes('://') ? filter : `*${filter}*`;
  }))].map((urlPattern) => ({ urlPattern }));
  await sendCommand('Fetch.enable', { patterns });
}

async function onRequestPaused(params: {
  requestId: string;
  request: { url: string; method: string };
}): Promise<void> {
  const { requestId, request } = params;
  try {
    const rules = (await getMockRules()).filter((r) => r.enabled && r.advanced);
    const rule = matchRule(request.url, request.method, rules);
    if (!rule) {
      await sendCommand('Fetch.continueRequest', { requestId });
      return;
    }
    const delay = Math.min(Math.max(0, rule.delayMs || 0), 30000);
    if (rule.failureRate && rule.failureRate > 0 && Math.random() * 100 < rule.failureRate) {
      setTimeout(() => sendCommand('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => undefined), delay);
      return;
    }
    if (rule.block) {
      setTimeout(() => sendCommand('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => undefined), delay);
      return;
    }
    setTimeout(() => {
      sendCommand('Fetch.fulfillRequest', {
        requestId,
        responseCode: rule.statusCode && rule.statusCode >= 100 && rule.statusCode <= 599 ? rule.statusCode : 200,
        responseHeaders: [
          { name: 'Content-Type', value: rule.contentType || 'text/plain' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: utf8ToBase64(rule.responseBody ?? ''),
      }).catch(() => undefined);
    }, delay);
  } catch {
    // 规则读取异常时放行请求，避免把页面挂死
    await sendCommand('Fetch.continueRequest', { requestId }).catch(() => undefined);
  }
}

// ---------- 接口录制（跨页面跳转仍保留） ----------
// 采 XHR / Fetch / Document：页面级 302/301 走 Document，只采 XHR 会整段丢重定向链
// 条目持久化到 storage，跳转后仍可查看

/** 进行中的请求（requestId → 草稿），loadingFinished / loadingFailed 时落盘 */
interface PendingRec {
  ts: number;
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

const pendingRec = new Map<string, PendingRec>();
/** 已完成条目（新→旧），与 storage 同步 */
let recEntries: RecordingEntry[] = [];
let recSeq = 0;
let recFlushTimer: ReturnType<typeof setTimeout> | null = null;
let recDirty: RecordingEntry[] = [];
/** 防止 SW 被唤醒后、storage 尚未灌入时用空数组覆盖历史 */
let recHydrated = false;
let recHydratePromise: Promise<void> | null = null;
/** 用户仍要录制：跨域跳转导致 debugger 断开后自动重挂 */
let recWanted = false;
let recReattachTimer: ReturnType<typeof setTimeout> | null = null;

/** 录制类型：接口 + 文档导航（页面 302/301 跳转走 Document，不采会整段丢链） */
const REC_TYPES = new Set(['XHR', 'Fetch', 'Document']);
/** 同一 requestId 重定向链上已落盘的 3xx，避免重复写入 */
const emittedRedirectKeys = new Set<string>();
/** 重定向续跳时 CDP 可能省略 type，用上一跳类型兜底 */
const recTypeByRequestId = new Map<string, string>();

function headersToMap(list?: Array<{ name: string; value: string }> | Record<string, string>): Record<string, string> {
  if (!list) return {};
  if (Array.isArray(list)) {
    const out: Record<string, string> = {};
    for (const h of list) out[h.name] = h.value;
    return out;
  }
  return { ...list };
}

function truncateBody(text: string): { body: string; truncated: boolean } {
  if (text.length <= REC_BODY_LIMIT) return { body: text, truncated: false };
  return { body: `${text.slice(0, REC_BODY_LIMIT)}\n…(已截断，原长度 ${text.length})`, truncated: true };
}

async function loadRecEntries(): Promise<void> {
  if (recHydrated) return;
  if (recHydratePromise) {
    await recHydratePromise;
    return;
  }
  recHydratePromise = (async () => {
    recEntries = await storageGet<RecordingEntry[]>(KEY_RECORDING_ENTRIES, []);
    recSeq = recEntries.reduce((m, e) => Math.max(m, e.id), 0);
    state.recordingCount = recEntries.length;
    recHydrated = true;
  })();
  try {
    await recHydratePromise;
  } finally {
    recHydratePromise = null;
  }
}

async function persistRecNow(): Promise<void> {
  if (recFlushTimer) {
    clearTimeout(recFlushTimer);
    recFlushTimer = null;
  }
  if (recDirty.length) {
    pushRecBatch(recDirty);
    recDirty = [];
  }
  await persistRecEntries();
}

async function persistRecEntries(): Promise<void> {
  await loadRecEntries();
  try {
    await storageSet(KEY_RECORDING_ENTRIES, recEntries);
  } catch {
    // quota 满时仍保留内存列表，避免写成空
  }
  state.recordingCount = recEntries.length;
  await persist();
  pushState();
}

async function flushPendingRec(reason: string): Promise<void> {
  const ids = [...pendingRec.keys()];
  for (const requestId of ids) {
    const pending = pendingRec.get(requestId);
    if (!pending) continue;
    finalizeRec(requestId, {
      status: pending.status,
      mimeType: pending.mimeType,
      responseHeaders: pending.responseHeaders,
      errorText: pending.status ? undefined : reason,
      durationMs: Math.max(0, Date.now() - pending.ts),
    });
  }
  pendingRec.clear();
  await persistRecNow();
}

function pushRecBatch(entries: RecordingEntry[]): void {
  if (typeof chrome.runtime?.sendMessage !== 'function') return;
  chrome.runtime.sendMessage({ type: 'dbg/recEntries', entries } satisfies DebugPush).catch(() => {
    // 无 UI 接收时忽略
  });
}

function scheduleRecFlush(entry: RecordingEntry): void {
  recDirty.push(entry);
  if (recFlushTimer == null) {
    recFlushTimer = setTimeout(() => {
      recFlushTimer = null;
      const batch = recDirty;
      recDirty = [];
      pushRecBatch(batch);
      void persistRecEntries();
    }, 120);
  }
}

function finalizeRec(requestId: string, patch: Partial<RecordingEntry>): void {
  const pending = pendingRec.get(requestId);
  if (!pending) return;
  pendingRec.delete(requestId);
  recTypeByRequestId.delete(requestId);
  for (const k of [...emittedRedirectKeys]) {
    if (k.startsWith(`${requestId}|`)) emittedRedirectKeys.delete(k);
  }
  const entry: RecordingEntry = {
    id: ++recSeq,
    ts: pending.ts,
    pageUrl: pending.pageUrl,
    method: pending.method,
    url: pending.url,
    resourceType: pending.resourceType,
    status: patch.status ?? pending.status,
    mimeType: patch.mimeType ?? pending.mimeType,
    durationMs: patch.durationMs ?? Math.max(0, Date.now() - pending.ts),
    requestHeaders: pending.requestHeaders,
    requestBody: pending.requestBody,
    responseHeaders: patch.responseHeaders ?? pending.responseHeaders,
    responseBody: patch.responseBody ?? '',
    responseTruncated: patch.responseTruncated ?? false,
    errorText: patch.errorText,
  };
  // 新条目插到最前；超出上限丢弃最旧
  recEntries = [entry, ...recEntries].slice(0, REC_ENTRY_LIMIT);
  scheduleRecFlush(entry);
}

function redirectKey(requestId: string, url: string, status: number): string {
  return `${requestId}|${url}|${status}`;
}

function emitRedirectEntry(
  requestId: string,
  pending: PendingRec,
  status: number,
  responseHeaders: Record<string, string>,
  mimeType: string,
  nextUrl: string,
): void {
  const key = redirectKey(requestId, pending.url, status);
  if (emittedRedirectKeys.has(key)) return;
  emittedRedirectKeys.add(key);
  // 不走 finalizeRec：不能删 pending，后续还有跳转目标 / loadingFinished
  const entry: RecordingEntry = {
    id: ++recSeq,
    ts: pending.ts,
    pageUrl: pending.pageUrl,
    method: pending.method,
    url: pending.url,
    resourceType: pending.resourceType,
    status,
    mimeType,
    durationMs: Math.max(0, Date.now() - pending.ts),
    requestHeaders: pending.requestHeaders,
    requestBody: pending.requestBody,
    responseHeaders,
    responseBody: nextUrl ? `(redirect → ${nextUrl})` : '(redirect)',
    responseTruncated: false,
  };
  recEntries = [entry, ...recEntries].slice(0, REC_ENTRY_LIMIT);
  scheduleRecFlush(entry);
}

function onRecRequestWillBeSent(params: {
  requestId: string;
  documentURL: string;
  type?: string;
  /** 重定向时带上上一跳的响应（302/301 等）；同一 requestId 会连续触发多次 willBeSent */
  redirectResponse?: {
    status: number;
    url?: string;
    mimeType?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
  };
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    postData?: string;
  };
  wallTime?: number;
}): void {
  if (!state.recording) return;

  const existing = pendingRec.get(params.requestId);
  const inferredType =
    params.type
    || recTypeByRequestId.get(params.requestId)
    || existing?.resourceType
    || '';

  // 必须先处理 redirectResponse：上一跳可能是 Document（页面跳转），不能因 type 过滤丢掉 302
  if (params.redirectResponse) {
    const hdrs = headersToMap(params.redirectResponse.headers);
    const prevUrl = params.redirectResponse.url || existing?.url || '';
    const loc = hdrs.Location || hdrs.location || params.request.url || '';
    const hopType = inferredType || existing?.resourceType || 'Document';
    // existing 可能为空：首跳若曾被旧逻辑过滤，仍用 redirectResponse 补一条 3xx
    const pendingForHop: PendingRec = existing ?? {
      ts: params.wallTime ? Math.round(params.wallTime * 1000) : Date.now(),
      pageUrl: params.documentURL || '',
      method: (params.request.method || 'GET').toUpperCase(),
      url: prevUrl,
      resourceType: hopType,
      requestHeaders: {},
      requestBody: '',
      status: 0,
      mimeType: '',
      responseHeaders: {},
    };
    if (prevUrl) {
      emitRedirectEntry(
        params.requestId,
        { ...pendingForHop, url: prevUrl, resourceType: hopType },
        params.redirectResponse.status || 0,
        hdrs,
        params.redirectResponse.mimeType || '',
        loc,
      );
    }
    pendingRec.delete(params.requestId);
  }

  const type = inferredType || (params.redirectResponse ? 'Document' : '');
  if (!REC_TYPES.has(type)) return;
  recTypeByRequestId.set(params.requestId, type);

  const { body } = truncateBody(params.request.postData || '');
  pendingRec.set(params.requestId, {
    ts: params.wallTime ? Math.round(params.wallTime * 1000) : Date.now(),
    pageUrl: params.documentURL || existing?.pageUrl || '',
    method: (params.request.method || existing?.method || 'GET').toUpperCase(),
    url: params.request.url || '',
    resourceType: type,
    requestHeaders: headersToMap(params.request.headers),
    // 重定向后的 GET 通常没有 body
    requestBody: body || (params.redirectResponse ? '' : existing?.requestBody || ''),
    status: 0,
    mimeType: '',
    responseHeaders: {},
  });
}

function onRecResponseReceived(params: {
  requestId: string;
  type?: string;
  response: {
    status: number;
    url?: string;
    mimeType?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
  };
}): void {
  if (!state.recording) return;
  const pending = pendingRec.get(params.requestId);
  if (!pending) return;
  const status = params.response.status || 0;
  const hdrs = headersToMap(params.response.headers);
  pending.status = status;
  pending.mimeType = params.response.mimeType || '';
  pending.responseHeaders = hdrs;

  // 部分环境下 3xx 会先到 responseReceived，再 willBeSent(redirectResponse)
  if (status >= 300 && status < 400) {
    const loc = hdrs.Location || hdrs.location || params.response.url || '';
    emitRedirectEntry(params.requestId, pending, status, hdrs, pending.mimeType, loc);
  }
}

async function onRecLoadingFinished(params: {
  requestId: string;
  timestamp?: number;
}): Promise<void> {
  if (!state.recording) return;
  const pending = pendingRec.get(params.requestId);
  if (!pending) return;
  // 已作为 3xx 落盘且浏览器继续跟跳时，最终 loadingFinished 对应最后一跳；
  // 若 pending 仍是 3xx 且已 emit，避免再写一条重复 302
  if (
    pending.status >= 300
    && pending.status < 400
    && emittedRedirectKeys.has(redirectKey(params.requestId, pending.url, pending.status))
  ) {
    pendingRec.delete(params.requestId);
    recTypeByRequestId.delete(params.requestId);
    return;
  }
  let responseBody = '';
  let responseTruncated = false;
  try {
    const result = await sendCommand<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', {
      requestId: params.requestId,
    });
    if (result?.base64Encoded) {
      // 二进制：不展开全量，只记占位（避免 storage 爆、也避免乱码）
      let size = 0;
      try { size = atob(result.body || '').length; } catch { size = (result.body || '').length; }
      responseBody = `<binary ${size} bytes>`;
    } else {
      const t = truncateBody(result?.body || '');
      responseBody = t.body;
      responseTruncated = t.truncated;
    }
  } catch {
    // 某些响应（如 204、被取消）取不到 body，忽略
  }
  finalizeRec(params.requestId, {
    status: pending.status,
    mimeType: pending.mimeType,
    responseHeaders: pending.responseHeaders,
    responseBody,
    responseTruncated,
    durationMs: Math.max(0, Date.now() - pending.ts),
  });
  recTypeByRequestId.delete(params.requestId);
  emittedRedirectKeys.delete(redirectKey(params.requestId, pending.url, pending.status));
}

function onRecLoadingFailed(params: {
  requestId: string;
  errorText?: string;
  canceled?: boolean;
}): void {
  if (!state.recording) return;
  const pending = pendingRec.get(params.requestId);
  if (!pending) return;
  // 重定向过程中旧跳可能以 canceled 结束，若已记过 3xx 则忽略
  if (
    pending.status >= 300
    && pending.status < 400
    && emittedRedirectKeys.has(redirectKey(params.requestId, pending.url, pending.status))
  ) {
    pendingRec.delete(params.requestId);
    recTypeByRequestId.delete(params.requestId);
    return;
  }
  finalizeRec(params.requestId, {
    status: pending.status || 0,
    responseBody: '',
    errorText: params.canceled ? 'canceled' : (params.errorText || 'failed'),
    durationMs: Math.max(0, Date.now() - pending.ts),
  });
  recTypeByRequestId.delete(params.requestId);
}

async function enableRecording(): Promise<void> {
  recWanted = true;
  await loadRecEntries();
  await sendCommand('Network.enable', {
    maxTotalBufferSize: 10 * 1024 * 1024,
    maxResourceBufferSize: 5 * 1024 * 1024,
  }).catch(() => undefined);
}

async function reattachRecording(tabId: number): Promise<boolean> {
  try {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (e) {
      if (!String(e).includes('Already attached')) throw e;
    }
    state.tabId = tabId;
    state.recording = true;
    recWanted = true;
    await sendCommand('Network.enable', {
      maxTotalBufferSize: 10 * 1024 * 1024,
      maxResourceBufferSize: 5 * 1024 * 1024,
    }).catch(() => undefined);
    await persist();
    pushState();
    return true;
  } catch {
    return false;
  }
}

// ---------- debugger 事件（顶层注册，SW 唤醒后立即可用） ----------

interface WsCreatedParams { requestId: string; url: string }
interface WsClosedParams { requestId: string }
interface WsFrameParams { requestId: string; timestamp: number; response: FramePayload }

if (hasDebugger) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId !== state.tabId) return;
    switch (method) {
      case 'Network.webSocketCreated': {
        const { requestId, url } = (params ?? {}) as WsCreatedParams;
        state.wsConnections[requestId] = url;
        pushState();
        break;
      }
      case 'Network.webSocketClosed': {
        const { requestId } = (params ?? {}) as WsClosedParams;
        delete state.wsConnections[requestId];
        pushState();
        break;
      }
      case 'Network.webSocketFrameSent':
        if (state.wsMonitoring) {
          const p = (params ?? {}) as WsFrameParams;
          emitFrame(p.requestId, 'sent', p.response);
        }
        break;
      case 'Network.webSocketFrameReceived':
        if (state.wsMonitoring) {
          const p = (params ?? {}) as WsFrameParams;
          emitFrame(p.requestId, 'received', p.response);
        }
        break;
      case 'Network.requestWillBeSent':
        onRecRequestWillBeSent(params as Parameters<typeof onRecRequestWillBeSent>[0]);
        break;
      case 'Network.responseReceived':
        onRecResponseReceived(params as Parameters<typeof onRecResponseReceived>[0]);
        break;
      case 'Network.loadingFinished':
        void onRecLoadingFinished(params as Parameters<typeof onRecLoadingFinished>[0]);
        break;
      case 'Network.loadingFailed':
        onRecLoadingFailed(params as Parameters<typeof onRecLoadingFailed>[0]);
        break;
      case 'Fetch.requestPaused':
        if (state.advMockActive) void onRequestPaused(params as { requestId: string; request: { url: string; method: string } });
        break;
      default:
        break;
    }
  });

  // 跨域跳转 / 页面卸载会 detach。记录已落盘的条目，并尝试重挂以继续录制
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId !== state.tabId) return;
    void (async () => {
      const tabId = source.tabId;
      const userCanceled = reason === 'canceled_by_user';
      const keepRecording = !userCanceled && (recWanted || state.recording);
      await flushPendingRec('navigated');
      if (!keepRecording) {
        recWanted = false;
        state = { ...OFFLINE, recordingCount: recEntries.length };
        await persist();
        pushState();
        return;
      }
      state = {
        ...state,
        tabId: tabId ?? null,
        recording: false,
        wsConnections: {},
        recordingCount: recEntries.length,
      };
      await persist();
      pushState();
      if (recReattachTimer) clearTimeout(recReattachTimer);
      recReattachTimer = setTimeout(() => {
        recReattachTimer = null;
        if (!recWanted || tabId == null) return;
        void reattachRecording(tabId);
      }, 250);
    })();
  });
}

if (typeof chrome.tabs?.onUpdated?.addListener === 'function') {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId !== state.tabId) return;
    if (info.status !== 'loading' && info.status !== 'complete') return;
    if (!recWanted && !state.recording) return;
    if (info.status === 'loading') {
      void persistRecNow();
    }
    if (info.status === 'complete') {
      void (async () => {
        if (!state.recording && recWanted && state.tabId != null) {
          await reattachRecording(state.tabId);
          return;
        }
        if (state.recording) {
          await sendCommand('Network.enable', {
            maxTotalBufferSize: 10 * 1024 * 1024,
            maxResourceBufferSize: 5 * 1024 * 1024,
          }).catch(() => undefined);
        }
      })();
    }
  });
}

// ---------- runtime 消息处理 ----------

async function handle(msg: DebugRequest): Promise<DebugResponse> {
  if (!hasDebugger) return { ok: false, error: '当前环境无 chrome.debugger' };
  switch (msg.type) {
    case 'dbg/getState':
      return { ok: true, state };

    case 'dbg/wsStart':
      await ensureAttached();
      state.wsMonitoring = true;
      await persist();
      pushState();
      return { ok: true, state };

    case 'dbg/wsStop':
      state.wsMonitoring = false;
      flushEvents();
      await persist();
      pushState();
      await maybeDetach();
      return { ok: true, state };

    case 'dbg/throttle': {
      await ensureAttached();
      state.throttlePreset = msg.preset;
      await applyThrottle();
      await persist();
      pushState();
      await maybeDetach();
      return { ok: true, state };
    }

    case 'dbg/throttleCustom': {
      await ensureAttached();
      state.throttlePreset = 'custom';
      state.throttleCustom = { latency: msg.latency, download: msg.download, upload: msg.upload };
      await applyThrottle();
      await persist();
      pushState();
      return { ok: true, state };
    }

    case 'dbg/advMockOn':
      await ensureAttached();
      state.advMockActive = true;
      await enableFetch();
      await persist();
      pushState();
      return { ok: true, state };

    case 'dbg/advMockOff':
      state.advMockActive = false;
      await sendCommand('Fetch.disable').catch(() => undefined);
      await persist();
      pushState();
      await maybeDetach();
      return { ok: true, state };

    case 'dbg/advMockRefresh':
      if (state.advMockActive) await enableFetch();
      return { ok: true, state };

    case 'dbg/recStart':
      recWanted = true;
      await ensureAttached();
      await enableRecording();
      state.recording = true;
      await persist();
      pushState();
      return { ok: true, state };

    case 'dbg/recStop':
      recWanted = false;
      state.recording = false;
      await flushPendingRec('stopped');
      await persist();
      pushState();
      await maybeDetach();
      return { ok: true, state };

    case 'dbg/recList':
      await loadRecEntries();
      return { ok: true, state, entries: recEntries };

    case 'dbg/recClear':
      recEntries = [];
      recDirty = [];
      recHydrated = true;
      pendingRec.clear();
      recSeq = 0;
      state.recordingCount = 0;
      await storageSet(KEY_RECORDING_ENTRIES, []);
      await persist();
      pushState();
      return { ok: true, state, entries: [] };

    default:
      return { ok: false, error: '未知消息' };
  }
}

if (typeof chrome.runtime?.onMessage?.addListener === 'function') {
  chrome.runtime.onMessage.addListener((msg: DebugRequest, _sender, sendResponse) => {
    handle(msg)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse({ ok: false, error: String(e) } satisfies DebugResponse));
    return true; // 异步 sendResponse
  });
}

// ---------- SW 冷启动恢复（幂等） ----------
// debugger 附加与 SW 生命周期解耦：SW 被杀后调试会话仍在，重新执行 Network/Fetch 使能即可恢复

void (async () => {
  if (!hasDebugger) return;
  await loadRecEntries();
  const saved = await storageGet<Partial<DebuggerState>>(KEY_STATE, {});
  const tabId = typeof saved.tabId === 'number' ? saved.tabId : null;
  const preset = (saved.throttlePreset ?? 'off') as ThrottlePresetId;
  const needAttach = !!saved.wsMonitoring || !!saved.advMockActive || !!saved.recording || preset !== 'off';
  if (tabId == null || !needAttach) return;
  state = {
    ...OFFLINE,
    tabId,
    wsMonitoring: !!saved.wsMonitoring,
    advMockActive: !!saved.advMockActive,
    recording: !!saved.recording,
    throttlePreset: preset,
    throttleCustom: saved.throttleCustom ?? OFFLINE.throttleCustom,
    recordingCount: recEntries.length,
  };
  recWanted = !!saved.recording;
  try {
    await ensureAttached(); // tab 可能已关闭 → 抛错则回退为关闭态
    if (state.advMockActive) await enableFetch();
    if (state.throttlePreset !== 'off') await applyThrottle();
    if (state.recording) {
      pendingRec.clear();
      await sendCommand('Network.enable', {
        maxTotalBufferSize: 10 * 1024 * 1024,
        maxResourceBufferSize: 5 * 1024 * 1024,
      }).catch(() => undefined);
    }
  } catch {
    state = { ...OFFLINE, recordingCount: recEntries.length };
    await persist();
    pushState();
  }
})();
