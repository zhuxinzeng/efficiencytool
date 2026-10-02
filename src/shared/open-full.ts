// 打开工具台：优先 Side Panel（跨站不丢）；其次独立可拉伸全屏窗口
// 普通浏览器（本地调试）直接 window.open

interface ChromeLike {
  runtime?: {
    getURL?: (path: string) => string;
    id?: string;
  };
  tabs?: {
    create?: (options: { url: string }) => void;
    query?: (query: object) => Promise<Array<{ id?: number; windowId?: number }>>;
  };
  windows?: {
    create?: (options: {
      url: string;
      type?: string;
      width?: number;
      height?: number;
      left?: number;
      top?: number;
    }) => void;
  };
  sidePanel?: {
    open?: (options: { windowId?: number }) => Promise<void>;
  };
}

function toolUrl(hash?: string, path = 'src/index.html'): string {
  const chromeApi = (globalThis as { chrome?: ChromeLike }).chrome;
  const base = chromeApi?.runtime?.getURL
    ? chromeApi.runtime.getURL(path)
    : path;
  if (!hash) return base;
  const id = hash.replace(/^#\/?/, '');
  return `${base}#/${id}`;
}

/** 打开 Side Panel（独立于页面生命周期，跨域名跳转仍保留） */
export async function openSidePanel() {
  const chromeApi = (globalThis as { chrome?: ChromeLike }).chrome;
  if (chromeApi?.sidePanel?.open && chromeApi.tabs?.query) {
    try {
      const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
      const windowId = tabs[0]?.windowId;
      await chromeApi.sidePanel.open(windowId != null ? { windowId } : {});
      return;
    } catch {
      // 落到独立全屏窗口
    }
  }
  openResizableWindow();
}

/** 打开独立全屏窗口（带左侧菜单，可自由拖边改宽高） */
export function openResizableWindow(hash?: string) {
  const chromeApi = (globalThis as { chrome?: ChromeLike }).chrome;
  const url = toolUrl(hash, 'src/index.html');
  if (chromeApi?.windows?.create) {
    chromeApi.windows.create({
      url,
      type: 'popup',
      width: 1280,
      height: 840,
    });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer,width=1280,height=840');
}

/** 兼容旧调用：优先侧边栏 */
export function openFullScreenPage(_hash?: string) {
  void openSidePanel();
}
