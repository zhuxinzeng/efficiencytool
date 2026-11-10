# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- 前端开发/联调工程师：本地开发、接口联调、造测试数据，以及复现跨页/跨 Tab 请求问题。
- 测试/QA：复现缺陷、抓取请求、生成企业与信用代码等测试数据。

## Product Purpose

面向日常前端开发与联调的 Chrome Manifest V3 扩展「效率工具箱」：把常用基础工具（企业信息、URL、时间戳、JSON）与网络调试能力（性能分析、CORS、接口录制、框架状态、DevTools 请求重放/GraphQL/重定向链）收进侧边栏、全屏窗口和 DevTools 面板，减少在多个页面与工具之间切换。

成功标准：常用联调动作能在当前浏览器内快速完成，结果可查看、复制或导出，且数据默认留在本机。

## Positioning

一站式本地开发工具箱。

与 Chrome DevTools 和单点抓包插件相比，差异不在某一项能力，而在于把“造数据 + 看网络 + 看框架状态 + 性能定位”放进同一个常驻侧边栏，并针对联调场景做跨页面/跨 Tab 的请求留存；不依赖自建后端。

## Operating Context

- Chrome / Chromium，Manifest V3；侧边栏、独立全屏窗口、DevTools 面板三个入口。
- 本地开发与接口联调：CORS、登录/跳转、新开 Tab 初始化请求、框架 store 状态、页面性能。
- 典型工作流：打开侧边栏 → 选工具 → 操作业务页 → 查看/筛选/复制/导出结果。
- 「接口录制」同时服务两类场景：
  - `chrome.debugger` 单 Tab 录制：含响应体，适合深看当前页。
  - `chrome.webRequest` 全局监听（B 方案）：跨 Tab、新开 Tab 初始化请求，保留路径、参数、状态与请求体，不提供响应体；保留最近约 10 秒滚动缓冲。
- 扩展权限包含 `<all_urls>`、`debugger`、`storage`、`sidePanel`、`declarativeNetRequest`、`scripting`，B 方案将增加 `webRequest`。
- 数据存储在本机 `chrome.storage.local`；无自建后端。
- 分发方式：内部/本地加载（unpacked），不上架 Chrome Web Store。

## Capabilities and Constraints

- 基础工具：URL 编解码（首页常驻，无需点击进入）、企业信息（名称 + GB 32100 / GB 11714 双层校验的统一社会信用代码生成与校验）、时间戳转换、JSON 格式化/压缩/校验、编码全家桶（Base64 / Base64URL / Hex / Unicode 转义 / HTML 实体 + Base64 图片预览）、Mock 数据（个人信息 / 企业信息 / 接口字段批量生成，CSV 导出）。
- 设计与文件：取色与配色（EyeDropper 屏幕取色、HEX/RGB/HSL/OKLCH 互转、WCAG 对比度、色阶）、字体与颜色审计（注入当前页统计字体族/字号/字重、颜色用量、CSS 变量）、文件转 Markdown（docx / pdf / txt / md / html / csv / json，纯本地解析）。
- 网络工具：性能分析（当前页 CWV / 资源 / 优化建议）、CORS 绕过（DNR 注入响应头，仅本地调试）、接口录制、框架状态（Pinia / Vuex / Redux 探测；Pinia、Vuex 支持简单字段写入，Redux 默认只读）。
- DevTools 面板：请求重放与修改、GraphQL 查询调试、重定向链查看（基于 HAR）。
- 接口录制现状：单 Tab `chrome.debugger` 录制 XHR / Fetch / Document（含 3xx 跳转链、响应体，最多 300 条，单条 body 超 64KB 截断）。
- B 方案能力：`chrome.webRequest` 全局监听，覆盖 `main_frame` / `sub_frame` / `xmlhttprequest`，跨 Tab 与录制开始前约 10 秒的滚动缓冲；与 debugger 单 Tab 录制并存，debugger 当前 Tab 优先保留响应体。
- 已知边界：
  - 受限页面（`chrome://`、Chrome 应用商店等）无法注入或调试。
  - `chrome.debugger` 会显示“正在调试此浏览器”横幅，且与 DevTools 互斥。
  - `webRequest` 不提供响应体；部分请求体（文件上传、特殊编码）可能缺失或不完整。
  - 300 条记录与 storage 配额为全局共享，不是按页面/按 Tab 分配。
- 无自建后端、无账号体系；当前不提供跨设备同步。

## Brand Commitments

- 产品名：效率工具箱。
- 现有图标：渐变底 + 白色闪电（`public/icons/icon.svg`）。
- 语气：简洁、直接、开发者向；中文文案为主。
- 未确认其他品牌规范；后续工作不要擅自引入新的品牌承诺。

## Evidence on Hand

- `README.md`：功能、使用注意、权限与目录结构。
- `manifest.json`：MV3 清单、版本、权限与入口。
- `src/shared/registry.tsx`：工具分组与副标题。
- `src/tools/netrecord/NetRecordTool.tsx`、`src/background/debugger.ts`：接口录制实现与限制。
- `src/panel/*`：DevTools 面板能力。
- `public/icons/*`：现有图标资产。
- 目前没有用户访谈、客户案例、benchmark、价格或商店素材；后续不得虚构。

## Product Principles

1. 常用联调动作在一个侧边栏内完成，减少工具切换。
2. 本地优先：数据默认留在本机，不引入不必要的后端或账号。
3. 针对真实联调痛点做深：跨页/跨 Tab 请求留存、CORS、框架状态、性能定位。
4. 能力透明：强权限、调试横幅、数据上限和“无响应体”等边界在 UI 与文档中说明。
5. 内部工具优先：以团队可用、可维护为先，不追求通用市场功能堆砌。