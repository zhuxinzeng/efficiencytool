/**
 * 运行在页面主世界（world: MAIN）
 * 采集 Navigation / Resource / Paint / LCP / CLS / INP / Long Task，并生成优化建议
 * 注意：不可引用 chrome.*；保持可序列化、可重复注入（幂等）
 */
(() => {
  const SOURCE = 'efficiencytool-perf';
  const MARK = '__efficiencytool_perf_probe__';
  if ((window as unknown as Record<string, unknown>)[MARK]) return;
  (window as unknown as Record<string, unknown>)[MARK] = true;

  type Rating = 'good' | 'needs-improvement' | 'poor' | 'unknown';
  type Severity = 'critical' | 'warning' | 'info';
  type MetricId = 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB' | 'DCL' | 'Load';

  interface Metric {
    id: MetricId;
    label: string;
    value: number | null;
    unit: 'ms' | 'score';
    rating: Rating;
    thresholdHint: string;
    detail?: string;
  }

  interface ResourceRow {
    name: string;
    shortName: string;
    type: string;
    initiatorType: string;
    duration: number;
    transferSize: number;
    decodedBodySize: number;
    startTime: number;
    protocol: string;
    renderBlocking: boolean;
  }

  interface Suggestion {
    id: string;
    severity: Severity;
    title: string;
    detail: string;
    relatedMetric?: MetricId;
  }

  function round(n: number, digits = 1): number {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }

  function rateMs(value: number | null, good: number, ni: number): Rating {
    if (value == null || Number.isNaN(value)) return 'unknown';
    if (value <= good) return 'good';
    if (value <= ni) return 'needs-improvement';
    return 'poor';
  }

  function rateCls(value: number | null): Rating {
    if (value == null || Number.isNaN(value)) return 'unknown';
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs-improvement';
    return 'poor';
  }

  function shortUrl(url: string): string {
    try {
      const u = new URL(url, location.href);
      const path = u.pathname + u.search;
      if (path.length <= 64) return path || u.href;
      return `${path.slice(0, 40)}…${path.slice(-16)}`;
    } catch {
      return url.length > 64 ? `${url.slice(0, 61)}…` : url;
    }
  }

  function classifyResource(entry: PerformanceResourceTiming): string {
    const init = entry.initiatorType || '';
    if (init === 'css' || /\.css(\?|$)/i.test(entry.name)) return 'css';
    if (init === 'script' || /\.m?js(\?|$)/i.test(entry.name)) return 'js';
    if (init === 'img' || init === 'image' || /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(entry.name)) return 'image';
    if (init === 'font' || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(entry.name)) return 'font';
    if (init === 'xmlhttprequest' || init === 'fetch') return 'xhr';
    if (init === 'video' || init === 'audio' || /\.(mp4|webm|mp3)(\?|$)/i.test(entry.name)) return 'media';
    if (entry.name.includes('data:') || entry.name.includes('blob:')) return 'data';
    return init || 'other';
  }

  function isRenderBlocking(entry: PerformanceResourceTiming): boolean {
    const rb = (entry as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus;
    return rb === 'blocking' || rb === 'in-body-blocker';
  }

  function getNav(): PerformanceNavigationTiming | null {
    const list = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return list[0] || null;
  }

  function collectPaint(): { fcp: number | null; fp: number | null } {
    let fcp: number | null = null;
    let fp: number | null = null;
    for (const e of performance.getEntriesByType('paint') as PerformancePaintTiming[]) {
      if (e.name === 'first-contentful-paint') fcp = e.startTime;
      if (e.name === 'first-paint') fp = e.startTime;
    }
    return { fcp, fp };
  }

  type LcpEntry = PerformanceEntry & {
    startTime: number;
    size?: number;
    element?: Element | null;
    url?: string;
  };
  type ShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };
  type EventEntry = PerformanceEntry & { duration: number; interactionId?: number };

  /** 持续累计：Chrome 对 LCP/CLS/event 往往不通过 getEntriesByType 暴露，必须靠 Observer */
  const live = {
    lcp: null as LcpEntry | null,
    cls: 0,
    clsObserved: false,
    inpMax: null as number | null,
    longTasks: [] as PerformanceEntry[],
  };

  function applyLcpEntries(entries: PerformanceEntry[]) {
    const last = entries[entries.length - 1] as LcpEntry | undefined;
    if (last) live.lcp = last;
  }

  function applyClsEntries(entries: PerformanceEntry[]) {
    live.clsObserved = true;
    for (const raw of entries) {
      const e = raw as ShiftEntry;
      if (e.hadRecentInput) continue;
      live.cls += e.value;
    }
  }

  function applyEventEntries(entries: PerformanceEntry[]) {
    for (const raw of entries) {
      const e = raw as EventEntry;
      if (!e.interactionId) continue;
      if (live.inpMax == null || e.duration > live.inpMax) live.inpMax = e.duration;
    }
  }

  function applyLongTaskEntries(entries: PerformanceEntry[]) {
    live.longTasks.push(...entries);
  }

  /**
   * 一次性读取 buffered 条目。
   * Chrome 对 LCP/CLS/event 等通常不通过 getEntriesByType 暴露；
   * 必须 PerformanceObserver + buffered，并等回调/macrotask 后再取。
   */
  function readBuffered(
    type: string,
    opts?: { durationThreshold?: number },
  ): Promise<PerformanceEntry[]> {
    return new Promise((resolve) => {
      if (typeof PerformanceObserver !== 'function') {
        resolve([]);
        return;
      }
      let entries: PerformanceEntry[] = [];
      let po: PerformanceObserver;
      try {
        po = new PerformanceObserver((list) => {
          const batch = list.getEntries();
          if (batch.length) entries = batch;
        });
        const init: PerformanceObserverInit & { durationThreshold?: number } = {
          type,
          buffered: true,
        };
        if (opts?.durationThreshold != null) init.durationThreshold = opts.durationThreshold;
        po.observe(init);
        // Observer 回调一般在当前轮询末尾、setTimeout(0) 之前到达；此处合并 takeRecords 再返回
        setTimeout(() => {
          try {
            const extra = po.takeRecords();
            if (extra.length) entries = entries.length ? entries.concat(extra) : extra;
          } catch { /* ignore */ }
          try { po.disconnect(); } catch { /* ignore */ }
          resolve(entries);
        }, 0);
      } catch {
        resolve([]);
      }
    });
  }

  function lcpFromEntry(entry: LcpEntry | null): { value: number | null; tag?: string; size?: number; url?: string } {
    if (!entry) return { value: null };
    const el = entry.element;
    return {
      value: entry.startTime,
      tag: el ? el.tagName.toLowerCase() : undefined,
      size: entry.size,
      url: entry.url || undefined,
    };
  }

  async function collectLcp(): Promise<{ value: number | null; tag?: string; size?: number; url?: string }> {
    const buffered = await readBuffered('largest-contentful-paint');
    if (buffered.length) applyLcpEntries(buffered);
    return lcpFromEntry(live.lcp);
  }

  async function collectCls(): Promise<number | null> {
    const buffered = await readBuffered('layout-shift');
    if (buffered.length) {
      // 缓冲是全量历史：用本次读取重算，避免与 live 重复累加
      live.cls = 0;
      applyClsEntries(buffered);
    } else if (!live.clsObserved) {
      // 成功 observe 但无条目 → CLS 为 0（无偏移）；observe 失败才保持 unknown
      try {
        const probe = new PerformanceObserver(() => {});
        probe.observe({ type: 'layout-shift', buffered: true });
        probe.disconnect();
        live.clsObserved = true;
        live.cls = 0;
      } catch {
        return null;
      }
    }
    return live.clsObserved ? live.cls : null;
  }

  async function collectInp(): Promise<number | null> {
    const buffered = await readBuffered('event', { durationThreshold: 16 });
    if (buffered.length) {
      live.inpMax = null;
      applyEventEntries(buffered);
    }
    return live.inpMax;
  }

  async function collectLongTasks(): Promise<{ count: number; totalDuration: number; maxDuration: number }> {
    const buffered = await readBuffered('longtask');
    if (buffered.length) {
      live.longTasks = buffered;
    }
    let total = 0;
    let max = 0;
    for (const e of live.longTasks) {
      total += e.duration;
      if (e.duration > max) max = e.duration;
    }
    return { count: live.longTasks.length, totalDuration: round(total), maxDuration: round(max) };
  }

  function toResourceRow(entry: PerformanceResourceTiming): ResourceRow {
    return {
      name: entry.name,
      shortName: shortUrl(entry.name),
      type: classifyResource(entry),
      initiatorType: entry.initiatorType || '',
      duration: round(entry.duration),
      transferSize: entry.transferSize || 0,
      decodedBodySize: entry.decodedBodySize || 0,
      startTime: round(entry.startTime),
      protocol: entry.nextHopProtocol || '',
      renderBlocking: isRenderBlocking(entry),
    };
  }

  function collectResources(): {
    total: number;
    transferTotal: number;
    byType: { type: string; count: number; transferSize: number; duration: number }[];
    topBySize: ResourceRow[];
    topByDuration: ResourceRow[];
    rows: ResourceRow[];
  } {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const rows = entries.map(toResourceRow);
    const map = new Map<string, { count: number; transferSize: number; duration: number }>();
    let transferTotal = 0;
    for (const r of rows) {
      transferTotal += r.transferSize;
      const cur = map.get(r.type) || { count: 0, transferSize: 0, duration: 0 };
      cur.count += 1;
      cur.transferSize += r.transferSize;
      cur.duration += r.duration;
      map.set(r.type, cur);
    }
    const byType = [...map.entries()]
      .map(([type, v]) => ({ type, ...v, duration: round(v.duration) }))
      .sort((a, b) => b.transferSize - a.transferSize);
    const topBySize = [...rows].sort((a, b) => b.transferSize - a.transferSize).slice(0, 12);
    const topByDuration = [...rows].sort((a, b) => b.duration - a.duration).slice(0, 12);
    return {
      total: rows.length,
      transferTotal,
      byType,
      topBySize,
      topByDuration,
      rows,
    };
  }

  function collectDocument() {
    return {
      domNodes: document.getElementsByTagName('*').length,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets.length,
      images: document.images.length,
      iframes: document.querySelectorAll('iframe').length,
    };
  }

  function buildTiming(nav: PerformanceNavigationTiming | null) {
    if (!nav) {
      return {
        redirect: 0, dns: 0, tcp: 0, tls: 0, ttfb: 0, download: 0,
        domInteractive: 0, domContentLoaded: 0, load: 0,
      };
    }
    const safe = (a: number, b: number) => (a > 0 && b > 0 && a >= b ? round(a - b) : 0);
    return {
      redirect: safe(nav.redirectEnd, nav.redirectStart),
      dns: safe(nav.domainLookupEnd, nav.domainLookupStart),
      tcp: safe(nav.connectEnd, nav.connectStart),
      tls: nav.secureConnectionStart > 0 ? safe(nav.connectEnd, nav.secureConnectionStart) : 0,
      ttfb: safe(nav.responseStart, nav.requestStart),
      download: safe(nav.responseEnd, nav.responseStart),
      domInteractive: round(nav.domInteractive),
      domContentLoaded: round(nav.domContentLoadedEventEnd),
      load: round(nav.loadEventEnd),
    };
  }

  function buildMetrics(
    nav: PerformanceNavigationTiming | null,
    paint: { fcp: number | null },
    lcp: { value: number | null },
    cls: number | null,
    inp: number | null,
  ): Metric[] {
    const ttfb = nav ? round(nav.responseStart - nav.requestStart) : null;
    const dcl = nav && nav.domContentLoadedEventEnd > 0 ? round(nav.domContentLoadedEventEnd) : null;
    const load = nav && nav.loadEventEnd > 0 ? round(nav.loadEventEnd) : null;
    const fcp = paint.fcp != null ? round(paint.fcp) : null;
    const lcpV = lcp.value != null ? round(lcp.value) : null;
    const clsV = cls != null ? round(cls, 3) : null;
    const inpV = inp != null ? round(inp) : null;

    return [
      {
        id: 'LCP',
        label: '最大内容绘制',
        value: lcpV,
        unit: 'ms',
        rating: rateMs(lcpV, 2500, 4000),
        thresholdHint: '良好 ≤ 2.5s',
        detail: '视口内最大元素完成渲染的时间',
      },
      {
        id: 'CLS',
        label: '累计布局偏移',
        value: clsV,
        unit: 'score',
        rating: rateCls(clsV),
        thresholdHint: '良好 ≤ 0.1',
        detail: '页面生命周期内意外布局偏移累计分',
      },
      {
        id: 'INP',
        label: '交互到下次绘制',
        value: inpV,
        unit: 'ms',
        rating: rateMs(inpV, 200, 500),
        thresholdHint: '良好 ≤ 200ms',
        detail: '用户交互到视觉响应的延迟（需已产生交互）',
      },
      {
        id: 'FCP',
        label: '首次内容绘制',
        value: fcp,
        unit: 'ms',
        rating: rateMs(fcp, 1800, 3000),
        thresholdHint: '良好 ≤ 1.8s',
      },
      {
        id: 'TTFB',
        label: '首字节时间',
        value: ttfb,
        unit: 'ms',
        rating: rateMs(ttfb, 800, 1800),
        thresholdHint: '良好 ≤ 800ms',
        detail: '从发起请求到收到首字节',
      },
      {
        id: 'DCL',
        label: 'DOMContentLoaded',
        value: dcl,
        unit: 'ms',
        rating: rateMs(dcl, 2500, 4000),
        thresholdHint: '参考 ≤ 2.5s',
      },
      {
        id: 'Load',
        label: 'Load 事件',
        value: load,
        unit: 'ms',
        rating: rateMs(load, 4000, 7000),
        thresholdHint: '参考 ≤ 4s',
      },
    ];
  }

  function scoreFromMetrics(metrics: Metric[]): { score: number; label: string } {
    const weights: Partial<Record<MetricId, number>> = {
      LCP: 30, CLS: 20, INP: 20, FCP: 15, TTFB: 15,
    };
    let totalW = 0;
    let earned = 0;
    for (const m of metrics) {
      const w = weights[m.id];
      if (!w || m.rating === 'unknown' || m.value == null) continue;
      totalW += w;
      if (m.rating === 'good') earned += w;
      else if (m.rating === 'needs-improvement') earned += w * 0.55;
    }
    if (totalW === 0) return { score: 0, label: '数据不足' };
    const score = Math.round((earned / totalW) * 100);
    let label = '较差';
    if (score >= 90) label = '优秀';
    else if (score >= 75) label = '良好';
    else if (score >= 50) label = '需改进';
    return { score, label };
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${round(n / 1024)} KB`;
    return `${round(n / (1024 * 1024), 2)} MB`;
  }

  function buildSuggestions(
    metrics: Metric[],
    timing: ReturnType<typeof buildTiming>,
    resources: ReturnType<typeof collectResources>,
    longTasks: Awaited<ReturnType<typeof collectLongTasks>>,
    doc: ReturnType<typeof collectDocument>,
    lcp: { value: number | null; tag?: string; url?: string },
  ): Suggestion[] {
    const out: Suggestion[] = [];
    const metric = (id: MetricId) => metrics.find((m) => m.id === id);

    const ttfb = metric('TTFB');
    if (ttfb?.rating === 'poor' || (ttfb?.value != null && ttfb.value > 800)) {
      out.push({
        id: 'ttfb',
        severity: ttfb.rating === 'poor' ? 'critical' : 'warning',
        title: '首字节时间（TTFB）偏高',
        detail: `当前约 ${ttfb.value}ms。建议检查服务端耗时、CDN 就近节点、缓存命中、是否多余重定向（当前重定向约 ${timing.redirect}ms）。`,
        relatedMetric: 'TTFB',
      });
    }

    const lcpM = metric('LCP');
    if (lcpM?.rating === 'poor' || lcpM?.rating === 'needs-improvement') {
      const elHint = lcp.tag ? `LCP 元素为 <${lcp.tag}>` : '未能识别 LCP 元素';
      const urlHint = lcp.url ? `，资源 ${shortUrl(lcp.url)}` : '';
      out.push({
        id: 'lcp',
        severity: lcpM.rating === 'poor' ? 'critical' : 'warning',
        title: '最大内容绘制（LCP）偏慢',
        detail: `${elHint}${urlHint}。优先：预加载 LCP 图片（fetchpriority=high / preload）、压缩与现代格式（AVIF/WebP）、避免 CSS/JS 阻塞、减少服务端等待。`,
        relatedMetric: 'LCP',
      });
    }

    const clsM = metric('CLS');
    if (clsM?.rating === 'poor' || clsM?.rating === 'needs-improvement') {
      out.push({
        id: 'cls',
        severity: clsM.rating === 'poor' ? 'critical' : 'warning',
        title: '布局偏移（CLS）偏高',
        detail: `累计 CLS 约 ${clsM.value}。为图片/广告/嵌入 iframe 预留宽高，避免在已有内容上方插入 DOM，字体使用 font-display 并尽量预加载关键字体。`,
        relatedMetric: 'CLS',
      });
    }

    const inpM = metric('INP');
    if (inpM?.rating === 'poor' || inpM?.rating === 'needs-improvement') {
      out.push({
        id: 'inp',
        severity: inpM.rating === 'poor' ? 'critical' : 'warning',
        title: '交互响应（INP）偏慢',
        detail: `最长交互延迟约 ${inpM.value}ms。拆分长任务、减少主线程同步工作、推迟非关键 JS、避免在输入处理中做重计算。`,
        relatedMetric: 'INP',
      });
    } else if (inpM?.value == null) {
      out.push({
        id: 'inp-missing',
        severity: 'info',
        title: '尚未采集到交互指标（INP）',
        detail: '请在页面上完成点击/键盘等交互后再分析；或刷新后先操作再点「重新分析」。',
        relatedMetric: 'INP',
      });
    }

    if (longTasks.count >= 3 || longTasks.maxDuration >= 100) {
      out.push({
        id: 'longtask',
        severity: longTasks.maxDuration >= 200 ? 'critical' : 'warning',
        title: '主线程长任务较多',
        detail: `共 ${longTasks.count} 个长任务，累计 ${longTasks.totalDuration}ms，最长 ${longTasks.maxDuration}ms。建议代码分割、Web Worker、避免大 JSON 同步解析与强制同步布局。`,
      });
    }

    const blocking = resources.rows.filter((r) => r.renderBlocking);
    if (blocking.length >= 3) {
      out.push({
        id: 'blocking',
        severity: blocking.length >= 6 ? 'critical' : 'warning',
        title: '渲染阻塞资源偏多',
        detail: `检测到 ${blocking.length} 个渲染阻塞资源。对非关键 CSS 使用 media 拆分或延迟加载；脚本加 defer/async；关键 CSS 内联首屏关键样式。`,
      });
    }

    const jsAgg = resources.byType.find((t) => t.type === 'js');
    if (jsAgg && jsAgg.transferSize > 500 * 1024) {
      out.push({
        id: 'js-size',
        severity: jsAgg.transferSize > 1024 * 1024 ? 'critical' : 'warning',
        title: 'JavaScript 体积过大',
        detail: `JS 传输合计约 ${formatBytes(jsAgg.transferSize)}（${jsAgg.count} 个）。启用 tree-shaking / 路由级拆包，压缩与 Brotli/Gzip，移除未使用依赖。`,
      });
    }

    const imgAgg = resources.byType.find((t) => t.type === 'image');
    if (imgAgg && imgAgg.transferSize > 800 * 1024) {
      out.push({
        id: 'img-size',
        severity: imgAgg.transferSize > 2 * 1024 * 1024 ? 'critical' : 'warning',
        title: '图片资源偏重',
        detail: `图片传输合计约 ${formatBytes(imgAgg.transferSize)}（${imgAgg.count} 张）。使用响应式图片、现代格式、CDN 压缩，并对屏外图使用 loading="lazy"。`,
      });
    }

    const heavy = resources.topBySize.filter((r) => r.transferSize > 300 * 1024).slice(0, 3);
    if (heavy.length) {
      out.push({
        id: 'heavy-files',
        severity: 'warning',
        title: '存在超大单文件',
        detail: heavy.map((r) => `${r.shortName}（${formatBytes(r.transferSize)}）`).join('；')
          + '。优先压缩、拆分或按需加载这些资源。',
      });
    }

    // 疑似未压缩：文本类 transfer ≈ decoded 且体积不小
    const uncompressed = resources.rows.filter((r) => {
      if (!['js', 'css', 'xhr'].includes(r.type)) return false;
      if (r.decodedBodySize < 50 * 1024 || r.transferSize <= 0) return false;
      return r.transferSize / r.decodedBodySize > 0.9;
    }).slice(0, 5);
    if (uncompressed.length >= 2) {
      out.push({
        id: 'compress',
        severity: 'warning',
        title: '部分文本资源可能未启用压缩',
        detail: `例如：${uncompressed.map((r) => r.shortName).join('、')}。请在服务端启用 Gzip/Brotli，并确认 CDN 透传 Content-Encoding。`,
      });
    }

    if (resources.total > 80) {
      out.push({
        id: 'req-count',
        severity: resources.total > 120 ? 'critical' : 'warning',
        title: '请求数量偏多',
        detail: `当前约 ${resources.total} 个资源请求。合并小文件、使用 HTTP/2 推送替代、减少第三方脚本与重复请求。`,
      });
    }

    if (doc.domNodes > 1500) {
      out.push({
        id: 'dom',
        severity: doc.domNodes > 3000 ? 'critical' : 'warning',
        title: 'DOM 节点过多',
        detail: `约 ${doc.domNodes} 个节点。简化结构、虚拟列表、延迟渲染折叠区域，降低样式计算与布局成本。`,
      });
    }

    if (doc.scripts > 25) {
      out.push({
        id: 'script-count',
        severity: 'info',
        title: '脚本标签较多',
        detail: `页面含 ${doc.scripts} 个 <script>。检查第三方埋点/广告是否可合并或延迟加载（requestIdleCallback / 交互后加载）。`,
      });
    }

    if (timing.redirect > 300) {
      out.push({
        id: 'redirect',
        severity: 'warning',
        title: '重定向耗时偏高',
        detail: `重定向约 ${timing.redirect}ms。尽量使用最终 URL，避免 http→https、www 跳转链叠加。`,
        relatedMetric: 'TTFB',
      });
    }

    const thirdParty = resources.rows.filter((r) => {
      try {
        return new URL(r.name).hostname !== location.hostname;
      } catch {
        return false;
      }
    });
    const tpSize = thirdParty.reduce((s, r) => s + r.transferSize, 0);
    if (thirdParty.length >= 15 || tpSize > 400 * 1024) {
      out.push({
        id: 'third-party',
        severity: tpSize > 1024 * 1024 ? 'critical' : 'warning',
        title: '第三方资源占用明显',
        detail: `第三方约 ${thirdParty.length} 个请求、${formatBytes(tpSize)}。评估必要性，使用 facade 延迟加载，并限制同步第三方脚本。`,
      });
    }

    if (!out.some((s) => s.severity !== 'info')) {
      out.push({
        id: 'ok',
        severity: 'info',
        title: '核心指标整体尚可',
        detail: '未发现明显严重问题。仍可关注缓存策略、预连接关键域名、图片与字体优化以进一步提升。',
      });
    }

    const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  async function snapshot() {
    const nav = getNav();
    const paint = collectPaint();
    const [lcp, cls, inp, longTasks] = await Promise.all([
      collectLcp(),
      collectCls(),
      collectInp(),
      collectLongTasks(),
    ]);
    const resources = collectResources();
    const doc = collectDocument();
    const timing = buildTiming(nav);
    const metrics = buildMetrics(nav, paint, lcp, cls, inp);
    const { score, label: scoreLabel } = scoreFromMetrics(metrics);
    const suggestions = buildSuggestions(metrics, timing, resources, longTasks, doc, lcp);

    const notes: string[] = [];
    if (!nav) notes.push('未读到 Navigation Timing（可能为特殊文档或跨源隔离限制）。');
    if (lcp.value == null) {
      notes.push('未采集到 LCP：请确认标签页在前台且首屏已绘制；后台页或约 0×0 视口时浏览器可能不上报 LCP。');
    }
    if (inp == null) {
      notes.push('未采集到 INP：需要先在页面上产生点击/键盘等交互，再点「重新分析」。');
    }
    notes.push('SPA 软路由切换不会重置 Navigation Timing，分析的是文档初始加载；需要完整首屏数据请硬刷新后再测。');
    notes.push('LCP/CLS/INP 通过 PerformanceObserver（buffered）采集；与实验室 Lighthouse 环境可能存在差异。');

    const navType = nav
      ? (nav.type === 'reload' ? 'reload' : nav.type === 'back_forward' ? 'back_forward' : nav.type === 'prerender' ? 'prerender' : 'navigate')
      : 'unknown';

    return {
      url: location.href,
      title: document.title || '',
      collectedAt: Date.now(),
      navigationType: navType,
      score,
      scoreLabel,
      metrics,
      timing,
      resources: {
        total: resources.total,
        transferTotal: resources.transferTotal,
        byType: resources.byType,
        topBySize: resources.topBySize,
        topByDuration: resources.topByDuration,
      },
      longTasks,
      document: doc,
      lcp: lcp.tag
        ? { tag: lcp.tag, size: lcp.size || 0, url: lcp.url }
        : undefined,
      suggestions,
      notes,
    };
  }

  // 页面加载后尽早挂持续观察，后续交互/偏移也能累计到 INP、CLS
  try {
    if (typeof PerformanceObserver === 'function') {
      try {
        new PerformanceObserver((list) => applyLcpEntries(list.getEntries()))
          .observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* ignore */ }
      try {
        new PerformanceObserver((list) => applyClsEntries(list.getEntries()))
          .observe({ type: 'layout-shift', buffered: true });
      } catch { /* ignore */ }
      try {
        new PerformanceObserver((list) => applyEventEntries(list.getEntries()))
          .observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      } catch { /* ignore */ }
      try {
        new PerformanceObserver((list) => applyLongTaskEntries(list.getEntries()))
          .observe({ type: 'longtask', buffered: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== 'req') return;
    const id = data.id as string;
    void (async () => {
      try {
        if (data.payload?.action !== 'snapshot') {
          window.postMessage({ source: SOURCE, direction: 'res', id, ok: false, error: '未知 action' }, '*');
          return;
        }
        const result = await snapshot();
        window.postMessage({ source: SOURCE, direction: 'res', id, ok: true, data: result }, '*');
      } catch (e) {
        window.postMessage({
          source: SOURCE,
          direction: 'res',
          id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        }, '*');
      }
    })();
  });
})();
