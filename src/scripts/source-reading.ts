export function matchesSourceReading(searchText: string, topics: string[], query: string, selectedTopic: string) {
  return searchText.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (!selectedTopic || topics.includes(selectedTopic));
}

export function initSourceReading() {
  const root = document.querySelector('[data-source-reading]');

  if (!root) return;

  const search = root.querySelector<HTMLInputElement>('[data-source-search]')!;

  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-source-topic]')];

  const cards = [...root.querySelectorAll<HTMLElement>('[data-source-card]')].map(element => ({
    element,
    searchText: element.dataset.search ?? '',
    topics: JSON.parse(element.dataset.topics ?? '[]') as string[],
  }));

  const results = root.querySelector<HTMLElement>('[data-source-results]')!;

  const empty = root.querySelector<HTMLElement>('[data-source-empty]')!;

  let selectedTopic = '';

  function update() {
    let visible = 0;

    cards.forEach(card => {
      const matches = matchesSourceReading(card.searchText, card.topics, search.value, selectedTopic);

      card.element.hidden = !matches;

      if (matches) visible += 1;
    });

    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sourceTopic === selectedTopic)));

    results.textContent = search.value.trim() || selectedTopic ? `找到 ${visible} 篇解读（共 ${cards.length} 篇）` : `已收录 ${cards.length} 篇解读`;

    empty.hidden = visible > 0;
  }

  search.addEventListener('input', update);

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
