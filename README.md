# 效率工具箱

面向前端日常开发与联调的 **Chrome Manifest V3** 扩展。

- 侧边栏（Side Panel）：点击工具栏图标打开，紧凑卡片布局  
- 全屏窗口：侧边栏右上角可打开，带左侧菜单  
- DevTools 面板：F12 →「效率工具箱」  

当前扩展版本见 [`manifest.json`](./manifest.json) 中的 `version`（如 `1.5.0`）。

## 功能

### 基础工具

| 工具 | 说明 |
|------|------|
| 企业信息 | 生成带「（测）」前缀的企业名称，以及符合 GB 32100 / GB 11714 双层校验的统一社会信用代码；支持校验任意信用代码 |
| URL 编解码 | encode / decode |
| 时间戳转换 | 时间戳与日期时间互转 |
| JSON 工具 | 格式化 / 压缩 / 校验 |

### 网络工具

| 工具 | 说明 |
|------|------|
| CORS 绕过 | 本地调试时按 URL 规则注入 `Access-Control-Allow-*`（**仅限本地，用完请关**） |
| 接口录制 | 录制当前 Tab 的 XHR / Fetch / Document（含 301/302 重定向链），跨站跳转后记录仍保留，可筛选导出 |
| 框架状态 | 探测当前页 **Pinia / Vuex / Redux** 状态树；Pinia、Vuex 支持简单字段写入；Redux 默认只读 |

### DevTools 面板

打开任意页面按 F12，选择 **效率工具箱**：

- 请求重放与修改  
- GraphQL 查询调试  
- 重定向链查看  

## 技术栈

- React 18 + TypeScript + Vite 5  
- Ant Design 5  
- `@crxjs/vite-plugin`  
- Manifest V3：`sidePanel`、`debugger`、`declarativeNetRequest`、`scripting`、`storage` 等  

## 环境

- Node.js 18+（建议 20 / 22）  
- Chrome（或支持 MV3 Side Panel 的 Chromium 内核浏览器）  

## 快速开始

```bash
# 若公司 npm 镜像异常，可改用官方源
npm install --registry=https://registry.npmjs.org

npm run dev      # 开发
npm run build    # 产出 dist/
npm run verify   # 企业信息 / 国标相关自检
```

### 加载到 Chrome

1. `npm run build`  
2. 打开 `chrome://extensions` → 开启「开发者模式」  
3. 「加载已解压的扩展程序」→ 选择本仓库的 **`dist`** 目录  
4. 点击工具栏图标打开侧边栏；首次使用「框架状态」前请先刷新业务页  

代码变更后重新构建（或按 `@crxjs` 开发提示操作），再在扩展页点击「重新加载」。

## 使用注意

| 场景 | 说明 |
|------|------|
| 接口录制 | 基于 `chrome.debugger`，开启后可能出现「正在调试此浏览器」横幅，属正常现象；停止录制且无其他调试能力占用后横幅会消失 |
| CORS 绕过 | 仅用于本地联调，勿在日常浏览中长期开启 |
| 框架状态 | 探测的是**当前活动标签页**；检测不到通常是页面未暴露 store，不保证所有项目可用 |
| 受限页面 | `chrome://`、Chrome 网上应用店等无法注入脚本 |

## 权限

扩展会申请 `<all_urls>`、`debugger` 等权限以便联调。请仅在可信环境使用，勿用于未授权抓包或绕过他人站点的安全策略。

## 目录结构（节选）

```
├── manifest.json       # 扩展清单与版本
├── vite.config.ts
├── scripts/
│   ├── verify.mts      # 自检
│   └── gen-icons.mjs
├── public/icons/
└── src/
    ├── background/     # Service Worker、debugger 引擎
    ├── content/        # 框架状态：MAIN 探测 + 隔离世界桥
    ├── tools/          # 各工具 UI
    ├── panel/          # DevTools 面板页
    ├── shared/         # 注册表、主题、协议与客户端
    ├── sidepanel.*     # 侧边栏入口
    └── full.tsx        # 全屏入口
```

## npm scripts

| 命令 | 说明 |
|------|------|
| `npm run dev` | Vite 开发服务 |
| `npm run build` | 类型检查 + 构建到 `dist/` |
| `npm run verify` | 运行 `scripts/verify.mts` |
| `npm run icons` | 重新生成图标 |

## 上传 GitHub 建议

1. 确认 `.gitignore` 已忽略 `node_modules/`、`dist/`（本仓库已配置）  
2. 本地 `npm run build`、`npm run verify` 通过后再推送  
3. 仓库描述可写：`Chrome 效率工具箱扩展（MV3）：企业信息、JSON、接口录制、框架状态…`  
4. 如需开源许可，请自行添加 `LICENSE`（如 MIT）；未添加时默认保留权利  

```bash
git init
git add .
git commit -m "chore: 初始化效率工具箱扩展"
# 在 GitHub 新建空仓库后：
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

## License

未附带 `LICENSE` 文件时，默认保留所有权利。欢迎按需补充开源协议。
