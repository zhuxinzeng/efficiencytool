// 生成扩展图标：SVG 源 → 16/32/48/128 PNG（一次性脚本，产物提交到 public/icons/）
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');

// 蓝紫渐变圆角方块 + 白色闪电，贴合「效率工具」主题
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1677ff"/>
      <stop offset="1" stop-color="#722ed1"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <path fill="#ffffff" d="M73.5 14 38 70h21l-7.5 44L92 56H68l14-42z"/>
</svg>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'icon.svg'), svg);

for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png()
    .toFile(resolve(outDir, `icon${size}.png`));
  console.log(`已生成 icon${size}.png`);
}
