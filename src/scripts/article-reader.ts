/** Shared reader enhancements for long-form articles outside the legacy blog route. */
export function initArticleReader() {
  initArticleSidebarToggles();
  initArticleFooterClearance();

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
    button.textContent = '收起';
    button.addEventListener('click', () => {
      const collapsed = block.classList.toggle('is-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.textContent = collapsed ? '展开' : '收起';
    });
    shell.append(button);
  });

  const toc = document.querySelector<HTMLElement>('[data-article-sidebar="outline"]');
  const tocList = toc?.querySelector<HTMLElement>('[data-article-toc-list]');
  const headings = [...document.querySelectorAll<HTMLElement>('.article-body h2, .article-body h3, .article-body h4')];
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
        branch.setAttribute('aria-label', `展开或收起${node.heading.textContent}`);
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
  link.innerHTML = '<span aria-hidden="true">☰</span>目录';
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
      toggle.innerHTML = `<span aria-hidden="true">☰</span>${kind === 'knowledge' ? '目录' : '大纲'}`;
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
