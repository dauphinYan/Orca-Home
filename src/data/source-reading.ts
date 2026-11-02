import type { CollectionEntry } from 'astro:content';
import { blogTagLabel } from './blog-tags';
import { blogUpdatedAt } from './blog-dates';

export const sourceReadingPath = '/article/unreal-engine/source-reading/';

const sourceReadingTags = new Set(['源码解读', 'Source Reading']);

type BlogPost = CollectionEntry<'blog' | 'blogEnglish'>;

export function sourceReadingHighlights<T extends BlogPost>(articles: T[]) {
  return [...articles]
    .sort((a, b) => blogUpdatedAt(b).getTime() - blogUpdatedAt(a).getTime())
    .slice(0, 5);
}

export function sourceReadingTopics(post: BlogPost) {
  return [...new Set(post.data.tags.map(tag => tag.trim()))]
    .filter(tag => tag && !sourceReadingTags.has(tag) && tag !== 'Unreal Engine');
}

export function buildSourceReadingSection<T extends BlogPost>(posts: T[], language: 'zh' | 'en' = 'zh') {
  const collection = language === 'en' ? 'blogEnglish' : 'blog';

  const articles = posts.filter(post => post.collection === collection && !post.data.draft && post.data.tags.some(tag => sourceReadingTags.has(tag.trim())))
    .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());

  const counts = new Map<string, number>();

  articles.forEach(post => sourceReadingTopics(post).forEach(tag => counts.set(tag, (counts.get(tag) ?? 0) + 1)));

  const topics = [...counts].map(([tag, count]) => ({ tag, label: blogTagLabel(tag), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

  return { articles, topics, count: articles.length, latestPublishedAt: articles[0]?.data.publishedAt };
}
