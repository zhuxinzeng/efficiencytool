// UI：向当前活动标签页注入采集函数，统计字体、字号、颜色与 CSS 变量
// 采集函数必须自包含（executeScript 序列化执行），不能引用外部变量/导入
import type { AuditSnapshot } from './audit-protocol';

/* eslint-disable @typescript-eslint/no-explicit-any */
function collectPageAudit(limit: number): AuditSnapshot {
  const fonts = new Map<string, { count: number; sizes: Map<string, number>; weights: Map<string, number> }>();
  const sizes = new Map<string, number>();
  const colors = new Map<string, { raw: string; count: number; kinds: Set<string>; sample: string }>();

  const toHex = (input: string): string => {
    const m = input.match(/rgba?\(([^)]+)\)/i);
    if (!m) return input;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return input;
    const h = (v: string) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))).toString(16).padStart(2, '0');
    return `#${h(parts[0])}${h(parts[1])}${h(parts[2])}`;
  };

  const addColor = (raw: string, kind: string, sample: string) => {
    if (!raw || raw === 'transparent') return;
    const rgba = raw.match(/rgba?\(([^)]+)\)/i);
    if (rgba) {
      const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
      const alpha = parts[3] == null ? 1 : parseFloat(parts[3]);
      if (alpha === 0) return;
    }
    const hex = toHex(raw);
    const entry = colors.get(hex);
    if (entry) {
      entry.count += 1;
      entry.kinds.add(kind);
      if (!entry.sample && sample) entry.sample = sample;
    } else {
      colors.set(hex, { raw, count: 1, kinds: new Set([kind]), sample });
    }
  };

  const all = document.querySelectorAll('*');
  const max = Math.max(200, limit);
  let scanned = 0;
  for (let i = 0; i < all.length && scanned < max; i++) {
    const el = all[i];
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'title' || tag === 'head') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    scanned += 1;

    const family = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim() || '未知';
    const size = cs.fontSize;
    const weight = cs.fontWeight;

    let font = fonts.get(family);
    if (!font) {
      font = { count: 0, sizes: new Map(), weights: new Map() };
      fonts.set(family, font);
    }
    font.count += 1;
    font.sizes.set(size, (font.sizes.get(size) ?? 0) + 1);
    font.weights.set(weight, (font.weights.get(weight) ?? 0) + 1);
    sizes.set(size, (sizes.get(size) ?? 0) + 1);

    const text = el.childElementCount === 0 ? (el.textContent || '').trim().slice(0, 24) : '';
    addColor(cs.color, 'text', text);
    addColor(cs.backgroundColor, 'background', '');
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') {
      addColor(cs.borderTopColor, 'border', '');
    }
  }

  // CSS 变量：遍历可访问的样式表（跨域样式表会被跳过）
  const vars = new Map<string, string>();
  const walk = (rules: any) => {
    for (const rule of rules) {
      const style = (rule as any).style;
      if (style && typeof style.length === 'number') {
        for (let i = 0; i < style.length; i++) {
          const name = style[i];
          if (typeof name === 'string' && name.startsWith('--')) {
            const value = String(style.getPropertyValue(name) || '').trim();
            if (value && !vars.has(name)) vars.set(name, value);
          }
        }
      }
      const child = (rule as any).cssRules;
      if (child) walk(child);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // 跨域样式表无权限，跳过
    }
  }
  const rootStyle = document.documentElement.style;
  for (let i = 0; i < rootStyle.length; i++) {
    const name = rootStyle[i];
    if (name.startsWith('--')) vars.set(name, rootStyle.getPropertyValue(name).trim());
  }

  const loadedFonts: string[] = [];
  if (document.fonts) {
    document.fonts.forEach((f) => {
      const name = f.family.replace(/["']/g, '');
      if (!loadedFonts.includes(name)) loadedFonts.push(name);
    });
  }

  const sortEntries = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

  const notes: string[] = [];
  if (scanned < all.length) {
    notes.push(`页面共 ${all.length} 个元素，仅统计前 ${scanned} 个（避免大页面卡顿）`);
  }
  if (!vars.size) {
    notes.push('未发现 CSS 变量：可能样式表跨域，或站点未使用自定义属性');
  }

  return {
    url: location.href,
    title: document.title,
    collectedAt: Date.now(),
    elementCount: all.length,
    scannedCount: scanned,
    fonts: Array.from(fonts.entries())
      .map(([family, v]) => ({
        family,
        count: v.count,
        sizes: sortEntries(v.sizes).slice(0, 6),
        weights: sortEntries(v.weights).slice(0, 4),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    fontSizes: sortEntries(sizes),
    colors: Array.from(colors.entries())
      .map(([hex, v]) => ({ hex, raw: v.raw, count: v.count, kinds: Array.from(v.kinds), sample: v.sample }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 60),
    cssVars: Array.from(vars.entries()).map(([name, value]) => ({ name, value })).slice(0, 300),
    loadedFonts: loadedFonts.slice(0, 40),
    notes,
  };
}

function hasChromeScripting(): boolean {
  return typeof globalThis.chrome !== 'undefined'
    && typeof chrome.tabs?.query === 'function'
    && typeof chrome.scripting?.executeScript === 'function';
}

export async function auditPage(): Promise<
  { ok: true; snapshot: AuditSnapshot } | { ok: false; error: string }
> {
  if (!hasChromeScripting()) {
    return { ok: false, error: '非扩展环境：请在 Chrome 加载扩展后，打开业务页再审计' };
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab?.id == null) throw new Error('未找到当前活动标签页');
    if (!/^https?:/i.test(tab.url || '')) {
      throw new Error('当前标签页无法注入脚本（请打开普通 http/https 业务页面）');
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageAudit,
      args: [4000],
    });
    const snapshot = results?.[0]?.result as AuditSnapshot | undefined;
    if (!snapshot) throw new Error('采集结果为空，请刷新页面后重试');
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}