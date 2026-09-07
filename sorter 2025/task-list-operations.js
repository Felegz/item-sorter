// task-list-operations.js — reusable mutations for the canonical todo.txt document.
(function initTaskListOperations(root, factory) {
  const api = factory(
    typeof MARKERS !== 'undefined' ? MARKERS : root && root.MARKERS,
    typeof TaskFormat !== 'undefined' ? TaskFormat : root && root.TaskFormat,
    typeof formatTaskList !== 'undefined' ? formatTaskList : root && root.formatTaskList,
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TaskListOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function taskListOperationsFactory(markers, taskFormat, formatList) {
  'use strict';

  if (!markers || !taskFormat || typeof formatList !== 'function') {
    throw new Error('TaskListOperations requires markers.js and task-format.js');
  }

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function localIsoDate(value = new Date()) {
    if (typeof value === 'string' && ISO_DATE_RE.test(value)) return value;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('A valid local date is required');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function markerDateParts(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return [year, month, day];
  }

  function documentEntries(input) {
    const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
    return lines
      .map(line => String(line).trimEnd())
      .filter(line => line.trim());
  }

  /**
   * Canonical task capture formula.
   *
   * creationDate is inserted in todo.txt's leading date position when absent.
   * dueDate remains an independent `due:` tag and never replaces creationDate.
   */
  function prepareNewTask(rawTask, options = {}) {
    const raw = String(rawTask || '').trim();
    if (!raw) throw new TypeError('Task text is required');
    if (markers.isAnyMarker(raw)) throw new TypeError('A section marker is not a task');

    const task = taskFormat.parseTaskLine(raw);
    if (!task.creationDate) task.creationDate = localIsoDate(options.today || options.now);
    if (options.dueDate) {
      if (!ISO_DATE_RE.test(options.dueDate)) throw new TypeError('dueDate must use YYYY-MM-DD');
      task.dueDate = options.dueDate;
    }
    return taskFormat.serializeTaskLine(task);
  }

  /**
   * Put a captured task at the very top (inboxUnsorted). If the document has no
   * SORTED boundary yet, create it immediately after the new inbox task so the
   * previous document remains below the inbox.
   */
  function insertTaskIntoInbox(documentInput, rawTask, options = {}) {
    const today = localIsoDate(options.today || options.now);
    const task = prepareNewTask(rawTask, { ...options, today });
    const existing = documentEntries(documentInput);
    const markerCreated = !existing.some(line => markers.isSorted(line));
    const lines = [task];
    if (markerCreated) lines.push(markers.makeSorted(...markerDateParts(today)));
    lines.push(...existing);
    return Object.freeze({
      task,
      markerCreated,
      lines: Object.freeze(lines),
      text: formatList(lines),
    });
  }

  /**
   * Binary-insertion formula for a list ordered from most important to least.
   * compare(candidate, existing) must resolve to a negative number when the
   * candidate belongs above the existing task, otherwise to a positive number.
   */
  async function findRankedInsertionIndex(orderedTasks, candidate, compare) {
    if (!Array.isArray(orderedTasks)) throw new TypeError('orderedTasks must be an array');
    if (typeof compare !== 'function') throw new TypeError('compare must be a function');
    let low = 0;
    let high = orderedTasks.length;
    let comparisons = 0;
    const maxComparisons = orderedTasks.length ? Math.ceil(Math.log2(orderedTasks.length + 1)) : 0;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const relation = Number(await compare(candidate, orderedTasks[middle], {
        low,
        high,
        middle,
        comparison: comparisons + 1,
        maxComparisons,
      }));
      if (!Number.isFinite(relation) || relation === 0) {
        throw new TypeError('compare must return a non-zero number');
      }
      comparisons += 1;
      if (relation < 0) high = middle;
      else low = middle + 1;
    }

    return Object.freeze({ index: low, comparisons });
  }

  async function insertTaskByRank(orderedTasks, candidate, compare) {
    const source = [...orderedTasks];
    const placement = await findRankedInsertionIndex(source, candidate, compare);
    source.splice(placement.index, 0, candidate);
    return Object.freeze({
      ...placement,
      tasks: Object.freeze(source),
    });
  }

  /**
   * Remove one concrete document entry and insert it into the SORTED block.
   * The supplied sourceIndex identifies the occurrence, so duplicate task text
   * is safe. No document mutation is returned until all comparisons complete.
   */
  async function rankTaskAtIndex(documentInput, sourceIndex, compare, options = {}) {
    const lines = documentEntries(documentInput);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= lines.length) {
      throw new RangeError('sourceIndex is outside the document');
    }
    const candidate = lines[sourceIndex];
    if (markers.isAnyMarker(candidate)) throw new TypeError('A section marker cannot be ranked');

    lines.splice(sourceIndex, 1);
    let sortedMarkerIndex = lines.findIndex(line => markers.isSorted(line));
    let markerCreated = false;
    if (sortedMarkerIndex < 0) {
      const today = localIsoDate(options.today || options.now);
      lines.unshift(markers.makeSorted(...markerDateParts(today)));
      sortedMarkerIndex = 0;
      markerCreated = true;
    }

    let sortedEnd = lines.findIndex((line, index) => index > sortedMarkerIndex && markers.isAnyMarker(line));
    if (sortedEnd < 0) sortedEnd = lines.length;
    const rankedPeers = lines.slice(sortedMarkerIndex + 1, sortedEnd);
    const placement = await findRankedInsertionIndex(rankedPeers, candidate, compare);
    const documentIndex = sortedMarkerIndex + 1 + placement.index;
    lines.splice(documentIndex, 0, candidate);

    return Object.freeze({
      task: candidate,
      markerCreated,
      sortedPosition: placement.index,
      documentIndex,
      comparisons: placement.comparisons,
      lines: Object.freeze(lines),
      text: formatList(lines),
    });
  }

  return Object.freeze({
    localIsoDate,
    prepareNewTask,
    insertTaskIntoInbox,
    findRankedInsertionIndex,
    insertTaskByRank,
    rankTaskAtIndex,
  });
});
