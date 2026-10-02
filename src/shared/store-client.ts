// UI / SW：向当前活动标签页发起框架 Store 探测与读写
import type {
  StoreBridgeRequest, StoreBridgeResponse, StoreFramework, StoreSnapshot, StoreSummary,
} from './store-protocol';

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

async function sendToTab(tabId: number, payload: StoreBridgeRequest): Promise<StoreBridgeResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'store/bridge', payload }) as StoreBridgeResponse;
  } catch {
    // 页面打开时尚无 content script：尝试按 manifest 路径补注入
    const manifest = chrome.runtime.getManifest();
    const files = (manifest.content_scripts ?? [])
      .flatMap((cs) => cs.js ?? [])
      .filter((f) => typeof f === 'string');
    if (files.length && chrome.scripting?.executeScript) {
      // 先 MAIN 后 ISOLATED 顺序不保证；分别注入两类
      const allCs = manifest.content_scripts ?? [];
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
      return await chrome.tabs.sendMessage(tabId, { type: 'store/bridge', payload }) as StoreBridgeResponse;
    }
    throw new Error('无法连接页面脚本，请刷新业务页后重试');
  }
}

async function request(payload: StoreBridgeRequest): Promise<StoreBridgeResponse> {
  if (!hasChromeTabs()) {
    return { ok: false, error: '非扩展环境：请在 Chrome 加载扩展后，打开业务页再探测' };
  }
  try {
    const tabId = await activeTabId();
    return await sendToTab(tabId, payload);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function storeList(): Promise<{ ok: true; list: StoreSummary[] } | { ok: false; error: string }> {
  const resp = await request({ action: 'list' });
  if (!resp.ok) return resp;
  return { ok: true, list: (resp.data as StoreSummary[]) ?? [] };
}

export async function storeGet(
  framework: StoreFramework,
  id: string,
): Promise<{ ok: true; snapshot: StoreSnapshot } | { ok: false; error: string }> {
  const resp = await request({ action: 'get', framework, id });
  if (!resp.ok) return resp;
  return { ok: true, snapshot: resp.data as StoreSnapshot };
}

export async function storeSet(
  framework: StoreFramework,
  id: string,
  path: string[],
  value: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resp = await request({ action: 'set', framework, id, path, value });
  if (!resp.ok) return resp;
  return { ok: true };
}
