export function localize(zh: string, en: string, element?: Element) {
  const language = element?.closest('[data-language-content]')?.getAttribute('lang') ?? document.documentElement.lang;

  return language === 'en' ? en : zh;
}
