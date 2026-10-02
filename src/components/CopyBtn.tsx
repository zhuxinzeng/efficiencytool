import { Button, App, type ButtonProps } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { copyText } from '../shared/clipboard';

interface CopyBtnProps extends Omit<ButtonProps, 'onClick'> {
  text: string;
  /** 复制成功提示，默认「已复制」 */
  successText?: string;
}

/** 复制按钮：复制成功/失败给出 antd message 反馈 */
export function CopyBtn({ text, successText = '已复制', children, ...rest }: CopyBtnProps) {
  const { message } = App.useApp();
  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) {
      message.success(successText);
    } else {
      message.error('复制失败，请手动选择复制');
    }
  };
  return (
    <Button icon={<CopyOutlined />} onClick={handleCopy} {...rest}>
      {children ?? '复制'}
    </Button>
  );
}
