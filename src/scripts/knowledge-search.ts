import { localize } from '../i18n/client';

type SearchIndex = Record<string, string>;

async function fetchSearchIndex(): Promise<SearchIndex> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/article/unreal-engine/search-index.json`);

  if (!response.ok) throw new Error(`Search index returned ${response.status}`);
  return response.json();
}

export function initKnowledgeSearch() {
  const search = document.querySelector<HTMLInputElement>('[data-knowledge-search]');
  const result = document.querySelector<HTMLElement>('[data-knowledge-results]');

  if (!search || !result) return;

  const cards = [...document.querySelectorAll<HTMLElement>('[data-knowledge-card]')].map(element => ({
    element,
    href: element.dataset.knowledgeCard!,
    summary: (element.dataset.search ?? '').toLowerCase(),
  }));

  let pendingIndex: Promise<SearchIndex> | undefined;
  let searchIndex: SearchIndex | undefined;
  let updateVersion = 0;

  const update = async () => {
    const version = ++updateVersion;
    const query = search.value.trim().toLowerCase();
    let indexUnavailable = false;

    if (query && !searchIndex) {
      result.textContent = localize('正在加载正文索引…', 'Loading the full-text index…');
      try {
        pendingIndex ??= fetchSearchIndex();
        searchIndex = await pendingIndex;
      } catch {
        pendingIndex = undefined;
        indexUnavailable = true;
      }
    }

    if (version !== updateVersion) return;

    let visible = 0;
    for (const { element, href, summary } of cards) {
      const matches = (searchIndex?.[href] ?? summary).includes(query);
      if (element.hidden === matches) element.hidden = !matches;
      if (matches) visible += 1;
    }

    const count = query
      ? localize(`找到 ${visible} 篇与“${query}”相关的导读`, `${visible} results for “${query}”`)
      : localize(`已收录 ${visible} 篇导读`, `${visible} guides published`);

    result.textContent = indexUnavailable
      ? `${count} · ${localize('正文索引暂时不可用，当前仅匹配标题和摘要', 'Index unavailable. Searching titles and summaries.')}`
      : count;
  };

  search.addEventListener('input', update);
  void update();
}
