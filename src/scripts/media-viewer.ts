import { localize } from '../i18n/client';

/** Mark media as an accessible viewer trigger, including asynchronously rendered diagrams. */
export function enableMediaPreview(element: HTMLElement, label: string) {
  element.dataset.mediaPreview = '';
  element.setAttribute('aria-label', localize(`放大查看：${label}`, `Enlarge: ${label}`, element));
  element.setAttribute('aria-haspopup', 'dialog');

  if (element instanceof HTMLButtonElement) return;

  element.tabIndex = 0;
  element.setAttribute('role', 'button');
}

export function initMediaViewer() {
  const dialog = document.querySelector<HTMLDialogElement>('[data-media-viewer]');

  if (!dialog || dialog.dataset.initialized) return;

  dialog.dataset.initialized = 'true';

  const stage = dialog.querySelector<HTMLElement>('[data-viewer-stage]')!;

  const content = dialog.querySelector<HTMLElement>('[data-viewer-content]')!;

  const title = dialog.querySelector<HTMLElement>('[data-viewer-title]')!;

  const output = dialog.querySelector<HTMLOutputElement>('[data-viewer-scale]')!;

  let scale = 1;

  let offset = { x: 0, y: 0 };

  let drag: { id: number; x: number; y: number } | undefined;

  let trigger: HTMLElement | undefined;

  let previousOverflow = '';

  const update = () => {
    content.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
    output.value = `${Math.round(scale * 100)}%`;
  };

  const reset = () => {
    scale = 1;
    offset = { x: 0, y: 0 };
    update();
  };

  const zoom = (factor: number, x = 0, y = 0) => {
    const next = Math.min(8, Math.max(0.25, scale * factor));

    const ratio = next / scale;

    offset = { x: x - (x - offset.x) * ratio, y: y - (y - offset.y) * ratio };
    scale = next;
    update();
  };

  const open = (element: HTMLElement) => {
    const media = element.matches('img') ? element : element.querySelector('svg, img');

    if (!media) return;

    const clone = media.cloneNode(true) as HTMLElement | SVGSVGElement;

    clone.removeAttribute('style');
    clone.removeAttribute('tabindex');
    clone.removeAttribute('role');
    clone.removeAttribute('data-media-preview');
    clone.removeAttribute('aria-haspopup');

    if (clone instanceof HTMLImageElement && media instanceof HTMLImageElement) {
      clone.removeAttribute('srcset');
      clone.removeAttribute('sizes');
      clone.src = media.currentSrc || media.src;
      clone.loading = 'eager';
    }

    // SVG IDs and references must stay together and distinct from the inline diagram.
    if (clone instanceof SVGSVGElement) {
      const ids = [clone, ...clone.querySelectorAll('[id]')].map(node => node.id).filter(Boolean).sort((a, b) => b.length - a.length);

      const references = new RegExp(`#(${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'g');

      for (const node of [clone, ...clone.querySelectorAll('*')]) {
        for (const attribute of [...node.attributes]) {
          const value = attribute.name === 'id'
            ? `viewer-${attribute.value}`
            : attribute.value.replace(references, '#viewer-$1');

          node.setAttribute(attribute.name, value);
        }
      }

      clone.querySelectorAll('style').forEach(style => {
        style.textContent = style.textContent!.replace(references, '#viewer-$1');
      });
    }

    trigger = element;
    title.textContent = media.getAttribute('alt') || element.getAttribute('aria-label') || localize('放大查看', 'Enlarge');
    content.replaceChildren(clone);
    reset();
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
  };

  document.querySelectorAll<HTMLElement>('.article-body img, .screenshot-button').forEach(element => {
    if (element.closest('.mermaid-diagram-canvas')) return;
    enableMediaPreview(element, element.getAttribute('alt') || element.querySelector('img')?.alt || localize('图片', 'Image', element));
  });

  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-media-preview]') : null;

    if (!element || dialog.open) return;
    event.preventDefault();
    open(element);
  });

  document.addEventListener('keydown', event => {
    const element = event.target instanceof HTMLElement ? event.target : null;

    if (!dialog.open && element?.hasAttribute('data-media-preview') && !(element instanceof HTMLButtonElement) && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open(element);
    }

    if (!dialog.open || !['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === '0') reset();
    else zoom(event.key === '-' ? 1 / 1.25 : 1.25);
  });

  dialog.querySelectorAll<HTMLButtonElement>('[data-viewer-action]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.viewerAction;

      if (action === 'close') dialog.close();
      else if (action === 'fit') reset();
      else zoom(action === 'in' ? 1.25 : 1 / 1.25);
    });
  });

  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();

    zoom(Math.exp(-event.deltaY * 0.002), event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
  }, { passive: false });

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });

  stage.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    offset.x += event.clientX - drag.x;
    offset.y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    update();
  });

  stage.addEventListener('lostpointercapture', () => {
    drag = undefined;
    stage.classList.remove('is-dragging');
  });

  stage.addEventListener('dblclick', reset);
  window.addEventListener('resize', reset);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = previousOverflow;
    content.replaceChildren();
    trigger?.focus({ preventScroll: true });
  });
}
