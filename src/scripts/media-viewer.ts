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

  const fullscreenButton = dialog.querySelector<HTMLButtonElement>('[data-viewer-action="fullscreen"]')!;

  const zoomOutButton = dialog.querySelector<HTMLButtonElement>('[data-viewer-action="zoom-out"]')!;

  const zoomInButton = dialog.querySelector<HTMLButtonElement>('[data-viewer-action="zoom-in"]')!;

  const scaleOutput = dialog.querySelector<HTMLOutputElement>('[data-viewer-scale]')!;

  let mediaSize = { width: 1, height: 1 };

  let scale = 1;

  let offset = { x: 0, y: 0 };

  const pointers = new Map<number, { x: number; y: number }>();

  let backgroundTap: { id: number; x: number; y: number } | undefined;

  let trigger: HTMLElement | undefined;

  let previousOverflow = '';

  const update = () => {
    content.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
    scaleOutput.value = `${Math.round(scale * 100)}%`;
    zoomOutButton.disabled = scale <= 0.25;
    zoomInButton.disabled = scale >= 8;
  };

  const reset = () => {
    const fit = Math.min(stage.clientWidth * 0.8 / mediaSize.width, stage.clientHeight * 0.8 / mediaSize.height);

    content.style.width = `${mediaSize.width * fit}px`;
    content.style.height = `${mediaSize.height * fit}px`;
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

    const diagram = element.closest<HTMLElement>('.mermaid-diagram');

    // Transparent images need an opaque surface; Mermaid keeps its rendered theme.
    content.style.backgroundColor = diagram ? getComputedStyle(diagram).backgroundColor : '';
    content.style.color = getComputedStyle(media).color;

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
      mediaSize = { width: media.naturalWidth || media.width || 1, height: media.naturalHeight || media.height || 1 };
      clone.addEventListener('load', () => {
        if (content.firstElementChild !== clone) return;
        mediaSize = { width: clone.naturalWidth, height: clone.naturalHeight };
        reset();
      }, { once: true });
    }

    // SVG IDs and references must stay together and distinct from the inline diagram.
    if (clone instanceof SVGSVGElement) {
      const viewBox = clone.viewBox.baseVal;

      const bounds = media.getBoundingClientRect();

      mediaSize = { width: viewBox.width || bounds.width || 1, height: viewBox.height || bounds.height || 1 };
      clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

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
    content.replaceChildren(clone);
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
    reset();
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

  dialog.querySelector<HTMLButtonElement>('[data-viewer-action="close"]')!.addEventListener('click', () => dialog.close());

  zoomOutButton.addEventListener('click', () => zoom(1 / 1.25));
  zoomInButton.addEventListener('click', () => zoom(1.25));

  fullscreenButton.hidden = !document.fullscreenEnabled;
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === dialog) await document.exitFullscreen();
      else await dialog.requestFullscreen();
    } catch {
      // Keep the viewport viewer available when the browser declines fullscreen.
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === dialog;

    const label = active ? localize('退出全屏', 'Exit fullscreen') : localize('全屏查看', 'View fullscreen');

    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.title = label;
    if (dialog.open) reset();
  });

  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();

    zoom(Math.exp(-event.deltaY * 0.002), event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
  }, { passive: false });

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    backgroundTap = pointers.size === 1 && event.target === stage
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : undefined;
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });

  stage.addEventListener('pointermove', event => {
    const previous = pointers.get(event.pointerId);

    if (!previous) return;
    event.preventDefault();

    if (backgroundTap && Math.hypot(event.clientX - backgroundTap.x, event.clientY - backgroundTap.y) > 5) {
      backgroundTap = undefined;
    }

    const pair = [...pointers.values()].slice(0, 2);

    const next = { x: event.clientX, y: event.clientY };

    pointers.set(event.pointerId, next);

    if (pair.length === 1) {
      offset.x += next.x - previous.x;
      offset.y += next.y - previous.y;
    } else if (pair.includes(previous)) {
      const nextPair = [...pointers.values()].slice(0, 2);

      const distance = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);

      const nextDistance = Math.hypot(nextPair[1].x - nextPair[0].x, nextPair[1].y - nextPair[0].y);

      const center = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };

      const nextCenter = { x: (nextPair[0].x + nextPair[1].x) / 2, y: (nextPair[0].y + nextPair[1].y) / 2 };

      const bounds = stage.getBoundingClientRect();

      if (distance > 0 && nextDistance > 0) {
        zoom(nextDistance / distance, center.x - bounds.left - bounds.width / 2, center.y - bounds.top - bounds.height / 2);
      }

      offset.x += nextCenter.x - center.x;
      offset.y += nextCenter.y - center.y;
    }

    update();
  });

  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    backgroundTap = undefined;
    stage.classList.toggle('is-dragging', pointers.size > 0);
  };

  stage.addEventListener('pointerup', event => {
    const closeOnTap = backgroundTap?.id === event.pointerId
      && Math.hypot(event.clientX - backgroundTap.x, event.clientY - backgroundTap.y) <= 5;

    endPointer(event);
    if (closeOnTap) dialog.close();
  });

  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('lostpointercapture', endPointer);

  stage.addEventListener('dblclick', reset);
  window.addEventListener('resize', reset);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    for (const id of pointers.keys()) {
      if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
    }

    pointers.clear();
    backgroundTap = undefined;
    stage.classList.remove('is-dragging');
    if (document.fullscreenElement === dialog) void document.exitFullscreen();
    document.documentElement.style.overflow = previousOverflow;
    content.replaceChildren();
    trigger?.focus({ preventScroll: true });
  });
}
