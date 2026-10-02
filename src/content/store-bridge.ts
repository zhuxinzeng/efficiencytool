// 隔离世界桥：扩展 UI ↔ 页面主世界探测脚本（postMessage）
import { STORE_MSG_SOURCE, type StoreBridgeRequest, type StoreBridgeResponse } from '../shared/store-protocol';

type Pending = {
  resolve: (v: StoreBridgeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
let reqSeq = 0;

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (!data || data.source !== STORE_MSG_SOURCE || data.direction !== 'res') return;
  const id = data.id as string;
  const waiter = pending.get(id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  pending.delete(id);
  if (data.ok) waiter.resolve({ ok: true, data: data.data });
  else waiter.resolve({ ok: false, error: String(data.error || '未知错误') });
});

function callPage(payload: StoreBridgeRequest, timeoutMs = 4000): Promise<StoreBridgeResponse> {
  return new Promise((resolve) => {
    const id = `req-${++reqSeq}-${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        ok: false,
        error: '页面探测超时：请确认当前是普通网页且已刷新；chrome:// 等页面无法注入',
      });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    window.postMessage({ source: STORE_MSG_SOURCE, direction: 'req', id, payload }, '*');
  });
}

chrome.runtime.onMessage.addListener((msg: { type?: string; payload?: StoreBridgeRequest }, _sender, sendResponse) => {
  if (msg?.type !== 'store/bridge') return;
  const payload = msg.payload;
  if (!payload) {
    sendResponse({ ok: false, error: '缺少 payload' } satisfies StoreBridgeResponse);
    return true;
  }
  void callPage(payload).then(sendResponse);
  return true;
});
