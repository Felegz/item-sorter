/* Separate entry point: the four historical sorting commands stay untouched.
 * Only an explicit Apply after the report writes, through the shared snapshot
 * and save path. Answered-pair history lives only in this page. */
(function (root) {
  'use strict';
  const button = document.getElementById('check-order-button');
  const editor = document.getElementById('task-list');
  const questionInput = document.getElementById('user-question');
  if (!button || !editor) return;
  const question = () => questionInput?.value.trim() || 'Какую задачу важнее сделать раньше?';
  let busy = false, previousDocument = null, previousQuestion = null;
  const seen = new Set();
  // CSS owns the appearance of every audit dialog. JS only supplies semantic
  // classes; no separate background, size or colour settings for each window.
  const dialogStyle = root.TaskDialog.options();
  // One task template is used by both the comparison and its findings report.
  // Keep text selectable and links usable, with a separate selection button.
  function renderTaskCard(task, side = null) {
    return root.TaskDialog.renderTask(task.line, { choiceId: side ? 'audit-' + side : null });
  }

  function ask(pair, step, total, criterion) {
    // Random presentation prevents always choosing the first card from silently
    // confirming the existing order. Relations retain their original positions.
    const sides = Math.random() < 0.5 ? ['left', 'right'] : ['right', 'left'];
    return new Promise((resolve, reject) => {
      let settled = false;
      const choose = value => {
        if (settled) return;
        settled = true;
        resolve(value);
        root.Swal.close();
      };
      const pending = root.Swal.fire({
        ...dialogStyle,
        titleText: criterion,
        html: `<p class="task-dialog__note">Пара ${step} из ${total}</p>
          <div class="task-dialog__choices">${sides.map(side => renderTaskCard(pair[side], side)).join('')}</div>`,
        showCancelButton: true,
        confirmButtonText: 'Примерно равны / не уверен',
        cancelButtonText: 'Завершить проверку',
        allowOutsideClick: false,
        focusConfirm: false,
        didOpen: () => {
          for (const side of sides) document.getElementById('audit-' + side)?.addEventListener('click', () => choose(side));
        },
      });
      Promise.resolve(pending).then(result => {
        if (!settled) { settled = true; resolve(result.isConfirmed ? 'uncertain' : null); }
      }, reject);
    });
  }

  function report(result, proposal, proposalError) {
    const count = result.answers.length;
    const definite = count - result.uncertain;
    const summary = !definite ? 'Нет определённых ответов для оценки порядка.'
      : result.conflicts.length ? `Найдены нарушения порядка: ${result.conflicts.length}.`
      : 'В проверенных парах нарушений не найдено.';
    const warning = result.stale
      ? 'Список или вопрос сравнения изменился. Отчёт относится к прежней версии; запустите новую проверку.'
      : result.stopped ? 'Проверка завершена досрочно.' : '';
    const applyNote = proposalError
      ? `<p class="task-dialog__note">${root.TaskFormat.escapeHtml(proposalError.message)}</p>`
      : proposal?.changed
        ? `<p class="task-dialog__note">Задач, которые сменят место: ${proposal.moves}. Оставшиеся пары не проверялись.</p>
          <details class="task-dialog__preview"><summary>Показать предлагаемый порядок</summary>
            <div class="task-dialog__preview-list">${proposal.ordered.map(line => renderTaskCard({ line })).join('')}</div>
          </details>`
        : '<p class="task-dialog__note">По этим ответам перестановка не нужна.</p>';
    return `<p class="task-dialog__summary">${summary}</p><p>Проверено пар: ${count}. Неопределённых ответов: ${result.uncertain}.</p>
      ${warning ? `<p>${warning}</p>` : ''}
      <p class="task-dialog__note">Это выборка, а не оценка всего списка в процентах.</p>
      ${result.conflicts.length ? `<details open><summary>Спорные пары</summary>
        ${result.conflicts.map(({ pair }) => `<section class="task-dialog__pair">
          <p class="task-dialog__note">По твоему ответу эта задача важнее:</p>
          ${renderTaskCard(pair.right)}
          <p class="task-dialog__note">Но в проверяемом списке стоит ниже этой:</p>
          ${renderTaskCard(pair.left)}
        </section>`).join('')}</details>` : ''}
      ${result.stale ? '' : applyNote}`;
  }

  async function start() {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const documentText = editor.value;
      const criterion = question();
      if (previousDocument !== documentText || previousQuestion !== criterion) {
        seen.clear();
        previousDocument = documentText;
        previousQuestion = criterion;
      }
      const sample = root.TaskOrderAudit.plan(documentText, { exclude: seen });
      if (sample.total < 2 || !sample.pairs.length) {
        await root.Swal.fire({ ...dialogStyle, title: 'Проверить порядок',
          text: sample.total < 2 ? 'В основном SORTED нужны хотя бы две невыполненные задачи.'
            : 'В этой сессии не нашлось новых пар для выборки. Обновите страницу, чтобы начать заново.',
          confirmButtonText: 'Закрыть' });
        return;
      }
      const result = await root.TaskOrderAudit.run(sample,
        (pair, step, total) => ask(pair, step, total, criterion),
        () => editor.value === documentText && question() === criterion);
      if (!result.stale) for (const answer of result.answers) seen.add(root.TaskOrderAudit.pairKey(answer.pair));
      let proposal = null, proposalError = null;
      if (!result.stale) {
        try { proposal = root.TaskOrderAudit.proposeReorder(documentText, result.answers); }
        catch (error) { proposalError = error; }
      }
      const canApply = Boolean(proposal?.changed);
      const decision = await root.Swal.fire({
        ...dialogStyle, title: 'Результат проверки', html: report(result, proposal, proposalError),
        customClass: { ...dialogStyle.customClass,
          confirmButton: canApply ? 'task-dialog__action task-dialog__action--primary' : 'task-dialog__action' },
        showConfirmButton: true,
        showCancelButton: canApply,
        confirmButtonText: canApply ? 'Применить порядок' : 'Закрыть',
        cancelButtonText: 'Оставить как есть',
        allowOutsideClick: !canApply,
      });
      if (canApply && decision.isConfirmed) {
        // Sync or another editor can replace the text while the report is open.
        // Recheck immediately before the existing snapshot-backed write.
        if (editor.value !== documentText || question() !== criterion) {
          await root.Swal.fire({ ...dialogStyle, title: 'Список изменился',
            text: 'Запустите проверку заново. Перестановка не выполнена.', confirmButtonText: 'Закрыть' });
          return;
        }
        const currentProposal = root.TaskOrderAudit.proposeReorder(editor.value, result.answers);
        if (!root.applyTaskListMutation(currentProposal, 'перед перестановкой SORTED после проверки порядка')) {
          throw new Error('Не удалось сохранить предложенный порядок.');
        }
        seen.clear();
        previousDocument = null;
        previousQuestion = null;
        await root.Swal.fire({ ...dialogStyle, title: 'Порядок сохранён',
          text: `Задач, которые сменили место: ${currentProposal.moves}. Задачи других разделов не переставлялись.`,
          confirmButtonText: 'Закрыть' });
      }
    } catch (error) {
      await root.Swal.fire({ ...dialogStyle, title: 'Проверка не выполнена',
        text: error.message || 'Не удалось проверить или сохранить порядок. Проверьте список и историю.', confirmButtonText: 'Закрыть' });
    } finally {
      busy = false;
      button.disabled = false;
    }
  }
  button.addEventListener('click', start);
})(globalThis);
