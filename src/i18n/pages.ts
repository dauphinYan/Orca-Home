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

  if (pathname.startsWith('/article/')) return { ...articleMessages, ...configured };

  return configured;
}
