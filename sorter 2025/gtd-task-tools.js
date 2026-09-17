/* GTD output dates share the capture operation; processing is not task creation. */
(function (root) {
  function prepareOutput(line, original, today) {
    const merged = original ? root.TaskFormat.mergeOriginalTask(line, original) : line;
    const task = root.TaskFormat.parseTaskLine(merged);
    if (original) task.creationDate = root.TaskFormat.parseTaskLine(original).creationDate || null;
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
    url.search = new URLSearchParams({ action: 'TEMPLATE', text: task.text,
      dates: `${compact(task.dueDate)}/${compact(end.toISOString().slice(0, 10))}` }).toString();
    // Only the title and date go to Google; source history/advice remain private locally.
    return url.href;
  }
  root.TaskGtd = { prepareOutput, withDueDate, validDate, googleCalendarUrl };
})(globalThis);
