import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const blogRoot = path.resolve(fileURLToPath(new URL('../src/content/blog/', import.meta.url)));

const outputRoot = fileURLToPath(new URL('../public/_blog-images/', import.meta.url));

const targetBytes = 100 * 1024;

const images = new Map();

async function compress(source) {
  const input = await readFile(source);

  const metadata = await sharp(input).metadata();

  if ((metadata.pages ?? 1) > 1) {
    throw new Error(`博客截图压缩不支持动画，请使用静态截图：${source}`);
  }

  const hash = createHash('sha256').update('blog-webp-v1').update(input).digest('hex').slice(0, 24);

  const filename = `${hash}.webp`;

  let width = Math.min(metadata.width, 1600);

  let result;

  while (true) {
    for (const quality of [85, 75, 65, 55]) {
      result = await sharp(input).rotate().resize({ width, withoutEnlargement: true }).webp({ quality, effort: 6 }).toBuffer();

      if (result.length <= targetBytes) {
        break;
      }
    }

    if (result.length <= targetBytes) {
      break;
    }

    if (width <= 640) {
      throw new Error(`截图无法在宽度不低于 640px、质量不低于 55 的标准下压到 100KB，请拆分截图：${source}`);
    }

    width = Math.max(640, Math.floor(width * 0.8));
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, filename), result);

  console.log(`[blog-images] ${path.relative(blogRoot, source)} → ${(result.length / 1024).toFixed(1)}KB (${width}px)`);

  return filename;
}

export function remarkBlogImages({ base = '/' } = {}) {
  return async (tree, file) => {
    const filename = file.path || file.history?.[0];

    if (!filename || !path.resolve(filename).startsWith(`${blogRoot}${path.sep}`)) {
      return;
    }

    const definitions = new Map();

    const targets = new Set();

    function walk(node) {
      if (node.type === 'definition') {
        definitions.set(node.identifier, node);
      }

      if (node.type === 'image') {
        targets.add(node);
      }

      for (const child of node.children ?? []) {
        walk(child);
      }
    }

    walk(tree);

    function references(node) {
      if (node.type === 'imageReference' && definitions.has(node.identifier)) {
        targets.add(definitions.get(node.identifier));
      }

      for (const child of node.children ?? []) {
        references(child);
      }
    }

    references(tree);

    for (const node of targets) {
      const url = node.url;

      if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(url)) {
        throw new Error(`图片使用了本机绝对路径，发布后无法显示，请复制到文章旁并使用相对路径：${url}`);
      }

      if (/^(?:https?:|data:|\/)/i.test(url)) {
        continue;
      }

      if (/^[a-z][a-z\d+.-]*:/i.test(url)) {
        throw new Error(`不支持的博客图片地址：${url}`);
      }

      const source = path.resolve(path.dirname(filename), decodeURIComponent(url).replaceAll('\\', '/'));

      if (!source.startsWith(`${blogRoot}${path.sep}`)) {
        throw new Error(`请将博客图片放在 src/content/blog 内：${url}`);
      }

      const info = await stat(source);

      const key = `${source}:${info.mtimeMs}:${info.size}`;

      if (!images.has(key)) {
        images.set(key, compress(source));
      }

      const output = await images.get(key);

      node.url = `${base.replace(/\/$/, '')}/_blog-images/${output}`;
    }
  };
}

export function blogImageDelivery() {
  return {
    name: 'blog-image-delivery',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const destination = fileURLToPath(new URL('_blog-images/', dir));

        await mkdir(destination, { recursive: true });

        for (const image of images.values()) {
          const filename = await image;

          await copyFile(path.join(outputRoot, filename), path.join(destination, filename));
        }
      },
    },
  };
}
