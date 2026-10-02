// DevTools 入口：注册「效率工具箱」面板（出现在 F12 面板栏）
chrome.devtools.panels.create(
  '效率工具箱',
  'icons/icon16.png',
  'src/panel.html',
  () => {
    // 面板创建回调，无需处理
  },
);
