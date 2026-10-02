// 剪贴板：优先 navigator.clipboard，失败时退回 execCommand（兼容失焦场景）
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 多条记录复制为 TSV（可直接粘贴进 Excel/表格） */
export function toTsv(headers: string[], rows: string[][]): string {
  return [headers.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
}
