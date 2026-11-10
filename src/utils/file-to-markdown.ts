// 文件转 Markdown：docx / pdf / txt / md / html / csv / json 等，纯本地解析，不上传文件
// 新增格式只需往 CONVERTERS 里加一项，UI 会自动识别扩展名

export interface ConvertResult {
  markdown: string;
  warnings: string[];
}

export interface FileConverter {
  id: string;
  label: string;
  extensions: string[];
  convert: (file: File) => Promise<ConvertResult>;
}

function readText(file: File): Promise<string> {
  return file.text();
}

async function createTurndown() {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import('turndown'),
    import('turndown-plugin-gfm'),
  ]);
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  service.use(gfm);
  return service;
}

/** 解析 CSV / TSV 为二维数组（支持双引号包裹与转义） */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function toMarkdownTable(rows: string[][]): string {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const normalize = (r: string[]) => Array.from({ length: width }, (_v, i) => (r[i] ?? '').replace(/\|/g, '\\|').trim());
  const header = normalize(rows[0]);
  const body = rows.slice(1).map(normalize);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

const docxConverter: FileConverter = {
  id: 'docx',
  label: 'Word (.docx)',
  extensions: ['docx'],
  convert: async (file) => {
    const warnings: string[] = [];
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    let html = result.value;
    const images = (html.match(/<img\b/g) || []).length;
    if (images) {
      html = html.replace(/<img[^>]*>/g, '');
      warnings.push(`已省略 ${images} 张内嵌图片（避免生成超大 Markdown）`);
    }
    const turndown = await createTurndown();
    const markdown = turndown.turndown(html);
    if (result.messages?.length) {
      warnings.push(`解析提示：${result.messages.slice(0, 3).map((m) => m.message).join('；')}`);
    }
    return { markdown, warnings };
  },
};

const pdfConverter: FileConverter = {
  id: 'pdf',
  label: 'PDF',
  extensions: ['pdf'],
  convert: async (file) => {
    const warnings: string[] = ['PDF 仅提取文本内容，排版、图片与表格结构不会保留'];
    const pdfjs = await import('pdfjs-dist');
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        const textItem = item as { str?: string; hasEOL?: boolean };
        if (typeof textItem.str !== 'string') continue;
        line += textItem.str;
        if (textItem.hasEOL) {
          lines.push(line.trim());
          line = '';
        }
      }
      if (line.trim()) lines.push(line.trim());

      // 按句末标点/空行粗分段落，尽量还原可读结构
      const paragraphs: string[] = [];
      let buffer = '';
      for (const l of lines) {
        if (!l) {
          if (buffer) paragraphs.push(buffer.trim());
          buffer = '';
          continue;
        }
        buffer += buffer ? ` ${l}` : l;
        if (/[。！？；.!?:：]$/.test(l) && buffer.length > 40) {
          paragraphs.push(buffer.trim());
          buffer = '';
        }
      }
      if (buffer.trim()) paragraphs.push(buffer.trim());
      if (paragraphs.length) pages.push(paragraphs.join('\n\n'));
    }
    await loadingTask.destroy();
    if (!pages.length) warnings.push('未提取到文本：可能是扫描件/图片型 PDF');
    return { markdown: pages.join('\n\n---\n\n'), warnings };
  },
};

export const CONVERTERS: FileConverter[] = [
  docxConverter,
  pdfConverter,
  {
    id: 'txt',
    label: '纯文本 (.txt)',
    extensions: ['txt', 'log'],
    convert: async (file) => ({ markdown: await readText(file), warnings: [] }),
  },
  {
    id: 'md',
    label: 'Markdown (.md)',
    extensions: ['md', 'markdown'],
    convert: async (file) => ({ markdown: await readText(file), warnings: [] }),
  },
  {
    id: 'html',
    label: 'HTML (.html)',
    extensions: ['html', 'htm'],
    convert: async (file) => {
      const turndown = await createTurndown();
      return { markdown: turndown.turndown(await readText(file)), warnings: [] };
    },
  },
  {
    id: 'csv',
    label: 'CSV / TSV',
    extensions: ['csv', 'tsv'],
    convert: async (file) => {
      const text = await readText(file);
      const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
      return { markdown: toMarkdownTable(parseDelimited(text, delimiter)), warnings: [] };
    },
  },
  {
    id: 'json',
    label: 'JSON',
    extensions: ['json'],
    convert: async (file) => {
      const text = await readText(file);
      try {
        return { markdown: `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``, warnings: [] };
      } catch {
        return { markdown: `\`\`\`json\n${text}\n\`\`\``, warnings: ['JSON 解析失败，已原样输出'] };
      }
    },
  },
];

/** 支持的全部扩展名（用于 Upload accept） */
export const ACCEPT_EXTENSIONS = CONVERTERS.flatMap((c) => c.extensions);

export function findConverter(fileName: string): FileConverter | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'doc') return null; // 旧版二进制 .doc 不支持，提示另存为 docx
  return CONVERTERS.find((c) => c.extensions.includes(ext)) ?? null;
}

export async function convertFile(file: File): Promise<ConvertResult> {
  const converter = findConverter(file.name);
  if (!converter) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'doc') throw new Error('旧版 .doc 不支持，请在 Word 中另存为 .docx 后重试');
    throw new Error(`暂不支持 .${ext || '未知'} 格式`);
  }
  return converter.convert(file);
}