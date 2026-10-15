// UI：向当前活动标签页发起页面性能快照
import type { PerfBridgeRequest, PerfBridgeResponse, PerfSnapshot } from './perf-protocol';

function hasChromeTabs(): boolean {
  return typeof globalThis.chrome !== 'undefined'
    && typeof chrome.tabs?.query === 'function'
    && typeof chrome.tabs?.sendMessage === 'function';
}

async function activeTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id == null) throw new Error('未找到当前活动标签页');
  const url = tabs[0]?.url || '';
  if (!/^https?:/i.test(url)) {
    throw new Error('当前标签页无法注入脚本（请打开普通 http/https 业务页面）');
  }
  return id;
}

async function sendToTab(tabId: number, payload: PerfBridgeRequest): Promise<PerfBridgeResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'perf/bridge', payload }) as PerfBridgeResponse;
  } catch {
    const manifest = chrome.runtime.getManifest();
    const allCs = manifest.content_scripts ?? [];
    if (allCs.length && chrome.scripting?.executeScript) {
      for (const cs of allCs) {
        if (!cs.js?.length) continue;
        const world = (cs as { world?: 'MAIN' | 'ISOLATED' }).world === 'MAIN' ? 'MAIN' : 'ISOLATED';
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: cs.js,
            world,
          });
        } catch {
          // 继续尝试
        }
      }
      return await chrome.tabs.sendMessage(tabId, { type: 'perf/bridge', payload }) as PerfBridgeResponse;
    }
    throw new Error('无法连接页面脚本，请刷新业务页后重试');
  }
}

async function request(payload: PerfBridgeRequest): Promise<PerfBridgeResponse> {
  if (!hasChromeTabs()) {
    return { ok: false, error: '非扩展环境：请在 Chrome 加载扩展后，打开业务页再分析' };
  }
  try {
    const tabId = await activeTabId();
    return await sendToTab(tabId, payload);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function perfSnapshot(): Promise<
  { ok: true; snapshot: PerfSnapshot } | { ok: false; error: string }
> {
  const resp = await request({ action: 'snapshot' });
  if (!resp.ok) return resp;
  return { ok: true, snapshot: resp.data };
}
