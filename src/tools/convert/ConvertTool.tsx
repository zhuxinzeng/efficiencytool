// 文件转 Markdown：docx / pdf / txt / html / csv / json 等，本地解析后预览、复制或下载 .md
import { useMemo, useState } from 'react';
import { Alert, Button, Collapse, Space, Tag, Typography, Upload } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { CopyBtn } from '../../components/CopyBtn';
import { ACCEPT_EXTENSIONS, convertFile } from '../../utils/file-to-markdown';

const { Paragraph, Text } = Typography;

type JobStatus = 'converting' | 'done' | 'error';

interface Job {
  id: string;
  name: string;
  size: number;
  status: JobStatus;
  markdown?: string;
  warnings?: string[];
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/\.[^.]+$/, '') + '.md';
  a.click();
  URL.revokeObjectURL(url);
}

export function ConvertTool() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const handleFiles = async (files: File[]) => {
    const items: Job[] = files.map((f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      size: f.size,
      status: 'converting',
    }));
    setJobs((prev) => [...items, ...prev]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const job = items[i];
      try {
        const result = await convertFile(file);
        setJobs((prev) => prev.map((j) => (j.id === job.id
          ? { ...j, status: 'done', markdown: result.markdown, warnings: result.warnings }
          : j)));
        setOpenKeys((prev) => (prev.includes(job.id) ? prev : [...prev, job.id]));
      } catch (e) {
        setJobs((prev) => prev.map((j) => (j.id === job.id
          ? { ...j, status: 'error', error: e instanceof Error ? e.message : String(e) }
          : j)));
      }
    }
  };

  const allMarkdown = useMemo(
    () => jobs
      .filter((j) => j.status === 'done' && j.markdown)
      .map((j) => `# ${j.name}\n\n${j.markdown}`)
      .join('\n\n---\n\n'),
    [jobs],
  );

  return (
    <div>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        文件转 Markdown：Word（.docx）、PDF、HTML、CSV/TSV、JSON、TXT 全部在本地解析，不上传任何服务器。PDF 仅提取文本，版式与图片不保留。
      </Paragraph>

      <Upload.Dragger
        multiple
        accept={ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(',')}
        showUploadList={false}
        beforeUpload={(file) => {
          void handleFiles([file]);
          return false;
        }}
        style={{ marginBottom: 12 }}
      >
        <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
          <InboxOutlined />
        </p>
        <p className="ant-upload-text" style={{ fontSize: 13 }}>点击或拖拽文件到此处</p>
        <p className="ant-upload-hint" style={{ fontSize: 12 }}>
          支持 {ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' / ')}（.doc 请先另存为 .docx）
        </p>
      </Upload.Dragger>

      {jobs.length > 0 && (
        <Space wrap size={8} style={{ marginBottom: 10 }}>
          <Tag>{jobs.filter((j) => j.status === 'done').length} / {jobs.length} 已完成</Tag>
          <CopyBtn size="small" text={allMarkdown} successText="已复制全部 Markdown">复制全部</CopyBtn>
          <Button size="small" onClick={() => setJobs([])}>清空列表</Button>
        </Space>
      )}

      {jobs.length === 0 && <div className="empty-hint">选择文件后自动转换，结果可预览、复制或下载 .md</div>}

      <Collapse
        size="small"
        activeKey={openKeys}
        onChange={(keys) => setOpenKeys(Array.isArray(keys) ? keys : [keys])}
        items={jobs.map((job) => ({
          key: job.id,
          label: (
            <Space size={6} wrap>
              <Text style={{ fontSize: 13 }} ellipsis>{job.name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(job.size)}</Text>
              {job.status === 'converting' && <Tag color="processing">转换中</Tag>}
              {job.status === 'done' && <Tag color="success">完成</Tag>}
              {job.status === 'error' && <Tag color="error">失败</Tag>}
            </Space>
          ),
          children: job.status === 'error' ? (
            <Alert type="error" showIcon message={job.error} />
          ) : job.status === 'converting' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>正在本地解析…</Text>
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {job.warnings?.map((w) => <Alert key={w} type="warning" showIcon message={w} />)}
              <Space size={8} wrap>
                <CopyBtn size="small" text={job.markdown ?? ''} successText="已复制 Markdown">复制</CopyBtn>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => download(job.name, job.markdown ?? '')}
                >
                  下载 .md
                </Button>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {(job.markdown ?? '').length} 字符
                </Text>
              </Space>
              <pre className="result-pre" style={{ maxHeight: 320 }}>{job.markdown}</pre>
            </Space>
          ),
        }))}
      />
    </div>
  );
}