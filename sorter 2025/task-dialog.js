/* Shared presentation only. Algorithms own the questions, order of comparisons,
 * decisions and writes. This component must never interpret or save a vote. */
(function (root) {
  'use strict';
  function options() {
    // Return fresh objects because SweetAlert may normalize its options.
    return { buttonsStyling: false, customClass: {
      popup: 'task-dialog', confirmButton: 'task-dialog__action',
      denyButton: 'task-dialog__action', cancelButton: 'task-dialog__action',
    } };
  }

  function renderTask(task, { choiceId, label = 'Выбрать' } = {}) {
    const format = root.TaskFormat;
    const descriptionId = choiceId ? format.escapeHtml(choiceId + '-description') : '';
    return `<article class="task-dialog__task"><div class="task-dialog__task-body"${descriptionId ? ` id="${descriptionId}"` : ''}>
      ${format.renderTaskHtml(task, { variant: 'choice', leadingMeta: ['contexts', 'projects', 'hashtags'] })}
      ${format.renderTaskBreakdownHtml(task)}</div>
      ${choiceId ? `<button type="button" id="${format.escapeHtml(choiceId)}" aria-describedby="${descriptionId}" class="task-dialog__choice">${format.escapeHtml(label)}</button>` : ''}
    </article>`;
  }

  function progress({ value, max, label, detail = '' }) {
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(safeMax, value)) : 0;
    const esc = root.TaskFormat.escapeHtml;
    return `<div class="task-dialog__progress"><p class="task-dialog__note">${esc(label)}</p>
      <progress max="${safeMax}" value="${safeValue}" aria-label="${esc(label)}"></progress>
      ${detail ? `<p class="task-dialog__note">${esc(detail)}</p>` : ''}</div>`;
  }

  root.TaskDialog = Object.freeze({ options, renderTask, progress });
})(globalThis);
