// UI 端 debugger 引擎调用封装：扩展环境走 chrome.runtime messaging
// 普通浏览器（dev 冒烟）下提供离线 fallback，保证 UI 可预览、操作给出明确提示
import type {
  DebugPush, DebugRequest, DebugResponse, DebuggerState, RecordingEntry, ThrottlePresetId,
} from './debugger-protocol';
import { KEY_RECORDING_ENTRIES } from './debugger-protocol';
import { storageGet, storageSet } from './storage';

/** SW 引擎持久化状态在 storage.local 的 key（与 SW 端保持一致） */
const KEY_STATE = 'debugger.state';

/** 非扩展环境的展示状态（浏览器 dev 冒烟用） */
export const OFFLINE_STATE: DebuggerState = {
  tabId: null,
  wsMonitoring: false,
  advMockActive: false,
  recording: false,
  throttlePreset: 'off',
  throttleCustom: { latency: 0, download: 0, upload: 0 },
  wsConnections: {},
  recordingCount: 0,
};

const hasRuntime =
  typeof globalThis.chrome !== 'undefined' &&
  typeof chrome.runtime?.id === 'string' &&
  typeof chrome.runtime?.sendMessage === 'function';

/** UI 本地缓存的最新状态（非扩展环境读写它，保证冒烟时开关可切换） */
export async function loadCachedState(): Promise<DebuggerState> {
  return storageGet<DebuggerState>(KEY_STATE, OFFLINE_STATE);
}

async function saveCachedState(state: DebuggerState): Promise<void> {
  await storageSet(KEY_STATE, state);
}

async function send(req: DebugRequest): Promise<DebugResponse> {
  if (!hasRuntime) return { ok: false, error: '非扩展环境（浏览器 dev 预览），请在 Chrome 中加载扩展后使用' };
  return chrome.runtime.sendMessage(req) as Promise<DebugResponse>;
}

/** 拉取 SW 引擎当前状态（SW 未唤醒/未就绪时回退缓存值） */
export async function getDebuggerState(): Promise<DebuggerState> {
  if (hasRuntime) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'dbg/getState' } satisfies DebugRequest) as DebugResponse | undefined;
      if (resp?.ok && resp.state) {
        await saveCachedState(resp.state);
        return resp.state;
      }
    } catch {
      // SW 未就绪，落到缓存
    }
  }
  return loadCachedState();
}

export function wsStart(): Promise<DebugResponse> {
  return send({ type: 'dbg/wsStart' });
}

export function wsStop(): Promise<DebugResponse> {
  return send({ type: 'dbg/wsStop' });
}

export function setThrottle(preset: ThrottlePresetId): Promise<DebugResponse> {
  return send({ type: 'dbg/throttle', preset });
}

export function setThrottleCustom(latency: number, download: number, upload: number): Promise<DebugResponse> {
  return send({ type: 'dbg/throttleCustom', latency, download, upload });
}

export function advMockOn(): Promise<DebugResponse> {
  return send({ type: 'dbg/advMockOn' });
}

export function advMockOff(): Promise<DebugResponse> {
  return send({ type: 'dbg/advMockOff' });
}

/** Mock 规则保存后调用：通知 SW 刷新 Fetch 拦截 pattern */
export function advMockRefresh(): Promise<DebugResponse> {
  return send({ type: 'dbg/advMockRefresh' });
}

export function recStart(): Promise<DebugResponse> {
  return send({ type: 'dbg/recStart' });
}

export function recStop(): Promise<DebugResponse> {
  return send({ type: 'dbg/recStop' });
}

export async function recList(): Promise<RecordingEntry[]> {
  if (hasRuntime) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'dbg/recList' } satisfies DebugRequest) as DebugResponse | undefined;
      if (resp?.ok && resp.entries) return resp.entries;
    } catch {
      // 落到 storage 缓存
    }
  }
  return storageGet<RecordingEntry[]>(KEY_RECORDING_ENTRIES, []);
}

export function recClear(): Promise<DebugResponse> {
  return send({ type: 'dbg/recClear' });
}

/**
 * 订阅 SW 推送（状态变更 / WS 消息 / 接口录制批量）
 * 非扩展环境下返回空订阅，UI 保持离线展示
 */
export function subscribeDebuggerPush(handler: (push: DebugPush) => void): () => void {
  if (!hasRuntime) return () => {};
  const listener = (msg: unknown) => {
    const push = msg as DebugPush;
    if (push && typeof push.type === 'string' && push.type.startsWith('dbg/')) handler(push);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
