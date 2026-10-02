// HAR 数据源：拉取 DevTools 打开期间的全部请求，并监听增量请求
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { toHarLite, type HarEntryLite } from '../utils/har';

interface HarContextValue {
  entries: HarEntryLite[];
  loading: boolean;
  /** 是否运行在 DevTools 扩展环境 */
  supported: boolean;
  refresh: () => void;
}

const HarContext = createContext<HarContextValue>({
  entries: [],
  loading: false,
  supported: false,
  refresh: () => undefined,
});

const isDevtools =
  typeof globalThis.chrome !== 'undefined' &&
  typeof globalThis.chrome.devtools?.network?.getHAR === 'function';

function fetchHar(): Promise<HARFormatLog | null> {
  return new Promise((resolve) => {
    try {
      chrome.devtools.network.getHAR((har) => resolve(har ?? null));
    } catch {
      resolve(null);
    }
  });
}

export function HarProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<HarEntryLite[]>([]);
  const [loading, setLoading] = useState(false);
  const mergedRef = useRef(new Map<string, HarEntryLite>());

  const refresh = useCallback(() => {
    if (!isDevtools) return;
    setLoading(true);
    void fetchHar().then((har) => {
      if (har?.entries) {
        const map = mergedRef.current;
        for (const entry of har.entries) {
          const lite = toHarLite(entry);
          map.set(lite.id, lite);
        }
        // 保持时间序
        const list = [...map.values()].sort(
          (a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime),
        );
        setEntries(list);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
    if (!isDevtools) return;
    const listener = (entry: chrome.devtools.network.Request) => {
      const lite = toHarLite(entry);
      mergedRef.current.set(lite.id, lite);
      const list = [...mergedRef.current.values()].sort(
        (a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime),
      );
      setEntries(list);
    };
    chrome.devtools.network.onRequestFinished.addListener(listener);
    return () => {
      chrome.devtools.network.onRequestFinished.removeListener(listener);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ entries, loading, supported: isDevtools, refresh }),
    [entries, loading, refresh],
  );

  return <HarContext.Provider value={value}>{children}</HarContext.Provider>;
}

export function useHar(): HarContextValue {
  return useContext(HarContext);
}
