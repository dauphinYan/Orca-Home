/** 目录树的展开/收起交互：仅分支按钮与文档面板标题栏可以切换状态。 */
export function initKnowledgeTree() {
  const setBranchExpanded = (item: HTMLElement, expanded: boolean) => {
    item.classList.toggle('is-collapsed', !expanded);
    const branch = item.querySelector<HTMLButtonElement>(':scope > .knowledge-row > .knowledge-branch');
    if (branch) {
      branch.setAttribute('aria-expanded', String(expanded));
      branch.textContent = expanded ? '−' : '+';
    }
  };

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>('.knowledge-branch');
    if (trigger) {
      const item = trigger.closest<HTMLElement>('li.is-folder');
      if (!item) return;
      item.dataset.motionBranch = '';
      setBranchExpanded(item, item.classList.contains('is-collapsed'));
    }
  });
}
