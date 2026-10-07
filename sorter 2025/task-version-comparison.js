/* Version comparison and explicit merge decisions. Text equality is not task
 * identity: never infer a rename/deletion from an unmatched line. No I/O here. */
(function (root) {
  function entries(text) {
    return parseTaskDocument(text).entries.filter(entry => entry.kind === 'task');
  }

  function buckets(rows, key) {
    const result = new Map();
    rows.forEach((row, index) => {
      const value = key(row);
      if (!result.has(value)) result.set(value, []);
      result.get(value).push(index);
    });
    return result;
  }

  function compare(local, cloud, baseline = null, archive = null) {
    const left = entries(local), right = entries(cloud);
    const unmatched = new Map(right.map((row, index) => [index, row]));
    const byText = buckets(right, row => row.line);
    const pairs = [], onlyLocal = [];
    left.forEach((row, index) => {
      const candidates = (byText.get(row.line) || []).filter(i => unmatched.has(i));
      // Prefer the same section for duplicate text, then consume one occurrence.
      const sameSection = candidates.find(i => right[i].listName === row.listName);
      const other = sameSection ?? candidates[0];
      if (other === undefined) onlyLocal.push({ ...row, index });
      else {
        unmatched.delete(other);
        pairs.push({ local: row, cloud: right[other], left: index, right: other });
      }
    });
    const onlyCloud = [...unmatched].map(([index, row]) => ({ ...row, index }));
    const common = buckets(pairs, pair => pair.local.line);
    const old = baseline === null ? null : buckets(entries(baseline), row => row.line);
    const archived = archive === null ? null : buckets(entries(archive), row => archiveKey(row.line));
    // Archive is a bounded-count hint, not evidence that this exact task was archived.
    for (const rows of [onlyLocal, onlyCloud]) {
      const seen = new Map(), archiveSeen = new Map();
      rows.forEach(row => {
        const occurrence = (seen.get(row.line) || 0) + 1;
        seen.set(row.line, occurrence);
        const commonCount = common.get(row.line)?.length || 0;
        row.inBaseline = old === null ? null : (old.get(row.line)?.length || 0) >= commonCount + occurrence;
        const key = archiveKey(row.line);
        const archiveOccurrence = (archiveSeen.get(key) || 0) + 1;
        archiveSeen.set(key, archiveOccurrence);
        row.archiveMatch = archived !== null && (archived.get(key)?.length || 0) >= archiveOccurrence;
      });
    }
    const moved = pairs.filter(pair => pair.local.listName !== pair.cloud.listName);
    // Compare relative order of shared occurrences, not absolute indices shifted by additions.
    const reordered = pairs.some((pair, index) => index && pair.right < pairs[index - 1].right);
    const markers = text => parseTaskDocument(text).entries.filter(row => row.kind === 'marker').map(row => row.line);
    return { onlyLocal, onlyCloud, moved, reordered, shared: pairs.length,
      markersChanged: JSON.stringify(markers(local)) !== JSON.stringify(markers(cloud)),
      identical: local === cloud, baselineAvailable: baseline !== null, archiveAvailable: archive !== null,
      local, cloud, baseline, archive, pairs };
  }

  // Remove only the completion prefix/date for a possible archive match.
  // Preserve priority, creation date, due date, tags, and every other character.
  function archiveKey(line) { return line.replace(/^[xX]\s+(?:\d{4}-\d{2}-\d{2}\s+)?/, ''); }

  const labels = { inboxUnsorted: 'INBOX UNSORTED', inboxSorted: 'INBOX SORTED',
    sorted: 'SORTED', partiallySorted: 'PARTIALLY SORTED', ignored: 'IGNORED TASKS' };
  const recordForms = { one: 'запись', few: 'записи', many: 'записей', other: 'записи' };
  const recordCount = n => `${n} ${recordForms[new Intl.PluralRules('ru').select(n)]}`;
  function render(result) {
    const esc = TaskFormat.escapeHtml;
    const row = item => `<li><span class="conflict-section">${labels[item.listName]}</span>
      <div class="conflict-task">${esc(item.line)}</div>
      ${item.inBaseline === null ? '' : `<small>${item.inBaseline ? 'Было при последней синхронизации' : 'Не было при последней синхронизации'}</small>`}
      ${item.archiveMatch ? '<small>Есть совпадение в архиве. Это может быть другая задача с таким же текстом.</small>' : ''}</li>`;
    const group = (title, rows, consequence) => `<details class="conflict-group">
      <summary>${title}: ${rows.length}</summary><p>${consequence}</p>
      ${rows.length ? `<ul>${rows.map(row).join('')}</ul>` : '<p>Нет таких задач.</p>'}</details>`;
    const moves = result.moved.map(pair => `<li><div class="conflict-task">${esc(pair.local.line)}</div>
      <small>На устройстве: ${labels[pair.local.listName]}. В облаке: ${labels[pair.cloud.listName]}.</small></li>`).join('');
    return `<div class="conflict-diff">
      <div class="conflict-verdict"><p><strong>Выбрать облако:</strong> ${result.onlyLocal.length ? `вне списка: ${recordCount(result.onlyLocal.length)} с устройства.` : 'все тексты задач с устройства есть в облаке.'}</p>
      <p><strong>Выбрать устройство:</strong> ${result.onlyCloud.length ? `вне списка: ${recordCount(result.onlyCloud.length)} из облака.` : 'все тексты облачных задач есть на устройстве.'}</p></div>
      <p>Объединение сохранит обе стороны. Разные тексты одной задачи могут остаться двумя записями: лишний вариант можно не включать.</p>
      ${group('Только на устройстве', result.onlyLocal, 'Если выбрать облако, этих строк не будет в рабочем списке.')}
      ${group('Только в облаке', result.onlyCloud, 'Если выбрать устройство, этих строк не будет в рабочем списке.')}
      ${moves ? `<details class="conflict-group"><summary>Разные секции: ${result.moved.length}</summary><ul>${moves}</ul></details>` : ''}
      ${result.reordered ? '<p>Порядок общих задач различается. Сохранится порядок выбранной версии.</p>' : ''}
      ${result.markersChanged ? '<p>Заголовки секций или их даты различаются. Проверьте полные версии ниже.</p>' : ''}
      ${!result.identical && !result.onlyLocal.length && !result.onlyCloud.length && !result.moved.length && !result.reordered && !result.markersChanged ? '<p>Строки задач совпадают. Различаются пробелы или пустые строки.</p>' : ''}
      ${result.identical ? '<p>Содержимое версий совпадает.</p>' : ''}
      <details class="conflict-group"><summary>Как сравниваются записи</summary><p class="conflict-help">Изменённый текст показан отдельными строками в обеих версиях. Без постоянного номера задачи нельзя надёжно отличить правку от удаления и добавления. Совпадение текста не доказывает, что это одна задача.</p>
      ${!result.baselineAvailable ? '<p>Нет сохранённой версии последней синхронизации. Показаны только различия между текущими списками.</p>' : ''}
      </details><p class="conflict-help">${result.archiveAvailable ? 'Архив проверен. ' + (result.onlyLocal.concat(result.onlyCloud).some(row => row.archiveMatch)
        ? 'Есть совпадения в архиве. При объединении вы решаете, возвращать ли эти записи.' : 'Среди различающихся записей совпадений с архивом нет.')
        : 'Архив недоступен. Задачи не будут исключены автоматически.'}</p>
      <details class="conflict-group"><summary>Полные версии</summary>
        <h3>На устройстве</h3><pre>${esc(result.local)}</pre><h3>В облаке</h3><pre>${esc(result.cloud)}</pre></details>
      <p class="conflict-help">Перед записью обе версии сохранятся в истории этого браузера.</p>
    </div>`;
  }

  // Pair only occurrences already present in the last synced version. Equal
  // new lines may be independent additions on two devices: keep both unless
  // the user explicitly excludes a copy. No Set/deduplication of task strings.
  function createMergePlan(diff) {
    const documents = [diff.local, diff.cloud].map(parseTaskDocument);
    if (documents.some(doc => doc.entries.filter(row => row.kind === 'marker' && row.listName === 'ignored').length > 1)) {
      throw new Error('В одной версии несколько ignored-блоков. Объединение остановлено: блоки нельзя склеивать.');
    }
    const old = buckets(entries(diff.baseline || ''), row => row.line);
    const used = new Map(), uncertain = [];
    for (const pair of diff.pairs) {
      const n = (used.get(pair.local.line) || 0) + 1;
      used.set(pair.local.line, n);
      if (n > (old.get(pair.local.line)?.length || 0)) uncertain.push(pair);
    }
    const cloudRows = [...diff.onlyCloud,
      ...uncertain.map(pair => ({ ...pair.cloud, index: pair.right, uncertain: true }))]
      .sort((a, b) => a.index - b.index);
    const localRows = entries(diff.local).map((row, index) => ({ ...row, index }));
    const reviewIndices = new Set([...diff.onlyLocal.map(row => row.index), ...uncertain.map(pair => pair.left)]);
    // Shared completed/archive matches are also available for an explicit
    // archive decision. Unchanged ordinary shared tasks need no review.
    const archived = buckets(entries(diff.archive || ''), row => archiveKey(row.line));
    const make = (row, side) => ({ ...row, side, id: `${side}:${row.index}`,
      archiveMatch: archived.has(archiveKey(row.line)) });
    const rows = [...localRows.map(row => make(row, 'local')), ...cloudRows.map(row => make(row, 'cloud'))];
    const review = rows.filter(row => row.side === 'cloud' || reviewIndices.has(row.index)
      || /^[xX]\s/.test(row.line) || row.archiveMatch);
    return { diff, documents, rows, review, uncertain: uncertain.length };
  }

  // Decisions refer to occurrence IDs, not task text. Removing one duplicate
  // must never remove its neighbours. The local marker/order layout is retained.
  function finalizeMerge(plan, decisions = {}) {
    const allowed = ['keep', 'skip', 'archive', 'archived'];
    const reviewIds = new Set(plan.review.map(row => row.id));
    for (const [id, action] of Object.entries(decisions)) {
      if (!reviewIds.has(id) || !allowed.includes(action)) throw new Error('Неизвестное решение по задаче.');
    }
    const archiveLines = [], archivedLines = [], excludedLines = [];
    const keep = row => {
      const action = decisions[row.id] || 'keep';
      if (action === 'archive') archiveLines.push(row.line);
      if (action === 'archived') archivedLines.push(row.line);
      if (action === 'skip') excludedLines.push(row.line);
      return action === 'keep';
    };
    const local = plan.rows.filter(row => row.side === 'local' && keep(row));
    const cloud = plan.rows.filter(row => row.side === 'cloud' && keep(row));
    const localIds = new Set(local.map(row => row.index));
    const output = [];
    let index = 0;
    for (const row of plan.documents[0].entries) {
      if (row.kind === 'marker' || localIds.has(index)) output.push(row.line);
      if (row.kind === 'task') index++;
    }
    const extraIgnored = cloud.filter(row => row.listName === 'ignored').map(row => row.line);
    if (extraIgnored.length) {
      const at = output.findIndex(line => MARKERS.isIgnored(line));
      if (at >= 0) output.splice(at + 1, 0, ...extraIgnored);
      else output.push(plan.documents[1].markers.ignored, ...extraIgnored);
    }
    const extra = cloud.filter(row => row.listName !== 'ignored').map(row => row.line);
    if (extra.length) {
      // An explicit SORTED boundary prevents the legacy no-SORTED layout from
      // treating prepended cloud additions as part of the sorted prefix.
      // 0000.00.00 is the serializer's existing sentinel for an unknown date;
      // do not invent a real sorting date for the user's old undated block.
      if (plan.documents[0].legacyMergeLayout) {
        output.unshift(MARKERS.makeSorted('0000', '00', '00'));
      }
      output.unshift(...extra);
    }
    const result = { text: formatTaskList(output), archiveLines, archivedLines, excludedLines,
      added: cloud.length, excluded: excludedLines.length, archived: archiveLines.length + archivedLines.length,
      kept: local.length + cloud.length };
    validateArchivedSelections(result, plan.diff.archive);
    return result;
  }

  // Re-run against a fresh archive immediately before saving. One archived
  // occurrence cannot justify excluding two selected live occurrences.
  function validateArchivedSelections(result, archive) {
    if (!result.archivedLines.length) return;
    if (archive === null) throw new Error('Архив недоступен. Оставьте задачи в списке.');
    const available = buckets(entries(archive), row => archiveKey(row.line));
    for (const line of result.archivedLines) {
      const bucket = available.get(archiveKey(line));
      if (!bucket?.length) throw new Error('В архиве недостаточно совпадающих записей. Оставьте задачу или отправьте её в архив.');
      bucket.pop();
    }
  }

  function renderMerge(plan, decisions) {
    const esc = TaskFormat.escapeHtml;
    return `<div class="conflict-diff"><p>По умолчанию все спорные записи остаются в списке.</p>
      ${plan.uncertain ? `<p>Совпадающих новых записей: ${plan.uncertain}. Пока оставлены обе копии.</p>` : ''}
      <details class="conflict-group"><summary>Порядок и архив</summary><p>Порядок и секции устройства сохранятся. Дополнительные облачные задачи пойдут наверх инбокса; ignored останется в ignored.</p>
      <p class="conflict-help">«Не включать» уберёт только выбранную запись из общего списка. Исходные версии останутся в истории браузера. «В архив» перенесёт запись без изменения её текста.</p></details>
      <ul class="merge-rows">${plan.review.map(row => `<li><label for="merge-${row.id}"><small>${row.side === 'local' ? 'Устройство' : 'Облако'} · ${labels[row.listName]}</small><span class="conflict-task">${esc(row.line)}</span></label>
        <select id="merge-${row.id}" data-merge-id="${row.id}">
        ${[['keep', 'Оставить в списке'], ['skip', 'Не включать'], ['archive', 'В архив'],
          ...(row.archiveMatch ? [['archived', 'Уже в архиве · не возвращать']] : [])]
          .map(([value, label]) => `<option value="${value}"${(decisions[row.id] || 'keep') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></li>`).join('')}</ul>
      ${!plan.review.length ? '<p>Спорных записей нет. Сохранится список устройства.</p>' : ''}</div>`;
  }

  // Shared flow for production and the no-I/O preview. This function returns
  // a proposal only; the Dropbox adapter owns backups, validation and writes.
  async function show(diff, versionsHtml = '') {
    const choice = await Swal.fire({ ...dialogOptions(), title: 'Сравнение версий',
      html: render(diff) + versionsHtml, showCancelButton: true, showDenyButton: true,
      focusCancel: true, confirmButtonText: 'Объединить задачи', denyButtonText: 'Выбрать одну версию', cancelButtonText: 'Отмена' });
    if (choice.isDenied) {
      const whole = await Swal.fire({ ...dialogOptions(), title: 'Выбрать одну версию',
        html: render(diff) + versionsHtml, showCancelButton: true, showDenyButton: true, focusCancel: true,
        confirmButtonText: 'Взять облачную', denyButtonText: 'Оставить местную', cancelButtonText: 'Отмена' });
      return whole.isConfirmed ? { kind: 'cloud' } : whole.isDenied ? { kind: 'local' } : null;
    }
    if (!choice.isConfirmed) return null;
    let plan;
    try { plan = createMergePlan(diff); }
    catch (error) { await Swal.fire('Объединение остановлено', error.message, 'warning'); return null; }
    let decisions = {};
    while (true) {
      const selected = await Swal.fire({ ...dialogOptions(), title: 'Что оставить',
        html: renderMerge(plan, decisions), showCancelButton: true, focusCancel: true,
        confirmButtonText: 'Посмотреть результат', cancelButtonText: 'Отмена',
        preConfirm() {
          const current = Object.fromEntries([...Swal.getHtmlContainer().querySelectorAll('[data-merge-id]')]
            .map(select => [select.dataset.mergeId, select.value]));
          try { return { decisions: current, result: finalizeMerge(plan, current) }; }
          catch (error) { Swal.showValidationMessage(error.message); return false; }
        } });
      if (!selected.isConfirmed) return null;
      decisions = selected.value.decisions;
      const result = selected.value.result;
      const esc = TaskFormat.escapeHtml;
      const final = await Swal.fire({ ...dialogOptions(), title: 'Сохранить общий список?',
        html: `<div class="conflict-diff"><p><strong>В общем списке: ${recordCount(result.kept)}.</strong></p>
          <p>Добавится из облака: ${result.added}. Не включено: ${result.excluded}. Выбрано в архив: ${result.archived}.</p>
          <p class="conflict-help">Список сохранится на устройстве и в Dropbox. Обе исходные версии и этот результат сохранятся в истории браузера.</p>
          ${result.archiveLines.length ? '<p class="conflict-help">Сначала запишется архив, затем список. При ошибке второго шага задачи останутся на устройстве, хотя архив уже может быть записан.</p>' : ''}
          <details class="conflict-group"><summary>Общий список</summary><pre>${esc(result.text)}</pre></details>
          ${result.excludedLines.length ? `<details class="conflict-group"><summary>Не включено: ${result.excludedLines.length}</summary><pre>${esc(formatTaskList(result.excludedLines))}</pre></details>` : ''}
          ${result.archivedLines.length ? `<details class="conflict-group"><summary>Уже в архиве: ${result.archivedLines.length}</summary><pre>${esc(formatTaskList(result.archivedLines))}</pre></details>` : ''}
          ${result.archiveLines.length ? `<details class="conflict-group"><summary>Отправить в архив: ${result.archiveLines.length}</summary><pre>${esc(formatTaskList(result.archiveLines))}</pre></details>` : ''}</div>`,
        showCancelButton: true, showDenyButton: true, focusCancel: true,
        confirmButtonText: 'Сохранить общий список', denyButtonText: 'Назад', cancelButtonText: 'Отмена' });
      if (final.isConfirmed) return { kind: 'merge', ...result };
      if (!final.isDenied) return null;
    }
  }
  // Event-driven visible-height sizing keeps actions reachable above a mobile
  // keyboard. This hook is shared by the real dialog and the synthetic preview.
  function dialogOptions() {
    let cleanup = () => {};
    return {
      width: 'min(48rem, calc(100% - 24px))',
      customClass: { popup: 'version-conflict-dialog' },
      didOpen() {
        const viewport = root.visualViewport;
        const popup = Swal.getPopup(), container = Swal.getContainer();
        const sync = () => {
          const height = viewport?.height || root.innerHeight;
          popup.style.setProperty('--conflict-height', `${height}px`);
          container.style.height = `${height}px`;
          container.style.top = `${viewport?.offsetTop || 0}px`;
          container.style.bottom = 'auto';
        };
        sync();
        viewport?.addEventListener('resize', sync);
        viewport?.addEventListener('scroll', sync);
        root.addEventListener('resize', sync);
        cleanup = () => {
          viewport?.removeEventListener('resize', sync);
          viewport?.removeEventListener('scroll', sync);
          root.removeEventListener('resize', sync);
        };
      },
      willClose() { cleanup(); },
    };
  }
  root.TaskVersionComparison = Object.freeze({ compare, render, dialogOptions,
    createMergePlan, finalizeMerge, validateArchivedSelections, show });
})(globalThis);
