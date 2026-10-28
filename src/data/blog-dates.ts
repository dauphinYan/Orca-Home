import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import type { CollectionEntry } from 'astro:content';

const root = process.cwd();

let modifiedDates: Map<string, Date> | undefined;

function getModifiedDates() {
  if (modifiedDates) return modifiedDates;

  // Read history once per build, with NUL separators for paths containing spaces.
  const history = execFileSync('git', [
    'log', '--format=commit:%ct', '--name-only', '-z', '--no-renames',
    '--', 'src/content/blog', 'src/content/blog-en',
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  const dates = new Map<string, Date>();

  let committedAt: Date | undefined;

  for (const entry of history.split('\0')) {
    const value = entry.replace(/^\r?\n/, '');

    if (value.startsWith('commit:')) {
      committedAt = new Date(Number(value.slice(7)) * 1000);
    } else if (value && committedAt && !dates.has(value)) {
      dates.set(value, committedAt);
    }
  }

  modifiedDates = dates;

  return dates;
}

export function blogUpdatedAt(post: CollectionEntry<'blog' | 'blogEnglish'>): Date {
  if (!post.filePath) return post.data.publishedAt;

  const path = relative(root, resolve(root, post.filePath)).replaceAll('\\', '/');

  const modifiedAt = getModifiedDates().get(path);

  // New/untracked articles use their publication date, never the checkout time.
  return modifiedAt && modifiedAt > post.data.publishedAt ? modifiedAt : post.data.publishedAt;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function blogDate(date: Date): string {
  return dateFormatter.format(date);
}

export function blogHasUpdate(post: CollectionEntry<'blog' | 'blogEnglish'>): boolean {
  return blogDate(blogUpdatedAt(post)) !== blogDate(post.data.publishedAt);
}
