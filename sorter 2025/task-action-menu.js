/* Explicit task actions never intercept native text selection or contextmenu. */
(function (root) {
  function place(anchor, menu, viewport) {
    const gap = 8;
    const width = Math.min(menu.width, Math.max(0, viewport.width - 2 * gap));
    const height = Math.min(menu.height, Math.max(0, viewport.height - 2 * gap));
    const left = Math.max(viewport.left + gap, Math.min(anchor.right - width, viewport.left + viewport.width - width - gap));
    const below = anchor.bottom + gap;
    const top = Math.max(viewport.top + gap, Math.min(below + height <= viewport.top + viewport.height - gap ? below : anchor.top - height - gap, viewport.top + viewport.height - height - gap));
    return { left, top, width, height };
  }
  function install(list) {
    const close = () => list.querySelectorAll('.task-actions[open]').forEach(el => { el.open = false; });
    function position(details) {
      const menu = details.querySelector('.task-actions-menu');
      const vv = window.visualViewport;
      const viewport = { left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0, width: vv?.width || innerWidth, height: vv?.height || innerHeight };
      const p = place(details.querySelector('summary').getBoundingClientRect(), { width: 230, height: menu.scrollHeight }, viewport);
      Object.assign(menu.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', maxHeight: p.height + 'px' });
    }
    list.addEventListener('toggle', event => {
      const details = event.target;
      if (!details.matches('.task-actions') || !details.open) return;
      list.querySelectorAll('.task-actions[open]').forEach(other => { if (other !== details) other.open = false; });
      position(details);
    }, true);
    document.addEventListener('click', event => { if (!event.target.closest('.task-actions')) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    const reposition = () => list.querySelectorAll('.task-actions[open]').forEach(position);
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    document.addEventListener('scroll', event => { if (!event.target.closest?.('.task-actions-menu')) reposition(); }, true);
  }
  root.SorterTaskMenu = { place, install };
  if (typeof module !== 'undefined') module.exports = root.SorterTaskMenu;
})(globalThis);
