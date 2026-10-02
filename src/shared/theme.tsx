// antd 主题：中文 locale + 蓝紫主色（与扩展图标呼应），App 组件提供 message 上下文
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import type { ReactNode } from 'react';

dayjs.locale('zh-cn');

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          borderRadius: 8,
          colorBgLayout: '#f5f7fa',
        },
        components: {
          Table: {
            // 表头浅蓝灰底，配合圆角更精致
            headerBg: 'rgba(22, 119, 255, 0.05)',
            headerColor: 'rgba(0, 0, 0, 0.72)',
            rowHoverBg: 'rgba(22, 119, 255, 0.035)',
          },
        },
      }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}