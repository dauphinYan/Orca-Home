import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const blogRoot = fileURLToPath(new URL('../src/content/blog/', import.meta.url));

const readline = createInterface({ input: process.stdin, output: process.stdout });

const lines = readline[Symbol.asyncIterator]();

let cancelled = false;

readline.on('SIGINT', () => {
  cancelled = true;
  readline.close();
});

async function ask(prompt) {
  process.stdout.write(prompt);

  const answer = await lines.next();

  if (cancelled || answer.done) {
    throw new Error('CANCELLED');
  }

  return answer.value.trim();
}

async function required(prompt) {
  while (true) {
    const value = await ask(prompt);

    if (value) {
      return value;
    }

    console.log('此项不能为空，请重新填写。');
  }
}

async function chooseFile() {
  while (true) {
    const input = await required('文件路径（例如 my-post 或 unreal-engine/study/my-post）：');

    const slug = input.replace(/\.md$/, '');

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(slug)) {
      console.log('请使用英文小写字母、数字和短横线，以 / 分隔目录；不能使用绝对路径或 ..。');
      continue;
    }

    const filename = path.join(blogRoot, `${slug}.md`);

    const directories = slug.split('/').slice(0, -1);

    let directory = blogRoot;

    for (const segment of ['', ...directories]) {
      directory = path.join(directory, segment);

      try {
        const info = await lstat(directory);

        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new Error('博客路径必须使用普通目录，不能使用目录链接。');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    try {
      await lstat(filename);
      console.log('该路径已存在，请换一个文件路径。');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      return { filename, slug };
    }
  }
}

function localDate() {
  const now = new Date();

  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

async function main() {
  console.log('创建博客草稿（按 Ctrl+C 取消）');

  const title = await required('文章标题：');

  const { filename, slug } = await chooseFile();

  const description = await ask('文章摘要（可留空）：');

  const tagsInput = await ask('标签（使用逗号分隔，可留空）：');

  const tags = tagsInput.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);

  const content = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `publishedAt: ${localDate()}`,
    `tags: ${JSON.stringify(tags)}`,
    'draft: true',
    '---',
    '',
    '在这里写文章摘要或开场内容。',
    '',
    '## 小节标题',
    '',
    '在这里继续写正文。',
    '',
  ].join('\n');

  if (cancelled) {
    throw new Error('CANCELLED');
  }

  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content, { encoding: 'utf8', flag: 'wx' });

  console.log(`\n草稿已创建：${filename}`);
  console.log('填写正文后，将 draft 改为 false 即可发布。');
  console.log(`文章地址：/article/blog/${slug}/`);
}

try {
  await main();
} catch (error) {
  if (error.message === 'CANCELLED') {
    console.log('\n已取消，未生成文章。');
  } else {
    console.error(`创建失败：${error.message}`);
    process.exitCode = 1;
  }
} finally {
  readline.close();
}
