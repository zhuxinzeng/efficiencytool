// popup 紧凑壳入口（若重新启用 default_popup 时使用）
import { createRoot } from 'react-dom/client';
import { CompactShell } from './shared/CompactShell';
import { ThemeProvider } from './shared/theme';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CompactShell variant="popup" expandMode="window" />
  </ThemeProvider>,
);
