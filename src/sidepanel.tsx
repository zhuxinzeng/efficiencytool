// Chrome 侧边栏入口：H5 紧凑壳，无左侧菜单；右上角可开全屏窗口（含左侧菜单）
import { createRoot } from 'react-dom/client';
import { CompactShell } from './shared/CompactShell';
import { ThemeProvider } from './shared/theme';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CompactShell variant="sidepanel" expandMode="window" />
  </ThemeProvider>,
);
