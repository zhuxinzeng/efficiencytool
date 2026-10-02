// 时间戳转换：时间戳（秒/毫秒自动识别）→ 多格式时间；时间选择 → 时间戳
import { useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Input, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { CopyBtn } from '../../components/CopyBtn';

const { Paragraph, Text } = Typography;

dayjs.extend(relativeTime);

export function TimestampTool() {
  const [tsInput, setTsInput] = useState('');
  const [date, setDate] = useState<Dayjs | null>(dayjs());

  // 时间戳 → 时间：秒/毫秒自动识别（≥ 1e12 视为毫秒）
  const parsed = useMemo(() => {
    const t = tsInput.trim();
    if (!t) return null;
    if (!/^\d{1,16}$/.test(t)) return { error: '请输入纯数字时间戳（秒或毫秒）' };
    const n = Number(t);
    const ms = n >= 1e12 ? n : n * 1000;
    const d = dayjs(ms);
    if (!d.isValid() || d.year() < 1970 || d.year() > 9999) return { error: '时间戳超出合理范围' };
    return { d, ms };
  }, [tsInput]);

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        时间戳与时间互转：秒/毫秒自动识别（13 位以上按毫秒处理）。
      </Paragraph>

      <div className="tool-section">
        <div className="tool-section-title">时间戳 → 时间</div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="如 1727748000 或 1727748000000"
            value={tsInput}
            onChange={(e) => setTsInput(e.target.value)}
            allowClear
          />
          <Button onClick={() => setTsInput(String(Math.floor(Date.now() / 1000)))}>现在</Button>
        </Space.Compact>
        {parsed && (
          <div style={{ marginTop: 12 }}>
            {'error' in parsed ? (
              <Alert type="warning" showIcon message={parsed.error} />
            ) : (
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="标准格式"><Text copyable>{parsed.d.format('YYYY-MM-DD HH:mm:ss')}</Text></Descriptions.Item>
                <Descriptions.Item label="ISO 8601"><Text copyable>{parsed.d.toISOString()}</Text></Descriptions.Item>
                <Descriptions.Item label="中文格式"><Text copyable>{parsed.d.format('YYYY年MM月DD日 dddd HH:mm:ss')}</Text></Descriptions.Item>
                <Descriptions.Item label="相对时间">{parsed.d.fromNow()}（{parsed.d.format('YYYY-MM-DD HH:mm')}）</Descriptions.Item>
                <Descriptions.Item label="毫秒 / 秒">
                  <Space size={4}>
                    <Text code copyable>{String(parsed.ms)}</Text>
                    <Text code copyable>{String(Math.floor(parsed.ms / 1000))}</Text>
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            )}
          </div>
        )}
      </div>

      <div className="tool-section">
        <div className="tool-section-title">时间 → 时间戳</div>
        <Space wrap>
          <DatePicker
            showTime
            value={date}
            onChange={setDate}
            placeholder="选择日期时间"
            format="YYYY-MM-DD HH:mm:ss"
          />
          <Button onClick={() => setDate(dayjs())}>现在</Button>
        </Space>
        {date && (
          <Descriptions size="small" column={1} bordered style={{ marginTop: 12 }}>
            <Descriptions.Item label="秒">
              <Space>
                <Text code>{String(date.unix())}</Text>
                <CopyBtn size="small" type="text" text={String(date.unix())} />
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="毫秒">
              <Space>
                <Text code>{String(date.valueOf())}</Text>
                <CopyBtn size="small" type="text" text={String(date.valueOf())} />
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}
      </div>
    </div>
  );
}
