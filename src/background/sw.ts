// 后台 Service Worker：DNR 同步 + debugger 引擎
// 点击工具栏图标 → 打开 Side Panel（独立于页面，跨域名跳转不丢录制/面板）
import { syncAllRules } from '../utils/dnr-rules';
import './debugger';

chrome.runtime.onInstalled.addListener(() => {
  void syncAllRules();
});

chrome.runtime.onStartup.addListener(() => {
  void syncAllRules();
});

// 点击扩展图标打开侧边栏（不挂在页面 DOM 上，换域名也不会被卸载）
if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
