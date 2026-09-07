(function initMobileEditMode() {
  'use strict';

  /*
   * Reusable contract:
   * - data-mobile-editor opts a field into keyboard-aware focus mode;
   * - data-mobile-editor-shell marks the smallest layout that must stay visible;
   * - data-mobile-editor-layout selects page-specific CSS without new JS branches.
   */
  const EDITOR_SELECTOR = '[data-mobile-editor]';
  const ACTIVE_CLASS = 'mobile-editor-active';
  let activeShell = null;

  /**
   * Android and iOS expose the space above the keyboard through visualViewport.
   * CSS consumes this value instead of guessing keyboard height from device size.
   * The listener is event-driven: there is no polling on an already busy device.
   */
  function syncVisibleHeight() {
    if (!document.body?.classList.contains(ACTIVE_CLASS)) return;
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--mobile-editor-height', `${Math.round(height)}px`);
  }

  function activateEditor(editor) {
    document.body.classList.add(ACTIVE_CLASS);
    document.body.dataset.mobileEditorLayout = editor.dataset.mobileEditorLayout || 'default';
    editor.classList.add('mobile-editor-focus');
    activeShell = editor.closest('[data-mobile-editor-shell]') || editor;
    syncVisibleHeight();

    // The surrounding layout collapses after focus, so align the surviving editor again.
    requestAnimationFrame(() => {
      activeShell.scrollIntoView({ block: 'start', inline: 'nearest' });
    });
  }

  function deactivateIfFocusLeftEditors() {
    const focused = document.activeElement;
    if (activeShell?.isConnected && activeShell.contains(focused)) return;
    document.body?.classList.remove(ACTIVE_CLASS);
    delete document.body?.dataset.mobileEditorLayout;
    activeShell = null;
    document.querySelectorAll('.mobile-editor-focus').forEach(element => {
      element.classList.remove('mobile-editor-focus');
    });
    document.documentElement.style.removeProperty('--mobile-editor-height');
  }

  document.addEventListener('focusin', event => {
    const editor = event.target.closest?.(EDITOR_SELECTOR);
    if (editor) activateEditor(editor);
  });

  document.addEventListener('focusout', () => {
    // focusout fires before document.activeElement changes to the next control.
    queueMicrotask(deactivateIfFocusLeftEditors);
  });

  // Inline action handlers may replace the whole editor shell after a tap.
  document.addEventListener('click', () => queueMicrotask(deactivateIfFocusLeftEditors));

  window.visualViewport?.addEventListener('resize', syncVisibleHeight, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncVisibleHeight, { passive: true });
})();
