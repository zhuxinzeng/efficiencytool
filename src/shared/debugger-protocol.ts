// chrome.debugger 消息协议：SW 引擎与工具台 UI 共享的类型与常量
// WS 消息监控 / 网络限速 / 高级 Mock 共用一次 debugger attach，仅作用于开启时所在的活动标签页
// （浏览器顶部会出现「正在调试此浏览器」横幅，属 chrome.debugger 机制，无法隐藏）

/** SW 引擎的运行时状态（UI 通过 dbg/getState 拉取 / dbg/state 推送保持同步） */
export interface DebuggerState {
  /** 已 attach 的标签页 id（null = 未附加） */
  tabId: number | null;
  /** WS 消息监控是否开启 */
  wsMonitoring: boolean;
  /** 高级 Mock（Fetch 拦截）是否开启 */
  advMockActive: boolean;
  /** 接口录制是否开启（跨页面跳转仍保留，条目持久化到 storage） */
  recording: boolean;
  /** 当前限速预设 id（'off' = 未限速；'custom' = 自定义参数） */
  throttlePreset: ThrottlePresetId;
  /** 自定义限速参数（throttlePreset='custom' 时有效） */
  throttleCustom: { latency: number; download: number; upload: number };
  /** 当前附加的 WebSocket 连接（requestId → url，运行时数据不持久化） */
  wsConnections: Record<string, string>;
  /** 已录制条目数（便于 UI 展示，无需拉全量） */
  recordingCount: number;
}

export type ThrottlePresetId = 'off' | 'slow3g' | 'fast3g' | 'weak' | 'latency' | 'custom';

/** 限速预设：latency 单位 ms；吞吐 bytes/s（0 = 不限速），档位对齐 Chrome DevTools Network Conditions */
export interface ThrottlePreset {
  id: ThrottlePresetId;
  label: string;
  desc: string;
  latency: number;
  /** 下载吞吐 bytes/s */
  download: number;
  /** 上传吞吐 bytes/s */
  upload: number;
}

const K = 1024;

export const THROTTLE_PRESETS: ThrottlePreset[] = [
  { id: 'off', label: '不限速', desc: '恢复浏览器默认网络', latency: 0, download: 0, upload: 0 },
  { id: 'slow3g', label: 'Slow 3G', desc: '约 400kbps / 400ms 延迟', latency: 400, download: (400 * K) / 8, upload: (400 * K) / 8 },
  { id: 'fast3g', label: 'Fast 3G', desc: '约 1.6Mbps / 150ms 延迟', latency: 150, download: (1.6 * K * K) / 8, upload: (750 * K) / 8 },
  { id: 'weak', label: '弱网', desc: '约 64kbps / 300ms 延迟', latency: 300, download: (64 * K) / 8, upload: (32 * K) / 8 },
  { id: 'latency', label: '高延迟', desc: '不限速，仅加 1000ms 延迟', latency: 1000, download: 0, upload: 0 },
];

/** 单条 WS 消息（payload 超 8KB 时截断，size 保留真实字节数） */
export interface WsEvent {
  id: number;
  /** 毫秒时间戳 */
  ts: number;
  /** CDP requestId（同一条 WebSocket 连接内相同） */
  wsId: string;
  url: string;
  direction: 'sent' | 'received';
  /** 1 = 文本帧，2 = 二进制帧 */
  opcode: number;
  payload: string;
  /** 真实字节数 */
  size: number;
}

// ---------- runtime 消息定义 ----------

/** 单条接口录制（跨页面跳转仍保留；body 超限会截断） */
export interface RecordingEntry {
  id: number;
  /** 发起请求时的毫秒时间戳 */
  ts: number;
  /** 请求所属页面 URL（documentURL，便于按「哪个页面」回溯） */
  pageUrl: string;
  method: string;
  url: string;
  /** CDP resourceType，如 XHR / Fetch / Document */
  resourceType: string;
  status: number;
  /** 响应 MIME，如 application/json */
  mimeType: string;
  /** 请求耗时毫秒（loadingFinished - requestWillBeSent） */
  durationMs: number;
  requestHeaders: Record<string, string>;
  /** 请求体（无则空串；超限截断） */
  requestBody: string;
  responseHeaders: Record<string, string>;
  /** 响应体（无则空串；超限截断；二进制用占位说明） */
  responseBody: string;
  /** 响应体是否被截断 */
  responseTruncated: boolean;
  /** 加载失败时的错误文案 */
  errorText?: string;
}

/** UI → SW 请求 */
export type DebugRequest =
  | { type: 'dbg/getState' }
  | { type: 'dbg/wsStart' }
  | { type: 'dbg/wsStop' }
  | { type: 'dbg/throttle'; preset: ThrottlePresetId }
  | { type: 'dbg/throttleCustom'; latency: number; download: number; upload: number }
  | { type: 'dbg/advMockOn' }
  | { type: 'dbg/advMockOff' }
  /** Mock 规则变更后刷新 Fetch 拦截 pattern（仅 advMockActive 时生效） */
  | { type: 'dbg/advMockRefresh' }
  | { type: 'dbg/recStart' }
  | { type: 'dbg/recStop' }
  | { type: 'dbg/recList' }
  | { type: 'dbg/recClear' };

/** SW → UI 统一响应 */
export interface DebugResponse {
  ok: boolean;
  error?: string;
  /** dbg/getState 附带 */
  state?: DebuggerState;
  /** dbg/recList 附带 */
  entries?: RecordingEntry[];
}

/** SW → UI 主动推送 */
export type DebugPush =
  | { type: 'dbg/state'; state: DebuggerState }
  | { type: 'dbg/wsEvents'; events: WsEvent[] }
  | { type: 'dbg/recEntries'; entries: RecordingEntry[] };

/** WS 推送单帧 payload 截断上限（保护 UI 内存与消息通道） */
export const WS_PAYLOAD_LIMIT = 8 * 1024;
/** UI 端最多保留的消息条数（环形截断） */
export const WS_EVENT_BUFFER_LIMIT = 1000;

/** 接口录制：单条 body 文本上限（超出截断，保护 storage 配额） */
export const REC_BODY_LIMIT = 64 * 1024;
/** 接口录制：最多保留条数（环形，新的挤掉旧的） */
export const REC_ENTRY_LIMIT = 300;
/** storage 中接口录制条目的 key */
export const KEY_RECORDING_ENTRIES = 'debugger.recordingEntries';
