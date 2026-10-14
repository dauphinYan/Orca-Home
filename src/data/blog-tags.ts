const tagLabels = new Map([
  ['source-reading', '源码解读'],
]);

export const blogTagLabel = (tag: string) => tagLabels.get(tag.trim()) ?? tag;
