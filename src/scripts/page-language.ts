export function initPageLanguage() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageLanguage, { once: true });
    return;
  }

  const button = document.querySelector<HTMLButtonElement>('[data-language-switch]');

  if (!button) return;

  const translations: Record<string, string> = JSON.parse(button.dataset.translations!);

  // Capture original values once so repeated switches always restore Chinese exactly.
  const texts: { node: Text; zh: string; en: string }[] = [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;

    if (node.parentElement?.closest('script, style, pre, code, [data-language-switch], [data-language-content], [data-i18n-en]')) continue;

    const original = node.data;

    const translation = translations[original.trim()];

    if (translation) texts.push({ node, zh: original, en: original.replace(original.trim(), translation) });
  }

  const attributes: { element: Element; name: string; zh: string; en: string }[] = [];

  document.querySelectorAll('[aria-label], [alt], [placeholder], meta[name="description"]').forEach(element => {
    if (element.closest('[data-language-content]')) return;

    for (const name of ['aria-label', 'alt', 'content', 'placeholder']) {
      const original = element.getAttribute(name);

      if (original && translations[original]) {
        attributes.push({ element, name, zh: original, en: translations[original] });
      }
    }
  });

  const chineseTitle = document.title;

  const explicitTexts = [...document.querySelectorAll<HTMLElement>('[data-i18n-en]')].map(element => ({
    element, zh: element.textContent ?? '', en: element.dataset.i18nEn!,
  }));

  const dates = [...document.querySelectorAll('time[datetime]')].map(element => ({
    element, zh: element.textContent, date: new Date(element.getAttribute('datetime')!),
  }));

  let language = 'zh-CN';

  function applyLanguage(next: string) {
    language = next;

    const english = language === 'en';

    document.documentElement.lang = language;
    document.title = english ? (translations[chineseTitle] ?? chineseTitle) : chineseTitle;

    texts.forEach(({ node, zh, en }) => { node.data = english ? en : zh; });
    attributes.forEach(({ element, name, zh, en }) => element.setAttribute(name, english ? en : zh));
    explicitTexts.forEach(({ element, zh, en }) => { element.textContent = english ? en : zh; });

    dates.forEach(({ element, zh, date }) => {
      element.textContent = english ? date.toLocaleDateString(language, { year: 'numeric', month: '2-digit', day: '2-digit' }) : zh;
    });

    document.querySelectorAll<HTMLElement>('[data-language-content]').forEach(element => {
      element.hidden = element.dataset.languageContent !== language;
    });

    button.lang = english ? 'zh-CN' : 'en';
    button.setAttribute('aria-label', english ? '切换为中文' : 'Switch to English');
    button.title = english ? '切换为中文' : 'Switch to English';

    window.dispatchEvent(new CustomEvent('site:language-change', { detail: { language } }));
  }

  try {
    if ((localStorage.getItem('orca-language') ?? localStorage.getItem('orca-home-language')) === 'en') applyLanguage('en');
  } catch { /* Language switching also works when browser storage is unavailable. */ }

  button.hidden = false;
  button.addEventListener('click', () => {
    applyLanguage(language === 'en' ? 'zh-CN' : 'en');

    try { localStorage.setItem('orca-language', language); } catch { /* Keep the current selection in memory. */ }
  });
}
