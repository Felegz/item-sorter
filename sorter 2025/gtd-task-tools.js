/* GTD output dates share the capture operation; processing is not task creation. */
(function (root) {
  function prepareOutput(line, original, today) {
    const merged = original ? root.TaskFormat.mergeOriginalTask(line, original) : line;
    const task = root.TaskFormat.parseTaskLine(merged);
    if (original) {
      const previous = root.TaskFormat.parseTaskLine(original);
      task.creationDate = previous.creationDate || null;
      // GTD heart colours are projects, not a request to reassign A/B priorities.
      task.priority = previous.priority || task.priority;
    }
    return root.TaskListOperations.prepareNewTask(root.TaskFormat.serializeTaskLine(task), { today });
  }
  function withDueDate(line, dueDate) {
    if (dueDate && !validDate(dueDate)) throw new TypeError('Выберите корректную дату');
    const task = root.TaskFormat.parseTaskLine(line);
    task.dueDate = dueDate || null;
    task.tagList = (task.tagList || []).filter(tag => tag.key !== 'due');
    return root.TaskFormat.serializeTaskLine(task);
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function googleCalendarUrl(line) {
    const task = root.TaskFormat.parseTaskLine(line);
    if (!validDate(task.dueDate)) throw new TypeError('Сначала выберите дату');
    // Date-only tasks become all-day events. The end date is exclusive.
    const end = new Date(task.dueDate + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    const compact = value => value.replaceAll('-', '');
    const url = new URL('https://calendar.google.com/calendar/r/eventedit');
    url.search = new URLSearchParams({ action: 'TEMPLATE', text: task.text, details: task.text,
      dates: `${compact(task.dueDate)}/${compact(end.toISOString().slice(0, 10))}` }).toString();
    // Repeat the visible task text in the description; do not include source history/advice.
    return url.href;
  }
  const HEARTS = Object.freeze({ red: '🩷', green: '💚' });

  function taskColor(line) {
    const projects = root.TaskFormat.parseTaskLine(line).projects;
    if (projects.includes(HEARTS.red)) return 'red';
    if (projects.includes(HEARTS.green)) return 'green';
    return null;
  }

  // Apply after merging the original: otherwise its previous heart comes back.
  // A skipped colour question preserves existing projects, including heart tags.
  function withColor(line, color) {
    if (!color) return line;
    if (!Object.hasOwn(HEARTS, color)) throw new TypeError('Неизвестный цвет задачи');
    const task = root.TaskFormat.parseTaskLine(line);
    task.projects = task.projects.filter(project => !Object.values(HEARTS).includes(project));
    task.projects.push(HEARTS[color]);
    return root.TaskFormat.serializeTaskLine(task);
  }

  // No inference from due dates, contexts or priorities. gtd records a saved
  // review, not completion; old tasks without it remain manually reviewable.
  function isProcessed(line) {
    return root.TaskFormat.parseTaskLine(line).tagList.some(tag => tag.key === 'gtd' && validDate(tag.value));
  }

  function nextUnprocessedTask(document, currentIndex = -1) {
    const markers = typeof MARKERS !== 'undefined' ? MARKERS : root.MARKERS;
    const lines = String(document || '').split(/\r?\n/);
    const candidates = [];
    let ignored = false;
    lines.forEach((line, index) => {
      const raw = line.trim();
      if (!raw) return;
      const section = markers.getListName(raw);
      if (section) { ignored = section === 'ignored'; return; }
      if (ignored || index === currentIndex) return;
      const task = root.TaskFormat.parseTaskLine(raw);
      // Preserve the existing exclusion of someday tasks; do not choose markers,
      // completed x/X tasks, or an occurrence saved by a previous GTD session.
      if (task.completed || !task.text || task.projects.includes('someday-maybe') || isProcessed(raw)) return;
      candidates.push({ line, index });
    });
    // Continue below the current task, then wrap to the top of the whole list.
    return candidates.find(candidate => candidate.index > currentIndex) || candidates[0] || null;
  }

  function findTaskIndex(document, original, occurrence = null) {
    const lines = String(document || '').split(/\r?\n/);
    const matches = [];
    lines.forEach((line, index) => { if (line.trim() === original.trim()) matches.push(index); });
    if (occurrence !== null && Number.isSafeInteger(occurrence) && occurrence >= 0) {
      if (matches[occurrence] !== undefined) return matches[occurrence];
    } else if (matches.length === 1) return matches[0];
    if (!matches.length) throw new Error('Исходная задача больше не найдена. Вернитесь к списку и откройте её заново.');
    throw new Error('В списке есть одинаковые задачи. Откройте нужную через меню на странице задач.');
  }

  // Pure preparation, no storage: validate first, preserve every other occurrence
  // and section, stamp gtd only for the line actually about to be saved.
  function saveOutputInDocument(document, original, output, today, options = {}) {
    if (!validDate(today)) throw new TypeError('Некорректная дата разбора');
    if (!output.trim() || output.startsWith('# УДАЛЕНО')) throw new Error('Этот результат нельзя сохранить как задачу.');
    if (/[\r\n]/.test(output)) throw new Error('Сохраните одну задачу в одной строке. Переносы внутри задачи пока не поддерживаются.');
    const markers = typeof MARKERS !== 'undefined' ? MARKERS : root.MARKERS;
    const lines = String(document || '').split(/\r?\n/);
    if (lines.filter(line => markers.isIgnored(line)).length > 1) {
      throw new Error('Несколько ignored-блоков пока не поддерживаются. Список не изменён.');
    }
    const index = original ? findTaskIndex(document, original, options.occurrence ?? null) : 0;
    // The displayed output already contains the original due date. Removing it
    // is intentional; merging the original must not resurrect the old deadline.
    const outputDue = root.TaskFormat.parseTaskLine(output).dueDate || '';
    const prepared = withDueDate(prepareOutput(output, original, today), outputDue);
    const task = root.TaskFormat.parseTaskLine(withColor(prepared, options.color));
    task.tagList = task.tagList.filter(tag => tag.key !== 'gtd');
    task.tagList.push({ key: 'gtd', value: today });
    const line = root.TaskFormat.serializeTaskLine(task);
    if (original) lines[index] = line;
    else lines.unshift(line);
    const format = typeof formatTaskList !== 'undefined' ? formatTaskList : root.formatTaskList;
    const formatted = format(lines);
    const formattedLines = formatted.split(/\r?\n/);
    // Canonical blank lines can shift the index; identify the same occurrence
    // by its ordinal among the unchanged nonempty rows, never a Set of strings.
    const rowOrdinal = lines.slice(0, index + 1).filter(row => row.trim()).length - 1;
    let ordinal = -1;
    const savedIndex = formattedLines.findIndex(row => row.trim() && ++ordinal === rowOrdinal);
    const occurrence = formattedLines.slice(0, savedIndex).filter(row => row.trim() === line.trim()).length;
    return { document: formatted, line, index: savedIndex, occurrence };
  }

  root.TaskGtd = { prepareOutput, withDueDate, validDate, googleCalendarUrl,
    withColor, taskColor, isProcessed, nextUnprocessedTask, findTaskIndex, saveOutputInDocument };
})(globalThis);
