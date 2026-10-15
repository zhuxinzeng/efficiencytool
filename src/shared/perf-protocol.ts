// 页面性能分析协议（与 perf-bridge / UI 共用）
export const PERF_MSG_SOURCE = 'efficiencytool-perf';

export type PerfRating = 'good' | 'needs-improvement' | 'poor' | 'unknown';
export type PerfSeverity = 'critical' | 'warning' | 'info';

export type PerfMetricId =
  | 'LCP'
  | 'CLS'
  | 'INP'
  | 'FCP'
  | 'TTFB'
  | 'DCL'
  | 'Load';

export interface PerfMetric {
  id: PerfMetricId;
  label: string;
  value: number | null;
  unit: 'ms' | 'score';
  rating: PerfRating;
  /** 达标阈值说明，如 ≤ 2.5s */
  thresholdHint: string;
  detail?: string;
}

export interface PerfResourceRow {
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

export interface PerfTypeAgg {
  type: string;
  count: number;
  transferSize: number;
  duration: number;
}

export interface PerfSuggestion {
  id: string;
  severity: PerfSeverity;
  title: string;
  detail: string;
  relatedMetric?: PerfMetricId;
}

export interface PerfTimingBreakdown {
  redirect: number;
  dns: number;
  tcp: number;
  tls: number;
  ttfb: number;
  download: number;
  domInteractive: number;
  domContentLoaded: number;
  load: number;
}

export interface PerfSnapshot {
  url: string;
  title: string;
  collectedAt: number;
  navigationType: string;
  /** 综合评分 0–100，越高越好 */
  score: number;
  scoreLabel: string;
  metrics: PerfMetric[];
  timing: PerfTimingBreakdown;
  resources: {
    total: number;
    transferTotal: number;
    byType: PerfTypeAgg[];
    topBySize: PerfResourceRow[];
    topByDuration: PerfResourceRow[];
  };
  longTasks: {
    count: number;
    totalDuration: number;
    maxDuration: number;
  };
  document: {
    domNodes: number;
    scripts: number;
    stylesheets: number;
    images: number;
    iframes: number;
  };
  lcp?: {
    tag: string;
    size: number;
    url?: string;
  };
  suggestions: PerfSuggestion[];
  notes: string[];
}

export type PerfBridgeRequest = { action: 'snapshot' };

export type PerfBridgeResponse =
  | { ok: true; data: PerfSnapshot }
  | { ok: false; error: string };
