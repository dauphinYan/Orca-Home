import { localize } from '../i18n/client';

function readSearchText(element: HTMLElement) {
  return `${element.dataset.search ?? ''} ${element.textContent}`.toLocaleLowerCase();
}

export function initSourceReading() {
  const root = document.querySelector('[data-source-reading]');

  if (!root) return;

  const search = root.querySelector<HTMLInputElement>('[data-source-search]')!;

  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-source-topic]')];

  const cards = [...root.querySelectorAll<HTMLElement>('[data-source-card]')].map(element => ({
    element,
    searchText: readSearchText(element),
    topics: JSON.parse(element.dataset.topics ?? '[]') as string[],
  }));

  const results = root.querySelector<HTMLElement>('[data-source-results]')!;

  const empty = root.querySelector<HTMLElement>('[data-source-empty]')!;

  let selectedTopic = '';

  function update() {
    const query = search.value.trim().toLocaleLowerCase();

    let visible = 0;

    cards.forEach(card => {
      const matches = card.searchText.includes(query) && (!selectedTopic || card.topics.includes(selectedTopic));

      if (card.element.hidden === matches) card.element.hidden = !matches;
      if (matches) visible += 1;
    });

    buttons.forEach(button => {
      const pressed = String(button.dataset.sourceTopic === selectedTopic);

      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    });

    const summary = query || selectedTopic
      ? localize(`找到 ${visible} 篇解读（共 ${cards.length} 篇）`, `${visible} of ${cards.length} articles found`)
      : localize(`已收录 ${cards.length} 篇解读`, `${cards.length} articles published`);

    if (results.textContent !== summary) results.textContent = summary;

    const hasResults = visible > 0;

    if (empty.hidden !== hasResults) empty.hidden = hasResults;
  }

  search.addEventListener('input', update);

  window.addEventListener('site:language-change', () => {
    cards.forEach(card => { card.searchText = readSearchText(card.element); });
    update();
  });

  update();

  buttons.forEach(button => button.addEventListener('click', () => {
    selectedTopic = button.dataset.sourceTopic ?? '';
    update();
  }));

  root.querySelector('[data-source-reset]')?.addEventListener('click', () => {
    search.value = '';
    selectedTopic = '';
    update();
    search.focus();
  });
}
