import { getCollection } from 'astro:content';
import { blogTagLabel } from '../data/blog-tags';
import { articleMessages } from './article-messages';

export interface PageTranslationConfig {
  path: string;
  messages: Record<string, string>;
}

const modules = import.meta.glob<{ default: PageTranslationConfig }>('./pages/*.ts', { eager: true });

const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/';

const pages = new Map<string, Record<string, string>>();

for (const { default: config } of Object.values(modules)) {
  const path = normalizePath(config.path);

  if (pages.has(path)) throw new Error(`Duplicate translation configuration: ${path}`);

  if (Object.keys(config.messages).length > 0) pages.set(path, config.messages);
}

export async function getPageTranslations(path: string) {
  const pathname = normalizePath(path);

  const configured = pages.get(pathname);

  const blogPage = pathname.startsWith('/article/blog/');

  const articleIndex = pathname === '/article' || pathname === '/article/unreal-engine/source-reading';

  if (!blogPage && (!articleIndex || !configured)) return configured;

  const englishPosts = await getCollection('blogEnglish', ({ data }) => !data.draft);

  const currentPost = englishPosts.find(post => pathname === `/article/blog/${post.id}`);

  if (blogPage && !currentPost) return configured;

  const messages = { ...articleMessages, ...configured };

  const originals = await getCollection('blog', ({ data }) => !data.draft);

  for (const original of originals) {
    const translated = englishPosts.find(post => post.id === original.id);

    if (!translated) continue;

    messages[original.data.title] = translated.data.title;
    messages[`${original.data.title} - Orca丶的博客`] = `${translated.data.title} — Orca丶's Blog`;
    messages[`阅读：${original.data.title}`] = `Read: ${translated.data.title}`;

    if (original.data.description) messages[original.data.description] = translated.data.description;

    const labels = original.data.tags.map(blogTagLabel);

    messages[labels.join(' / ')] = labels.map(label => articleMessages[label] ?? label).join(' / ');

    const date = original.data.publishedAt;

    const zhDate = date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

    const enDate = date.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });

    const tag = blogTagLabel(original.data.tags[0] ?? 'DEVLOG');

    messages[`${tag} / ${zhDate}`] = `${articleMessages[tag] ?? tag} / ${enDate}`;
  }

  return messages;
}

