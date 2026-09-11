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
  let pointerActionInsideShell = false;

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
    // On touch browsers focusout can run between pointerdown and click. Keep the
    // compact editor stable until its Save/Cancel action has actually fired;
    // otherwise the button moves and the first tap is lost.
    if (pointerActionInsideShell) return;
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

  document.addEventListener('pointerdown', event => {
    pointerActionInsideShell = Boolean(
      activeShell?.isConnected && activeShell.contains(event.target),
    );
  }, true);

  document.addEventListener('pointerup', () => {
    // click is dispatched before this task; delaying the layout release keeps
    // the original tap target in place through the complete activation.
    setTimeout(() => {
      pointerActionInsideShell = false;
      deactivateIfFocusLeftEditors();
    }, 0);
  }, true);

  document.addEventListener('pointercancel', () => {
    pointerActionInsideShell = false;
    queueMicrotask(deactivateIfFocusLeftEditors);
  }, true);

  // Inline action handlers may replace the whole editor shell after a tap.
  document.addEventListener('click', () => {
    pointerActionInsideShell = false;
    queueMicrotask(deactivateIfFocusLeftEditors);
  });

  window.visualViewport?.addEventListener('resize', syncVisibleHeight, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncVisibleHeight, { passive: true });
})();
