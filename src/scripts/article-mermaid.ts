import type { Mermaid } from 'mermaid';
import { enableMediaPreview } from './media-viewer';
import { localize } from '../i18n/client';

/** Loads Mermaid only when the article contains diagram fences. */
export async function initArticleMermaid() {
  const blocks = [...document.querySelectorAll<HTMLElement>('.article-body pre > code.language-mermaid')];

  if (blocks.length === 0) return;

  let mermaid: Mermaid;

  try {
    mermaid = (await import('mermaid')).default;
  } catch (error) {
    console.error('Mermaid 加载失败，保留图表源码。', error);
    return;
  }

  await document.fonts.ready;

  const diagrams = blocks.map((code, index) => {
    const source = code.parentElement!;

    const figure = document.createElement('figure');
    figure.className = 'mermaid-diagram';
    const label = localize(`Mermaid 图表 ${index + 1}`, `Mermaid diagram ${index + 1}`, code);

    figure.setAttribute('aria-label', label);

    const canvas = document.createElement('div');
    canvas.className = 'mermaid-diagram-canvas';

    const message = document.createElement('p');
    message.className = 'mermaid-diagram-error';
    message.textContent = localize('图表渲染失败，请检查 Mermaid 语法。', 'Diagram rendering failed. Please check the Mermaid syntax.', code);
    message.setAttribute('role', 'status');
    message.hidden = true;

    source.before(figure);
    figure.append(canvas, message, source);

    return { definition: code.textContent ?? '', source, canvas, message, label };
  });

  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');

  let renderVersion = 0;

  const renderDiagrams = async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: colorScheme.matches ? 'dark' : 'default',
      fontFamily: "'Noto Sans SC', Arial, sans-serif",
    });

    renderVersion += 1;

    for (const [index, diagram] of diagrams.entries()) {
      try {
        const { svg, bindFunctions } = await mermaid.render(`article-mermaid-${renderVersion}-${index}`, diagram.definition);
        diagram.canvas.innerHTML = svg;
        bindFunctions?.(diagram.canvas);
        enableMediaPreview(diagram.canvas, diagram.label);
        diagram.source.hidden = true;
        diagram.message.hidden = true;
      } catch (error) {
        diagram.canvas.replaceChildren();
        diagram.source.hidden = false;
        diagram.message.hidden = false;
        console.error(`Mermaid 图表 ${index + 1} 渲染失败。`, error);
      }
    }
  };

  // Serialize theme changes so initialization cannot interrupt an active render.
  let pendingRender = renderDiagrams();

  colorScheme.addEventListener('change', () => {
    pendingRender = pendingRender.then(renderDiagrams);
  });

  await pendingRender;
}
