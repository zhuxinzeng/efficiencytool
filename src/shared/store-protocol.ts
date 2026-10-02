// 页面主世界协议常量（与 store-bridge / UI 共用字符串，避免打包进 MAIN 脚本的 chrome 依赖）
export const STORE_MSG_SOURCE = 'efficiencytool-store';

export type StoreFramework = 'pinia' | 'vuex' | 'redux';

export interface StoreSummary {
  framework: StoreFramework;
  /** Pinia: store.$id；Vuex/Redux: 固定 vuex / redux，多实例时带后缀 */
  id: string;
  label: string;
  /** 探测到的线索，便于用户理解 */
  hint?: string;
  /** Redux 默认只读 */
  editable: boolean;
}

export interface StoreSnapshot {
  framework: StoreFramework;
  id: string;
  label: string;
  editable: boolean;
  /** 已做安全克隆，可 JSON 展示 */
  state: unknown;
  /** 克隆时是否有截断 / 不可序列化替换 */
  truncated?: boolean;
}

export type StoreBridgeRequest =
  | { action: 'list' }
  | { action: 'get'; framework: StoreFramework; id: string }
  | { action: 'set'; framework: StoreFramework; id: string; path: string[]; value: unknown };

export type StoreBridgeResponse =
  | { ok: true; data: StoreSummary[] | StoreSnapshot | { applied: true } }
  | { ok: false; error: string };
