// 容器宽度自适应：popup（420px）与全屏页共享同一批工具组件，窄壳下表格放不下，
// 用 ResizeObserver 按实际宽度切换「卡片 / 表格」布局
import { useEffect, useRef, useState } from 'react';

/** 低于该宽度视为紧凑布局（popup 内容区约 396px） */
export const COMPACT_BREAKPOINT = 560;

/**
 * 监听容器实际宽度。
 * 首帧渲染前 width 为 0，按紧凑布局处理，避免 popup 初帧表格闪一下。
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width, compact: width < COMPACT_BREAKPOINT };
}