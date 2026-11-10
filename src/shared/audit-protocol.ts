// 页面样式审计协议：字体、字号、颜色、CSS 变量的采集结果（UI 与注入脚本共用结构）

export interface AuditUsageEntry {
  value: string;
  count: number;
}

export interface AuditFontUsage {
  /** 主字体族 */
  family: string;
  count: number;
  sizes: AuditUsageEntry[];
  weights: AuditUsageEntry[];
}

export interface AuditColorUsage {
  hex: string;
  /** 原始计算值，如 rgba(0, 0, 0, 0.85) */
  raw: string;
  count: number;
  /** text / background / border */
  kinds: string[];
  /** 使用该颜色的示例文本 */
  sample: string;
}

export interface AuditVarEntry {
  name: string;
  value: string;
}

export interface AuditSnapshot {
  url: string;
  title: string;
  collectedAt: number;
  /** 页面元素总数 */
  elementCount: number;
  /** 实际参与统计的元素数（有上限） */
  scannedCount: number;
  fonts: AuditFontUsage[];
  fontSizes: AuditUsageEntry[];
  colors: AuditColorUsage[];
  cssVars: AuditVarEntry[];
  /** document.fonts 已加载的字体族 */
  loadedFonts: string[];
  notes: string[];
}