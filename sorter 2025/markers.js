// markers.js — единый источник истины для маркеров секций todo.txt
//
// Единая модель списков:
//   inboxUnsorted  — новые задачи без внутреннего порядка
//   inboxSorted    — отдельная отсортированная партия INBOX SORTED;
//                    обычный Sort Tasks этот список не создаёт
//   sorted         — основной отсортированный список
//   partiallySorted — частично отсортированный остаток
//   ignored        — исключённые задачи

const TASK_LIST_NAMES = Object.freeze([
  'inboxUnsorted',
  'inboxSorted',
  'sorted',
  'partiallySorted',
  'ignored',
]);

function createTaskLists() {
  return Object.fromEntries(TASK_LIST_NAMES.map(name => [name, []]));
}

const MARKERS = {
  // ── Проверка строки ─────────────────────────────────────────────────
  isSorted:          line => /^SORTED\s*\(/i.test(line.trim()),
  isPartiallySorted: line => /^PARTIALLY SORTED/i.test(line.trim()),
  // Both spellings remain readable, but new writes use IGNORED TASKS (date).
  isIgnored: line => /^(?:IGNORED TASKS|ИГНОРИРУЕМЫЕ\s+ЗАДАЧИ)(?:\s*\(\d{4}\.\d{2}\.\d{2}\)|\s+\d{4}\.\d{2}\.\d{2})?\s*$/i.test(line.trim()),
  isInboxSorted:     line => /^(?:INBOX SORTED|NEW ARRAY)$/i.test(line.trim()),
  // Legacy-only predicate. NEW ARRAY remains readable, but all canonical
  // writes use INBOX SORTED so existing documents migrate without data loss.
  isNewArray:        line => /^NEW ARRAY$/i.test(line.trim()),
  isUnordered:       line => /^НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ$/i.test(line.trim()),

  // Имя списка в единой внутренней модели. NEW ARRAY распознаётся только как
  // старое имя INBOX SORTED и нормализуется при следующей записи.
  getListName(line) {
    if (MARKERS.isInboxSorted(line)) return 'inboxSorted';
    if (MARKERS.isSorted(line)) return 'sorted';
    if (MARKERS.isPartiallySorted(line)) return 'partiallySorted';
    if (MARKERS.isIgnored(line)) return 'ignored';
    if (MARKERS.isUnordered(line)) return 'inboxUnsorted';
    return null;
  },

  // Extract the persisted marker date without changing the raw todo.txt line.
  // Human-readable ages are a rendering concern and must never be serialized.
  getDate(line) {
    const match = String(line || '').trim().match(/(?:\(|\s)(\d{4})\.(\d{2})\.(\d{2})\)?/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  },

  // Любой маркер секции (включая INBOX SORTED / legacy NEW ARRAY).
  isAnyMarker(line) {
    return MARKERS.getListName(line) !== null;
  },

  // Маркеры, завершающие блок SORTED (всё, что идёт ниже — уже не SORTED)
  isSortedEnd(line) {
    const listName = MARKERS.getListName(line);
    return listName !== null && listName !== 'sorted';
  },

  // ── Генерация строк маркеров ────────────────────────────────────────
  makeSorted:  (year, month, day) => `SORTED (${year}.${month}.${day})`,
  makePartial: (year, month, day) => `PARTIALLY SORTED (${year}.${month}.${day})`,
  makeIgnored: (year, month, day) => `IGNORED TASKS (${year}.${month}.${day})`,
  makeInboxSorted:   () => 'INBOX SORTED',
  makeInboxUnsorted: () => 'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
};

/**
 * Replace only the exact legacy section marker, never task substrings. This is
 * intentionally a text-level migration so ordinary saves do not rebuild or
 * reorder the complete task document.
 */
function canonicalizeTaskDocumentMarkers(input) {
  return String(input || '')
    .replace(/^[\t ]*NEW ARRAY[\t ]*$/gim, MARKERS.makeInboxSorted())
    .replace(
      /^[\t ]*ИГНОРИРУЕМЫЕ\s+ЗАДАЧИ(?:\s*\(?(\d{4})\.(\d{2})\.(\d{2})\)?)?[\t ]*$/gim,
      (_line, year, month, day) => year
        ? MARKERS.makeIgnored(year, month, day)
        : 'IGNORED TASKS',
    );
}

/**
 * Parse the complete todo.txt document into the five business lists.
 *
 * The current canonical layout keeps inboxUnsorted above SORTED. Older files
 * may instead contain `sorted / NEW ARRAY / inboxSorted / НЕУПОРЯДОЧЕННЫЕ
 * ЗАДАЧИ / inboxUnsorted`; that legacy layout is accepted so it can be safely
 * rewritten without losing tasks. Completed tasks stay in their source list —
 * filtering them out here used to delete them during the next rebuild.
 */
function parseTaskDocument(text) {
  const sourceLines = Array.isArray(text) ? text : String(text || '').split(/\r?\n/);
  const rawLines = sourceLines
    .map(line => String(line).trimEnd())
    .filter(line => line.trim());
  const lists = createTaskLists();
  const sectionMarkers = Object.fromEntries(TASK_LIST_NAMES.map(name => [name, null]));
  const entries = [];
  const isLegacyMergeLayout =
    !rawLines.some(line => MARKERS.isSorted(line)) &&
    rawLines.some(line => MARKERS.isInboxSorted(line));
  let currentList = isLegacyMergeLayout ? 'sorted' : 'inboxUnsorted';

  for (const line of rawLines) {
    const markerList = MARKERS.getListName(line);
    if (markerList) {
      currentList = markerList;
      if (!sectionMarkers[markerList]) sectionMarkers[markerList] = line;
      entries.push(Object.freeze({ kind: 'marker', line, listName: markerList }));
      continue;
    }

    const listIndex = lists[currentList].length;
    lists[currentList].push(line);
    entries.push(Object.freeze({ kind: 'task', line, listName: currentList, listIndex }));
  }

  return Object.freeze({
    ...lists,
    markers: Object.freeze(sectionMarkers),
    entries: Object.freeze(entries),
    legacyMergeLayout: isLegacyMergeLayout,
  });
}

/**
 * Serialize all five lists in one canonical order. inboxUnsorted deliberately
 * has no heading and therefore remains at the very top. Legacy
 * НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ input is normalized to that top inbox on a rebuild.
 * No operation may assemble a complete document without this function and
 * formatTaskList().
 */
function serializeTaskDocument(documentModel, options = {}) {
  const model = documentModel || {};
  const sectionMarkers = model.markers || {};
  const today = String(options.today || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateParts = today ? today.slice(1) : ['0000', '00', '00'];
  const lists = Object.fromEntries(
    TASK_LIST_NAMES.map(name => [name, Array.isArray(model[name]) ? model[name] : []])
  );
  const lines = [...lists.inboxUnsorted];

  const hasSortedBoundary = Boolean(
    sectionMarkers.sorted || lists.sorted.length || lists.inboxSorted.length || lists.partiallySorted.length
  );
  if (hasSortedBoundary) {
    lines.push(sectionMarkers.sorted || MARKERS.makeSorted(...dateParts));
    lines.push(...lists.sorted);
  }
  // An empty inboxSorted section has no business meaning. Always emit the
  // canonical name so parsing an old NEW ARRAY document performs migration.
  if (lists.inboxSorted.length) {
    lines.push(MARKERS.makeInboxSorted());
    lines.push(...lists.inboxSorted);
  }
  if (lists.partiallySorted.length || sectionMarkers.partiallySorted) {
    lines.push(sectionMarkers.partiallySorted || MARKERS.makePartial(...dateParts));
    lines.push(...lists.partiallySorted);
  }
  if (lists.ignored.length || sectionMarkers.ignored) {
    const existingIgnoredDate = MARKERS.getDate(sectionMarkers.ignored);
    const ignoredDateParts = existingIgnoredDate
      ? existingIgnoredDate.split('-')
      : dateParts;
    lines.push(MARKERS.makeIgnored(...ignoredDateParts));
    lines.push(...lists.ignored);
  }

  return formatTaskList(lines);
}

/**
 * Единственный источник истины для сборки полного todo.txt списка.
 * Любой полный rebuild списка обязан вызывать эту функцию.
 *
 * Канонический формат:
 * - одна пустая строка между задачами;
 * - одна пустая строка перед новым разделом;
 * - заголовок раздела остаётся рядом с первой задачей раздела.
 */
function formatTaskList(input) {
  const lines = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n/);
  const result = [];
  let previousKind = null;

  for (const rawLine of lines) {
    const line = canonicalizeTaskDocumentMarkers(String(rawLine).trimEnd());
    if (!line.trim()) continue;

    const kind = MARKERS.isAnyMarker(line) ? 'marker' : 'task';
    if (result.length > 0 && (previousKind === 'task' || kind === 'marker')) {
      result.push('');
    }
    result.push(line);
    previousKind = kind;
  }

  return result.join('\n');
}
