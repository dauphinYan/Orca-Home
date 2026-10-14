import { createMarkdownProcessor } from '@astrojs/markdown-remark';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

interface PreviewBlock {
  kind: 'heading' | 'paragraph';
  text: string;
}

function nodeText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';

  if (node.type === 'break') return ' ';

  return (node.children ?? []).map(nodeText).join('');
}

/** 提取正文开头的标题与段落，避免在卡片内加载图片、代码或嵌套链接。 */
export async function blogPreview(body: string) {
  const blocks: PreviewBlock[] = [];

  const processor = await createMarkdownProcessor({
    syntaxHighlight: false,
    smartypants: false,
    remarkPlugins: [() => (tree: MarkdownNode) => {
      let remaining = 420;

      for (const node of tree.children ?? []) {
        if (node.type !== 'paragraph' && node.type !== 'heading') continue;

        const text = nodeText(node).replace(/\s+/g, ' ').trim();

        if (!text) continue;

        const clipped = text.length > remaining;

        blocks.push({ kind: node.type, text: clipped ? `${text.slice(0, remaining)}…` : text });
        remaining -= text.length;

        if (remaining <= 0 || blocks.length >= 5) break;
      }
    }],
  });

  await processor.render(body);

  return blocks;
}
