import type { CollectionEntry } from 'astro:content';
import { blogTagLabel } from './blog-tags';
import { blogUpdatedAt } from './blog-dates';

export const sourceReadingPath = '/article/unreal-engine/source-reading/';

export const sourceReadingTag = 'source-reading';

export function sourceReadingHighlights(articles: CollectionEntry<'blog'>[]) {
  return [...articles]
    .sort((a, b) => blogUpdatedAt(b).getTime() - blogUpdatedAt(a).getTime())
    .slice(0, 5);
}

export function sourceReadingTopics(post: CollectionEntry<'blog'>) {
  return [...new Set(post.data.tags.map(tag => tag.trim()))]
    .filter(tag => tag && tag !== sourceReadingTag && tag !== 'Unreal Engine');
}

export function buildSourceReadingSection(posts: CollectionEntry<'blog'>[]) {
  const articles = posts.filter(post => !post.data.draft && post.data.tags.some(tag => tag.trim() === sourceReadingTag))
    .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());

  const counts = new Map<string, number>();

  articles.forEach(post => sourceReadingTopics(post).forEach(tag => counts.set(tag, (counts.get(tag) ?? 0) + 1)));

  const topics = [...counts].map(([tag, count]) => ({ tag, label: blogTagLabel(tag), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

  return { articles, topics, count: articles.length, latestPublishedAt: articles[0]?.data.publishedAt };
}
