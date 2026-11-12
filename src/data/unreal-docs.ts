import { articleUrlSlug, type KnowledgeTreeNode } from './knowledge-section';
import { buildKnowledgeTree as buildCppTree, knowledgeUrl as cppKnowledgeUrl } from './unreal-cpp';
import { buildKnowledgeTree as buildGameplayTree, knowledgeUrl as gameplayKnowledgeUrl } from './unreal-gameplay';

export const unrealDocsHubPath = '/article/unreal-engine';
export const unrealDocsSectionTitle = '虚幻引擎官方文档 · 中文专区';

/**
 * 将各专题的目录保留为一级分支，并在节点上固化所属专题的链接。
 * 新增专题只需在这里加入一个目录构建器，无需修改树形组件。
 */
function withSectionUrls(nodes: KnowledgeTreeNode[], urlFor: (slug: string) => string): KnowledgeTreeNode[] {
  return nodes.map(node => ({
    ...node,
    href: node.published ? urlFor(node.slug) : undefined,
    children: withSectionUrls(node.children, urlFor),
  }));
}

export function buildUnrealDocsTree(cppEntries: Parameters<typeof buildCppTree>[0], gameplayEntries: Parameters<typeof buildGameplayTree>[0]) {
  return [
    ...withSectionUrls(buildCppTree(cppEntries), cppKnowledgeUrl),
    ...withSectionUrls(buildGameplayTree(gameplayEntries), gameplayKnowledgeUrl),
  ];
}

export function buildUnrealDocsArticles(cppEntries: Parameters<typeof buildCppTree>[0], gameplayEntries: Parameters<typeof buildGameplayTree>[0]) {
  return [
    ...cppEntries.filter(({ data }) => !data.draft).map(article => ({
      ...article, href: cppKnowledgeUrl(articleUrlSlug(article.id)), section: 'C++ 编程',
    })),
    ...gameplayEntries.filter(({ data }) => !data.draft).map(article => ({
      ...article, href: gameplayKnowledgeUrl(articleUrlSlug(article.id)), section: '游戏性系统',
    })),
  ];
}
