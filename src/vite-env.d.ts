/// <reference types="vite/client" />

// turndown-plugin-gfm 无官方类型声明，这里补充最小定义
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}