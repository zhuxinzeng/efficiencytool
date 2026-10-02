// chrome.storage.local 封装：扩展环境走 chrome API，普通浏览器（dev 冒烟）退回内存实现
// 统一 async 接口，业务层不感知运行环境

type ChangeHandler = (changes: Record<string, { newValue?: unknown }>) => void;

const memory = new Map<string, unknown>();
const listeners = new Set<ChangeHandler>();

const hasChromeStorage =
  typeof globalThis.chrome !== 'undefined' &&
  typeof globalThis.chrome.storage?.local?.get === 'function';

export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  if (hasChromeStorage) {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T | undefined) ?? fallback;
  }
  return (memory.get(key) as T | undefined) ?? fallback;
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  memory.set(key, value);
  for (const listener of listeners) listener({ [key]: { newValue: value } });
}

/** 监听存储变化，返回取消函数 */
export function storageWatch(listener: ChangeHandler): () => void {
  if (hasChromeStorage) {
    const wrapped = (changes: Record<string, chrome.storage.StorageChange>) => {
      listener(changes as Record<string, { newValue?: unknown }>);
    };
    chrome.storage.onChanged.addListener(wrapped);
    return () => chrome.storage.onChanged.removeListener(wrapped);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
