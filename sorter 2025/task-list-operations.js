// task-list-operations.js — reusable mutations for the canonical todo.txt document.
(function initTaskListOperations(root, factory) {
  const api = factory(
    typeof MARKERS !== 'undefined' ? MARKERS : root && root.MARKERS,
    typeof TaskFormat !== 'undefined' ? TaskFormat : root && root.TaskFormat,
    typeof formatTaskList !== 'undefined' ? formatTaskList : root && root.formatTaskList,
    typeof parseTaskDocument !== 'undefined' ? parseTaskDocument : root && root.parseTaskDocument,
    typeof serializeTaskDocument !== 'undefined' ? serializeTaskDocument : root && root.serializeTaskDocument,
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TaskListOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function taskListOperationsFactory(
  markers,
  taskFormat,
  formatList,
  parseDocument,
  serializeDocument,
) {
  'use strict';

  if (
    !markers ||
    !taskFormat ||
    typeof formatList !== 'function' ||
    typeof parseDocument !== 'function' ||
    typeof serializeDocument !== 'function'
  ) {
    throw new Error('TaskListOperations requires markers.js and task-format.js');
  }

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const isCompleted = line => /^x\s+/i.test(String(line || '').trim());
  const activeTasks = lines => lines.filter(line => !isCompleted(line));
  const completedTasks = lines => lines.filter(isCompleted);

  function mutableDocument(documentInput) {
    const parsed = parseDocument(documentInput);
    return {
      inboxUnsorted: [...parsed.inboxUnsorted],
      inboxSorted: [...parsed.inboxSorted],
      sorted: [...parsed.sorted],
      partiallySorted: [...parsed.partiallySorted],
      ignored: [...parsed.ignored],
      markers: { ...parsed.markers },
    };
  }

  function dateMarker(markersApi, listName, isoDate) {
    const [year, month, day] = markerDateParts(isoDate);
    if (listName === 'sorted') return markersApi.makeSorted(year, month, day);
    if (listName === 'partiallySorted') return markersApi.makePartial(year, month, day);
    if (listName === 'ignored') return markersApi.makeIgnored(year, month, day);
    if (listName === 'inboxSorted') return markersApi.makeInboxSorted();
    return null;
  }

  async function checkedCompare(compare, left, right, progress) {
    const relation = Number(await compare(left, right, progress));
    if (!Number.isFinite(relation) || relation === 0) {
      throw new TypeError('compare must return a non-zero number');
    }
    return relation;
  }

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
   * Assign one creation date to every task that does not have one yet.
   * Existing dates and section markers stay byte-for-byte unchanged; changed
   * tasks are serialized through the shared todo.txt formatter.
   */
  function assignMissingCreationDates(documentInput, creationDate) {
    if (!ISO_DATE_RE.test(String(creationDate || ''))) {
      throw new TypeError('creationDate must use YYYY-MM-DD');
    }

    let changedCount = 0;
    const lines = documentEntries(documentInput).map(line => {
      if (markers.isAnyMarker(line)) return line;
      const task = taskFormat.parseTaskLine(line);
      if (task.creationDate) return line;
      task.creationDate = creationDate;
      changedCount += 1;
      return taskFormat.serializeTaskLine(task);
    });

    return Object.freeze({
      changedCount,
      lines: Object.freeze(lines),
      text: formatList(lines),
    });
  }

  /**
   * Binary-insertion formula for a list ordered from most important to least.
   * compare(candidate, existing) must resolve to a negative number when the
   * candidate belongs above the existing task, otherwise to a positive number.
   */
  async function findRankedInsertionIndex(orderedTasks, candidate, compare, progress = null) {
    if (!Array.isArray(orderedTasks)) throw new TypeError('orderedTasks must be an array');
    if (typeof compare !== 'function') throw new TypeError('compare must be a function');
    let low = 0;
    let high = orderedTasks.length;
    let comparisons = 0;
    const maxComparisons = orderedTasks.length ? Math.ceil(Math.log2(orderedTasks.length + 1)) : 0;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const comparisonContext = Object.assign(progress || {}, {
        low,
        high,
        middle,
        comparison: comparisons + 1,
        maxComparisons,
      });
      const relation = await checkedCompare(compare, candidate, orderedTasks[middle], comparisonContext);
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
    const parsed = parseDocument(documentInput);
    const sourceEntry = parsed.entries[sourceIndex];
    if (!Number.isInteger(sourceIndex) || !sourceEntry) {
      throw new RangeError('sourceIndex is outside the document');
    }
    if (sourceEntry.kind !== 'task') throw new TypeError('A section marker cannot be ranked');
    if (isCompleted(sourceEntry.line)) throw new TypeError('A completed task cannot be ranked');

    const model = mutableDocument(documentInput);
    const candidate = model[sourceEntry.listName].splice(sourceEntry.listIndex, 1)[0];
    const rankedPeers = activeTasks(model.sorted);
    const placement = await findRankedInsertionIndex(rankedPeers, candidate, compare);
    rankedPeers.splice(placement.index, 0, candidate);
    model.sorted = [...rankedPeers, ...completedTasks(model.sorted)];
    const markerCreated = !model.markers.sorted;
    const today = localIsoDate(options.today || options.now);
    model.markers.sorted = model.markers.sorted || dateMarker(markers, 'sorted', today);
    const text = serializeDocument(model, { today });

    return Object.freeze({
      task: candidate,
      markerCreated,
      sortedPosition: placement.index,
      comparisons: placement.comparisons,
      lines: Object.freeze(documentEntries(text)),
      text,
    });
  }

  return Object.freeze({
    localIsoDate,
    prepareNewTask,
    insertTaskIntoInbox,
    assignMissingCreationDates,
    findRankedInsertionIndex,
    insertTaskByRank,
    rankTaskAtIndex,
  });
});
