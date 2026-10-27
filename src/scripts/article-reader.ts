import { localize } from '../i18n/client';

let outlineObserver: IntersectionObserver | undefined;

/** Shared reader enhancements for long-form articles. */
export function initArticleReader() {
  initArticleSidebarToggles();
  initArticleFooterClearance();

  // Keep IDs unique when both language versions contain the same technical heading.
  document.querySelectorAll<HTMLElement>('.article-body[data-language-content="en"]').forEach(body => {
    const ids = new Map<string, string>();

    body.querySelectorAll<HTMLElement>('[id]').forEach(element => {
      const original = element.id;

      element.id = `en-${original}`;
      ids.set(original, element.id);
    });

    body.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
      const id = decodeURIComponent(link.hash.slice(1));

      if (ids.has(id)) link.hash = ids.get(id)!;
    });
  });

  const backToTop = document.querySelector('[data-back-to-top]');
  if (backToTop instanceof HTMLButtonElement) {
    const update = () => { backToTop.hidden = window.scrollY < window.innerHeight; };
    update();
    window.addEventListener('scroll', update, { passive: true });
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }

  document.querySelectorAll<HTMLElement>('.article-body pre.astro-code').forEach((block, index) => {
    if (block.parentElement?.classList.contains('code-block-shell')) return;
    block.id ||= `code-block-${index + 1}`;
    const shell = document.createElement('div');
    shell.className = 'code-block-shell';
    block.before(shell);
    shell.append(block);
    const language = document.createElement('span');
    language.className = 'code-block-language';
    language.textContent = block.dataset.language && block.dataset.language !== 'plaintext'
      ? block.dataset.language
      : 'txt';
    shell.append(language);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-block-toggle';
    button.setAttribute('aria-controls', block.id);
    button.setAttribute('aria-expanded', 'true');
    button.textContent = localize('收起', 'Collapse');
    button.addEventListener('click', () => {
      const collapsed = block.classList.toggle('is-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.textContent = collapsed ? localize('展开', 'Expand') : localize('收起', 'Collapse');
    });
    shell.append(button);
  });

  initArticleOutline();
  initArticleSidebarLayout();

  window.addEventListener('site:language-change', () => {
    document.querySelectorAll<HTMLButtonElement>('.code-block-toggle').forEach(button => {
      const collapsed = button.getAttribute('aria-expanded') === 'false';

      button.textContent = collapsed ? localize('展开', 'Expand') : localize('收起', 'Collapse');
    });

    document.querySelectorAll<HTMLElement>('[data-article-sidebar-toggle]').forEach(toggle => {
      const label = toggle.dataset.articleSidebarToggle === 'knowledge'
        ? localize('目录', 'Contents') : localize('大纲', 'Outline');

      toggle.innerHTML = `<span aria-hidden="true">☰</span>${label}`;
    });

    initArticleOutline();
  });
}

/** Switch floating sidebars to drawers when the article leaves too little room. */
function initArticleSidebarLayout() {
  const article = document.querySelector<HTMLElement>('.blog-page');

  const sidebars = [...document.querySelectorAll<HTMLElement>('.article-sidebar--floating')];

  if (!article || sidebars.length === 0) return;

  const update = () => {
    const articleBounds = article.getBoundingClientRect();

    const narrowViewport = window.matchMedia('(max-width: 1500px)').matches;

    // Measure the normal sidebar position, even while its drawer is open.
    sidebars.forEach(sidebar => sidebar.classList.remove('is-compact'));

    const layouts = sidebars.map(sidebar => {
      const bounds = sidebar.getBoundingClientRect();

      const isRight = sidebar.classList.contains('article-sidebar--right');

      const gap = isRight ? bounds.left - articleBounds.right : articleBounds.left - bounds.right;

      return { sidebar, compact: narrowViewport || gap < 24 };
    });

    layouts.forEach(({ sidebar, compact }) => {
      sidebar.classList.toggle('is-compact', compact);

      const toggle = document.querySelector<HTMLButtonElement>(`[data-article-sidebar-toggle="${sidebar.dataset.articleSidebar}"]`);

      if (toggle) {
        toggle.hidden = sidebar.hidden;
        toggle.classList.toggle('is-compact-toggle', compact && !sidebar.hidden);
      }

      if (!compact || sidebar.hidden) {
        sidebar.classList.remove('is-mobile-open');
        toggle?.setAttribute('aria-expanded', 'false');
      }
    });

    document.querySelector('[data-article-mobile-actions]')?.classList.toggle(
      'has-compact-sidebar', layouts.some(({ sidebar, compact }) => compact && !sidebar.hidden),
    );
  };

  update();
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  window.addEventListener('site:language-change', update);

  const observer = new ResizeObserver(update);

  observer.observe(article);
}

function initArticleOutline() {
  outlineObserver?.disconnect();

  const toc = document.querySelector<HTMLElement>('[data-article-sidebar="outline"]');
  const tocList = toc?.querySelector<HTMLElement>('[data-article-toc-list]');
  const headings = [...document.querySelectorAll<HTMLElement>('.article-body:not([hidden]) :is(h2, h3, h4)')];

  tocList?.replaceChildren();

  if (toc) toc.hidden = headings.length === 0;

  if (!toc || !tocList || headings.length === 0) return;

  type TocNode = { level: number; heading: HTMLElement; children: TocNode[] };
  const usedIds = new Set<string>();
  const root: { level: number; children: TocNode[] } = { level: 1, children: [] };
  const stack: Array<{ level: number; children: TocNode[] }> = [root];
  headings.forEach((heading, index) => {
    if (!heading.id) {
      const base = heading.textContent?.trim().toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-') || `section-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (usedIds.has(id) || document.getElementById(id)) id = `${base}-${suffix++}`;
      heading.id = id;
    }
    usedIds.add(heading.id);
    const level = Number(heading.tagName.slice(1));
    while (stack.at(-1)!.level >= level) stack.pop();
    const node: TocNode = { level, heading, children: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });

  const setBranchExpanded = (item: HTMLLIElement, expanded: boolean) => {
    const button = item.querySelector<HTMLButtonElement>(':scope > .article-toc-branch');
    if (!button) return;
    item.classList.toggle('is-collapsed', !expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? '−' : '+';
  };
  const renderNodes = (nodes: TocNode[]) => {
    const list = document.createElement('ul');
    nodes.forEach(node => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${node.heading.id}`;
      link.textContent = node.heading.textContent;
      link.dataset.tocTarget = node.heading.id;
      item.append(link);
      if (node.children.length > 0) {
        const branch = document.createElement('button');
        branch.type = 'button';
        branch.className = 'article-toc-branch';
        branch.setAttribute('aria-label', localize(`展开或收起${node.heading.textContent}`, `Expand or collapse ${node.heading.textContent}`));
        branch.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const expanded = item.classList.contains('is-collapsed');
          branch.dataset.manualState = expanded ? 'expanded' : 'collapsed';
          setBranchExpanded(item, expanded);
        });
        item.prepend(branch);
        item.append(renderNodes(node.children));
        setBranchExpanded(item, false);
      }
      list.append(item);
    });
    return list;
  };
  tocList.append(renderNodes(root.children));
  toc.hidden = false;
  initArticleSidebarToggle(toc);

  const links = [...toc.querySelectorAll<HTMLAnchorElement>('[data-toc-target]')];
  const branchItems = [...toc.querySelectorAll<HTMLLIElement>('li:has(> .article-toc-branch)')];
  const revealActivePath = (heading: Element) => {
    const activeLink = links.find(link => link.dataset.tocTarget === heading.id);
    const activePath = new Set<HTMLLIElement>();
    let item = activeLink?.closest('li');
    while (item instanceof HTMLLIElement) {
      if (item.querySelector(':scope > .article-toc-branch')) activePath.add(item);
      item = item.parentElement?.closest('li');
    }
    branchItems.forEach(branch => {
      const button = branch.querySelector<HTMLButtonElement>(':scope > .article-toc-branch');
      if (!button) return;
      if (activePath.has(branch)) setBranchExpanded(branch, true);
      else if (button.dataset.manualState !== 'expanded') setBranchExpanded(branch, false);
    });
  };
  const observer = new IntersectionObserver(entries => {
    const active = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!active) return;
    links.forEach(link => link.classList.toggle('is-active', link.dataset.tocTarget === active.target.id));
    revealActivePath(active.target);
  }, { rootMargin: '-15% 0px -70%' });
  headings.forEach(heading => observer.observe(heading));
  outlineObserver = observer;
}

/** Keeps bottom floating controls above the footer's top border. */
function initArticleFooterClearance() {
  const footer = document.querySelector<HTMLElement>('.blog-footer');

  if (!footer) return;

  const update = () => {
    const viewport = window.visualViewport;

    const viewportHeight = viewport?.height ?? window.innerHeight;

    const viewportBottom = (viewport?.offsetTop ?? 0) + viewportHeight;

    const footerBounds = footer.getBoundingClientRect();

    const actions = document.querySelector<HTMLElement>('[data-article-mobile-actions]');

    const actionsHeight = actions?.getBoundingClientRect().height ?? 0;

    // Limit footer avoidance to its height and keep the controls inside the visible viewport.
    const maxLift = Math.max(0, viewportHeight - actionsHeight - 36);

    const footerLift = Math.min(Math.max(0, viewportBottom - footerBounds.top), footerBounds.height, maxLift);

    const clearance = Math.max(0, window.innerHeight - viewportBottom) + footerLift;

    document.body.style.setProperty('--article-footer-clearance', `${clearance}px`);
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update);

  const observer = new ResizeObserver(update);

  observer.observe(document.body);
  observer.observe(footer);
}

/** Adds the shared mobile drawer behavior to every article navigation sidebar. */
function initArticleSidebarToggles() {
  document.querySelectorAll<HTMLElement>('[data-article-sidebar]').forEach(sidebar => {
    if (sidebar.dataset.mobileHref) {
      addArticleMobileLink(sidebar);
      return;
    }
    if (!sidebar.hidden) initArticleSidebarToggle(sidebar);
  });
}

function getArticleMobileActions() {
  let actions = document.querySelector<HTMLElement>('[data-article-mobile-actions]');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'article-mobile-actions';
    actions.dataset.articleMobileActions = '';
    document.body.append(actions);
  }
  return actions;
}

function addArticleMobileLink(sidebar: HTMLElement) {
  const kind = sidebar.dataset.articleSidebar;
  const href = sidebar.dataset.mobileHref;
  if (!kind || !href || document.querySelector(`[data-article-sidebar-link="${kind}"]`)) return;
  const link = document.createElement('a');
  link.className = 'article-sidebar-toggle';
  link.href = href;
  link.dataset.articleSidebarLink = kind;
  link.innerHTML = `<span aria-hidden="true">☰</span>${localize('目录', 'Contents')}`;
  getArticleMobileActions().append(link);
}

function initArticleSidebarToggle(sidebar: HTMLElement) {
    const kind = sidebar.dataset.articleSidebar;
    if (!kind) return;
    const actions = getArticleMobileActions();
    let toggle = actions.querySelector<HTMLButtonElement>(`[data-article-sidebar-toggle="${kind}"]`);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'article-sidebar-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', sidebar.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.dataset.articleSidebarToggle = kind;
      const label = kind === 'knowledge' ? localize('目录', 'Contents') : localize('大纲', 'Outline');

      toggle.innerHTML = `<span aria-hidden="true">☰</span>${label}`;
      actions.append(toggle);
    }
    if (toggle.dataset.initialized) return;
    toggle.dataset.initialized = 'true';

    const close = () => {
      sidebar.classList.remove('is-mobile-open');
      toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
      document.querySelectorAll<HTMLElement>('[data-article-sidebar].is-mobile-open').forEach(otherSidebar => {
        if (otherSidebar === sidebar) return;
        otherSidebar.classList.remove('is-mobile-open');
        const otherKind = otherSidebar.dataset.articleSidebar;
        actions.querySelector<HTMLButtonElement>(`[data-article-sidebar-toggle="${otherKind}"]`)?.setAttribute('aria-expanded', 'false');
      });
      const isOpen = sidebar.classList.toggle('is-mobile-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    sidebar.addEventListener('click', event => {
      if (event.target instanceof HTMLAnchorElement) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && sidebar.classList.contains('is-mobile-open')) {
        close();
        toggle.focus();
      }
    });
    document.addEventListener('click', event => {
      if (!sidebar.classList.contains('is-mobile-open')) return;
      const target = event.target;
      if (target instanceof Node && !sidebar.contains(target) && !actions.contains(target)) close();
    });
}
