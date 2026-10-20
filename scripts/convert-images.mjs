import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));

async function visiblePixels(input) {
  const pixels = await sharp(input).ensureAlpha().raw().toBuffer();

  // 全透明像素的 RGB 不影响显示，WebP 会将其归零。
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) {
      pixels.fill(0, offset, offset + 3);
    }
  }

  return pixels;
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  const groups = await Promise.all(entries.map(entry => {
    const filename = path.join(directory, entry.name);

    return entry.isDirectory() ? filesIn(filename) : [filename];
  }));

  return groups.flat();
}

export async function convertImages() {
  const cachePath = path.join(root, '.astro/image-conversion.json');

  let cache = {};

  try {
    cache = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }

  const sources = (await Promise.all(['src/assets', 'public'].map(directory => filesIn(path.join(root, directory))))).flat();

  const replacements = new Map();

  let totalBefore = 0;

  let totalAfter = 0;

  for (const source of sources.filter(filename => /\.(png|jpe?g)$/i.test(filename))) {
    const input = await readFile(source);

    const relative = path.relative(root, source).replaceAll('\\', '/');

    const destination = relative === 'src/assets/projects/sword-world/image.png'
      ? path.join(path.dirname(source), 'architecture.webp')
      : source.replace(/\.[^.]+$/, '.webp');

    const fingerprint = createHash('sha256').update('webp-v1').update(input).digest('hex');

    let outputExists = false;

    try {
      outputExists = (await readFile(destination)).length > 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (cache[relative]?.fingerprint === fingerprint) {
      if (cache[relative].failed) continue;

      if (outputExists) {
        replacements.set(relative, path.relative(root, destination).replaceAll('\\', '/'));
        continue;
      }
    }

    let output;

    try {
      output = await sharp(input).webp({ lossless: true, effort: 6 }).toBuffer();
    } catch (error) {
      console.error(`跳过无法解码的图片：${source} (${error.message})`);
      cache[relative] = { fingerprint, failed: true };
      continue;
    }

    const originalPixels = await visiblePixels(input);

    const outputPixels = await visiblePixels(output);

    if (!originalPixels.equals(outputPixels)) {
      throw new Error(`无损验证失败：${source}`);
    }

    let mode = '无损';

    if (output.length >= input.length) {
      for (const quality of [90, 85, 80]) {
        output = await sharp(input).webp({ quality, effort: 6 }).toBuffer();
        mode = `有损 quality=${quality}`;

        if (output.length < input.length) {
          break;
        }
      }
    }

    await writeFile(destination, output);

    cache[relative] = { fingerprint };

    // 使用完整相对路径，避免误改其他目录中的同名图片。
    replacements.set(relative, path.relative(root, destination).replaceAll('\\', '/'));

    totalBefore += input.length;
    totalAfter += output.length;

    console.log(`${relative}: ${(input.length / 1024).toFixed(1)} → ${(output.length / 1024).toFixed(1)} KiB (${mode})`);
  }

  const textFiles = (await filesIn(path.join(root, 'src'))).filter(filename => /\.(astro|ts|js|css|md|mdx|json)$/i.test(filename));

  for (const filename of textFiles) {
    const original = await readFile(filename, 'utf8');

    let updated = original;

    for (const [source, destination] of replacements) {
      const relativeSource = path.relative(path.dirname(filename), path.join(root, source)).replaceAll('\\', '/');

      const relativeDestination = path.relative(path.dirname(filename), path.join(root, destination)).replaceAll('\\', '/');

      const sourceUrl = relativeSource.startsWith('.') ? relativeSource : `./${relativeSource}`;

      const destinationUrl = relativeDestination.startsWith('.') ? relativeDestination : `./${relativeDestination}`;

      updated = updated.replaceAll(sourceUrl, destinationUrl);

      if (source.startsWith('public/')) {
        updated = updated.replaceAll(`/${source.slice(7)}`, `/${destination.slice(7)}`);
      }
    }

    if (updated !== original) {
      await writeFile(filename, updated);
    }
  }

  await mkdir(path.dirname(cachePath), { recursive: true });

  await writeFile(cachePath, JSON.stringify(cache, null, 2));

  if (totalBefore) {
    console.log(`合计：${(totalBefore / 1024).toFixed(1)} → ${(totalAfter / 1024).toFixed(1)} KiB；无损版本已通过像素验证。`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await convertImages();
}
