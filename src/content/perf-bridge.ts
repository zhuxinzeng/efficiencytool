// 隔离世界桥：扩展 UI ↔ 页面主世界性能探针（postMessage）
import { PERF_MSG_SOURCE, type PerfBridgeRequest, type PerfBridgeResponse } from '../shared/perf-protocol';

type Pending = {
  resolve: (v: PerfBridgeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
let reqSeq = 0;

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (!data || data.source !== PERF_MSG_SOURCE || data.direction !== 'res') return;
  const id = data.id as string;
  const waiter = pending.get(id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  pending.delete(id);
  if (data.ok) waiter.resolve({ ok: true, data: data.data });
  else waiter.resolve({ ok: false, error: String(data.error || '未知错误') });
});

function callPage(payload: PerfBridgeRequest, timeoutMs = 6000): Promise<PerfBridgeResponse> {
  return new Promise((resolve) => {
    const id = `perf-${++reqSeq}-${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        ok: false,
        error: '性能采集超时：请确认当前是普通网页且已刷新；chrome:// 等页面无法注入',
      });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    window.postMessage({ source: PERF_MSG_SOURCE, direction: 'req', id, payload }, '*');
  });
}

chrome.runtime.onMessage.addListener((msg: { type?: string; payload?: PerfBridgeRequest }, _sender, sendResponse) => {
  if (msg?.type !== 'perf/bridge') return;
  const payload = msg.payload;
  if (!payload) {
    sendResponse({ ok: false, error: '缺少 payload' } satisfies PerfBridgeResponse);
    return true;
  }
  void callPage(payload).then(sendResponse);
  return true;
});
