// CORS 临时绕过：一键注入 Access-Control-Allow-* 响应头，覆盖目标站点的 CORS 策略
// 比关闭浏览器安全策略更规范：仅按 URL 规则注入响应头，不影响其他站点
import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Space, Switch, Typography } from 'antd';
import { getCorsConfig, saveCorsConfig, type CorsConfig } from '../../utils/dnr-rules';

const { Paragraph } = Typography;

export function CorsTool() {
  const { message } = App.useApp();
  const [config, setConfig] = useState<CorsConfig | null>(null);
  const [form] = Form.useForm<CorsConfig>();

  useEffect(() => {
    void (async () => {
      const c = await getCorsConfig();
      setConfig(c);
      form.setFieldsValue(c);
    })();
  }, [form]);

  const toggle = async (enabled: boolean) => {
    if (!config) return;
    const values = await form.validateFields().catch(() => config);
    const next = { ...config, ...values, enabled };
    setConfig(next);
    await saveCorsConfig(next);
    message.success(enabled ? 'CORS 绕过已开启（立即生效）' : 'CORS 绕过已关闭');
  };

  const save = async () => {
    const values = await form.validateFields();
    const next = { ...config, ...values } as CorsConfig;
    setConfig(next);
    await saveCorsConfig(next);
    message.success('配置已保存并生效');
  };

  if (!config) return null;

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        开发本地调试专用：一键为指定 URL 注入 <Typography.Text code>Access-Control-Allow-*</Typography.Text> 响应头，绕过跨域限制（仅改响应头，不动浏览器安全设置）。用完请及时关闭。
      </Paragraph>

      {config.enabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="CORS 绕过已开启"
          description="当前处于跨域放开状态，仅限本地调试使用，测试完请关闭。"
        />
      )}

      <Form form={form} layout="vertical">
        <Form.Item label="一键开关">
          <Switch checked={config.enabled} checkedChildren="开启" unCheckedChildren="关闭" onChange={toggle} />
        </Form.Item>
        <Form.Item
          name="urlFilter"
          label="生效的 URL 匹配"
          extra="默认 *://*/*（全部请求）；建议收窄到目标接口域名，如 *://api.example.com/*"
        >
          <Input placeholder="*://*/*" />
        </Form.Item>
        <Space size={12} wrap>
          <Form.Item
            name="origin"
            label="Allow-Origin"
            extra="开启 Credentials 时需填具体源，* 会被浏览器拒绝"
            style={{ minWidth: 220 }}
          >
            <Input placeholder="*" />
          </Form.Item>
          <Form.Item name="credentials" label="Allow-Credentials">
            <Switch checkedChildren="true" unCheckedChildren="false" />
          </Form.Item>
        </Space>
        <Space size={12} wrap>
          <Form.Item name="allowHeaders" label="Allow-Headers" style={{ minWidth: 220 }}>
            <Input placeholder="*" />
          </Form.Item>
          <Form.Item name="allowMethods" label="Allow-Methods" style={{ minWidth: 220 }}>
            <Input placeholder="*" />
          </Form.Item>
        </Space>
        <Button type="primary" onClick={save}>保存并生效</Button>
      </Form>
    </div>
  );
}
