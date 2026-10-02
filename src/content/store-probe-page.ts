/**
 * 运行在页面主世界（world: MAIN）
 * 探测 Pinia / Vuex / Redux，并通过 window.postMessage 与隔离世界桥通信
 * 注意：不可引用 chrome.*；保持可序列化、可重复注入（幂等）
 */
(() => {
  const SOURCE = 'efficiencytool-store';
  const MAX_DEPTH = 10;
  const MAX_KEYS = 120;
  const MAX_ARRAY = 200;

  type Framework = 'pinia' | 'vuex' | 'redux';

  interface Summary {
    framework: Framework;
    id: string;
    label: string;
    hint?: string;
    editable: boolean;
  }

  // ---------- 安全克隆（供 UI 展示，去掉函数/循环引用） ----------
  function safeClone(value: unknown, depth = 0, seen?: WeakSet<object>): { data: unknown; truncated: boolean } {
    const bag = seen ?? new WeakSet<object>();
    let truncated = false;
    const walk = (v: unknown, d: number): unknown => {
      if (v == null) return v;
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') return v;
      if (t === 'bigint') return `${v}n`;
      if (t === 'function') return '[Function]';
      if (t === 'symbol') return '[Symbol]';
      if (t !== 'object') return String(v);
      if (d >= MAX_DEPTH) {
        truncated = true;
        return '[MaxDepth]';
      }
      const obj = v as object;
      if (bag.has(obj)) {
        truncated = true;
        return '[Circular]';
      }
      bag.add(obj);
      if (v instanceof Date) return v.toISOString();
      if (typeof Element !== 'undefined' && v instanceof Element) return `[Element <${v.tagName.toLowerCase()}>]`;
      if (v instanceof Map) {
        const entries: unknown[] = [];
        let i = 0;
        for (const [mk, mv] of v.entries()) {
          if (i++ >= MAX_KEYS) {
            truncated = true;
            break;
          }
          entries.push([walk(mk, d + 1), walk(mv, d + 1)]);
        }
        return { __type: 'Map', entries };
      }
      if (v instanceof Set) {
        const values: unknown[] = [];
        let i = 0;
        for (const item of v.values()) {
          if (i++ >= MAX_ARRAY) {
            truncated = true;
            break;
          }
          values.push(walk(item, d + 1));
        }
        return { __type: 'Set', values };
      }
      if (Array.isArray(v)) {
        if (v.length > MAX_ARRAY) truncated = true;
        return v.slice(0, MAX_ARRAY).map((item) => walk(item, d + 1));
      }
      const out: Record<string, unknown> = {};
      const keys = Object.keys(v as object);
      if (keys.length > MAX_KEYS) truncated = true;
      for (const k of keys.slice(0, MAX_KEYS)) {
        try {
          out[k] = walk((v as Record<string, unknown>)[k], d + 1);
        } catch {
          out[k] = '[Throw]';
          truncated = true;
        }
      }
      return out;
    };
    return { data: walk(value, depth), truncated };
  }

  function setByPath(target: Record<string, unknown>, path: string[], value: unknown): void {
    if (path.length === 0) throw new Error('路径为空');
    let cur: unknown = target;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]!;
      if (cur == null || typeof cur !== 'object') throw new Error(`路径中断：${path.slice(0, i + 1).join('.')}`);
      const next = (cur as Record<string, unknown>)[key];
      if (next == null || typeof next !== 'object') {
        (cur as Record<string, unknown>)[key] = /^\d+$/.test(path[i + 1]!) ? [] : {};
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    (cur as Record<string, unknown>)[path[path.length - 1]!] = value;
  }

  function deepCloneJson<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
  }

  // ---------- 查找 Vue3 App ----------
  function collectVue3Apps(): unknown[] {
    const apps: unknown[] = [];
    const push = (el: Element | null) => {
      if (!el) return;
      const app = (el as unknown as { __vue_app__?: unknown }).__vue_app__;
      if (app && !apps.includes(app)) apps.push(app);
    };
    push(document.querySelector('#app'));
    push(document.querySelector('#__nuxt'));
    push(document.querySelector('#__layout'));
    push(document.getElementById('app'));
    for (const el of Array.from(document.body?.children ?? [])) push(el);
    // 补充：带 data-v-app 的根
    document.querySelectorAll('[data-v-app]').forEach((el) => push(el));
    return apps;
  }

  function getPiniaFromApp(app: unknown): unknown | null {
    const a = app as {
      config?: { globalProperties?: { $pinia?: unknown } };
      _context?: { provides?: Record<string | symbol, unknown> };
    };
    if (a?.config?.globalProperties?.$pinia) return a.config.globalProperties.$pinia;
    // provides 里的 pinia 以 symbol 为 key，扫 values
    const provides = a?._context?.provides;
    if (provides && typeof provides === 'object') {
      for (const val of Object.values(provides)) {
        if (val && typeof val === 'object' && (val as { _s?: unknown })._s instanceof Map) return val;
      }
    }
    return null;
  }

  function listPinia(): Summary[] {
    const out: Summary[] = [];
    const seen = new Set<unknown>();
    const pinias: unknown[] = [];

    for (const app of collectVue3Apps()) {
      const p = getPiniaFromApp(app);
      if (p && !seen.has(p)) {
        seen.add(p);
        pinias.push(p);
      }
    }
    const w = window as unknown as { __PINIA__?: unknown; $pinia?: unknown };
    if (w.__PINIA__ && !seen.has(w.__PINIA__)) pinias.push(w.__PINIA__);
    if (w.$pinia && !seen.has(w.$pinia)) pinias.push(w.$pinia);

    for (const pinia of pinias) {
      const map = (pinia as { _s?: Map<string, { $id?: string; $state?: unknown }> })._s;
      if (!(map instanceof Map)) continue;
      for (const [id, store] of map.entries()) {
        const sid = store?.$id || id;
        out.push({
          framework: 'pinia',
          id: String(sid),
          label: `Pinia · ${sid}`,
          hint: '通过 $patch 写入',
          editable: true,
        });
      }
    }
    return out;
  }

  function getPiniaStore(id: string): { $state: unknown; $patch: (fn: unknown) => void } | null {
    const seen = new Set<unknown>();
    const pinias: unknown[] = [];
    for (const app of collectVue3Apps()) {
      const p = getPiniaFromApp(app);
      if (p && !seen.has(p)) {
        seen.add(p);
        pinias.push(p);
      }
    }
    const w = window as unknown as { __PINIA__?: unknown; $pinia?: unknown };
    if (w.__PINIA__) pinias.push(w.__PINIA__);
    if (w.$pinia) pinias.push(w.$pinia);

    for (const pinia of pinias) {
      const map = (pinia as { _s?: Map<string, { $id?: string; $state: unknown; $patch: (fn: unknown) => void }> })._s;
      if (!(map instanceof Map)) continue;
      for (const [key, store] of map.entries()) {
        if (String(store?.$id || key) === id) return store;
      }
    }
    return null;
  }

  // ---------- Vuex ----------
  function findVuexStores(): Array<{ id: string; store: { state: unknown; replaceState?: (s: unknown) => void; commit?: unknown } }> {
    const found: Array<{ id: string; store: { state: unknown; replaceState?: (s: unknown) => void } }> = [];
    const seen = new Set<unknown>();

    const tryAdd = (store: unknown, label: string) => {
      if (!store || typeof store !== 'object' || seen.has(store)) return;
      const s = store as { state?: unknown; replaceState?: (x: unknown) => void; commit?: unknown; dispatch?: unknown };
      // Vuex 特征：有 state，且通常有 commit/replaceState
      if (!('state' in s)) return;
      if (typeof s.commit !== 'function' && typeof s.replaceState !== 'function' && typeof s.dispatch !== 'function') return;
      seen.add(store);
      found.push({ id: label, store: s as { state: unknown; replaceState?: (x: unknown) => void } });
    };

    // Vue3 globalProperties
    for (const app of collectVue3Apps()) {
      const gp = (app as { config?: { globalProperties?: { $store?: unknown } } })?.config?.globalProperties;
      tryAdd(gp?.$store, 'vuex');
    }

    // Vue2: __vue__
    const roots = [
      document.querySelector('#app'),
      document.querySelector('#__nuxt'),
      ...Array.from(document.body?.children ?? []).slice(0, 20),
    ];
    for (const el of roots) {
      if (!el) continue;
      const vm = (el as unknown as { __vue__?: { $store?: unknown; $root?: { $store?: unknown } } }).__vue__;
      tryAdd(vm?.$store || vm?.$root?.$store, 'vuex');
    }

    const w = window as unknown as { __STORE__?: unknown; $store?: unknown; store?: unknown };
    tryAdd(w.$store, 'vuex');
    tryAdd(w.__STORE__, 'vuex');
    // window.store 也可能是 redux，下面 Redux 再认；这里若像 vuex 再加
    if (w.store && typeof (w.store as { commit?: unknown }).commit === 'function') tryAdd(w.store, 'vuex');

    // 多实例去重后若只有一个保持 id=vuex；多个则 vuex#0
    if (found.length <= 1) return found.map((f) => ({ ...f, id: 'vuex' }));
    return found.map((f, i) => ({ ...f, id: `vuex#${i}` }));
  }

  function listVuex(): Summary[] {
    return findVuexStores().map((f) => ({
      framework: 'vuex' as const,
      id: f.id,
      label: f.id === 'vuex' ? 'Vuex' : `Vuex · ${f.id}`,
      hint: '通过 replaceState 写入',
      editable: typeof f.store.replaceState === 'function',
    }));
  }

  function getVuexStore(id: string) {
    return findVuexStores().find((f) => f.id === id)?.store ?? null;
  }

  // ---------- Redux ----------
  function isReduxStore(x: unknown): x is { getState: () => unknown; dispatch: (a: unknown) => unknown; subscribe: (l: () => void) => () => void } {
    if (!x || typeof x !== 'object') return false;
    const s = x as { getState?: unknown; dispatch?: unknown; subscribe?: unknown };
    return typeof s.getState === 'function' && typeof s.dispatch === 'function';
  }

  function findReduxStores(): Array<{ id: string; store: { getState: () => unknown; dispatch: (a: unknown) => unknown } }> {
    const found: Array<{ id: string; store: { getState: () => unknown; dispatch: (a: unknown) => unknown } }> = [];
    const seen = new Set<unknown>();
    const tryAdd = (store: unknown, id: string) => {
      if (!isReduxStore(store) || seen.has(store)) return;
      // 排除明显是 Vuex（有 commit）
      if (typeof (store as { commit?: unknown }).commit === 'function') return;
      seen.add(store);
      found.push({ id, store });
    };

    const w = window as unknown as Record<string, unknown>;
    const keys = [
      'store', '__STORE__', '__REDUX_STORE__', '__NEXT_REDUX_STORE__',
      'reduxStore', '__reduxStore__', 'appStore',
    ];
    for (const k of keys) tryAdd(w[k], k === 'store' ? 'redux' : `redux:${k}`);

    // Next.js / 部分脚手架
    tryAdd((w as { __NEXT_DATA__?: { props?: { pageProps?: { store?: unknown } } } }).__NEXT_DATA__?.props?.pageProps?.store, 'redux:next');

    if (found.length === 1) return [{ id: 'redux', store: found[0]!.store }];
    return found;
  }

  function listRedux(): Summary[] {
    return findReduxStores().map((f) => ({
      framework: 'redux' as const,
      id: f.id,
      label: f.id === 'redux' ? 'Redux' : `Redux · ${f.id}`,
      hint: '默认只读（无通用写入 API）；可复制 JSON',
      editable: false,
    }));
  }

  function getReduxStore(id: string) {
    return findReduxStores().find((f) => f.id === id)?.store ?? null;
  }

  // ---------- 对外动作 ----------
  function listAll(): Summary[] {
    return [...listPinia(), ...listVuex(), ...listRedux()];
  }

  function getSnapshot(framework: Framework, id: string) {
    if (framework === 'pinia') {
      const store = getPiniaStore(id);
      if (!store) throw new Error(`未找到 Pinia store：${id}`);
      const { data, truncated } = safeClone(store.$state);
      return {
        framework, id, label: `Pinia · ${id}`, editable: true, state: data, truncated,
      };
    }
    if (framework === 'vuex') {
      const store = getVuexStore(id);
      if (!store) throw new Error('未找到 Vuex store');
      const { data, truncated } = safeClone(store.state);
      return {
        framework, id, label: id === 'vuex' ? 'Vuex' : `Vuex · ${id}`,
        editable: typeof store.replaceState === 'function',
        state: data,
        truncated,
      };
    }
    const store = getReduxStore(id);
    if (!store) throw new Error('未找到 Redux store');
    const { data, truncated } = safeClone(store.getState());
    return {
      framework, id, label: id === 'redux' ? 'Redux' : `Redux · ${id}`,
      editable: false, state: data, truncated,
    };
  }

  function applySet(framework: Framework, id: string, path: string[], value: unknown) {
    if (framework === 'pinia') {
      const store = getPiniaStore(id);
      if (!store) throw new Error(`未找到 Pinia store：${id}`);
      store.$patch((state: Record<string, unknown>) => {
        setByPath(state, path, value);
      });
      return;
    }
    if (framework === 'vuex') {
      const store = getVuexStore(id);
      if (!store) throw new Error('未找到 Vuex store');
      if (typeof store.replaceState !== 'function') throw new Error('当前 Vuex 无 replaceState，无法写入');
      const next = deepCloneJson(store.state) as Record<string, unknown>;
      setByPath(next, path, value);
      store.replaceState(next);
      return;
    }
    throw new Error('Redux 暂不支持直接字段写入（缺少通用 patch API）。请复制 JSON 后在业务里改，或暴露可写 store。');
  }

  function handle(req: {
    action: string;
    framework?: Framework;
    id?: string;
    path?: string[];
    value?: unknown;
  }) {
    switch (req.action) {
      case 'list':
        return listAll();
      case 'get':
        if (!req.framework || !req.id) throw new Error('缺少 framework/id');
        return getSnapshot(req.framework, req.id);
      case 'set':
        if (!req.framework || !req.id || !req.path) throw new Error('缺少写入参数');
        applySet(req.framework, req.id, req.path, req.value);
        return { applied: true };
      default:
        throw new Error(`未知动作：${req.action}`);
    }
  }

  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== 'req') return;
    const { id, payload } = data as { id: string; payload: Parameters<typeof handle>[0] };
    try {
      const result = handle(payload);
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
  };

  // 幂等：避免重复监听
  const FLAG = '__EFFICIENCY_STORE_PROBE__';
  const g = window as unknown as Record<string, unknown>;
  if (!g[FLAG]) {
    g[FLAG] = true;
    window.addEventListener('message', onMessage);
  }
})();
