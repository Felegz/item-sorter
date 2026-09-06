// markers.js — единый источник истины для маркеров секций todo.txt
//
// Единая модель списков:
//   inboxUnsorted  — новые задачи без внутреннего порядка
//   inboxSorted    — новая отсортированная партия перед слиянием
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
  isIgnored:         line => /^ИГНОРИРУЕМЫЕ\s+ЗАДАЧИ/i.test(line.trim()),
  isNewArray:        line => /^NEW ARRAY$/i.test(line.trim()),
  isUnordered:       line => /^НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ$/i.test(line.trim()),

  // Имя списка в единой внутренней модели. Текстовые маркеры остаются
  // прежними ради совместимости с существующими todo.txt файлами.
  getListName(line) {
    if (MARKERS.isNewArray(line)) return 'inboxSorted';
    if (MARKERS.isSorted(line)) return 'sorted';
    if (MARKERS.isPartiallySorted(line)) return 'partiallySorted';
    if (MARKERS.isIgnored(line)) return 'ignored';
    if (MARKERS.isUnordered(line)) return 'inboxUnsorted';
    return null;
  },

  // Любой маркер секции (включая NEW ARRAY / НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ)
  isAnyMarker(line) {
    return MARKERS.getListName(line) !== null;
  },

  // Маркеры, завершающие блок SORTED (всё, что идёт ниже — уже не SORTED)
  isSortedEnd(line) {
    return MARKERS.isPartiallySorted(line) || MARKERS.isIgnored(line);
  },

  // ── Генерация строк маркеров ────────────────────────────────────────
  makeSorted:  (year, month, day) => `SORTED (${year}.${month}.${day})`,
  makePartial: (year, month, day) => `PARTIALLY SORTED (${year}.${month}.${day})`,
  makeIgnored: (year, month, day) => `ИГНОРИРУЕМЫЕ ЗАДАЧИ ${year}.${month}.${day}`,
  makeInboxSorted:   () => 'NEW ARRAY',
  makeInboxUnsorted: () => 'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
};

function taskLines(lines, { activeOnly = false } = {}) {
  return lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed || MARKERS.isAnyMarker(trimmed)) return false;
    return !activeOnly || !/^x /.test(trimmed);
  });
}

/**
 * Разбирает документ для команды Merge Arrays.
 * До NEW ARRAY лежит sorted, после него — inboxSorted. Блок от
 * НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ сохраняется без изменений в sourceBlocks.
 */
function parseMergeTaskLists(text) {
  const lines = String(text || '').split(/\r?\n/);
  const inboxSortedIndex = lines.findIndex(line => MARKERS.isNewArray(line));
  const inboxUnsortedIndex = lines.findIndex(line => MARKERS.isUnordered(line));

  const sortedLines = inboxSortedIndex > -1
    ? lines.slice(0, inboxSortedIndex)
    : lines.slice();
  const inboxSortedLines = inboxSortedIndex > -1 && inboxUnsortedIndex > -1
    ? lines.slice(inboxSortedIndex + 1, inboxUnsortedIndex)
    : inboxSortedIndex > -1
      ? lines.slice(inboxSortedIndex + 1)
      : [];
  const inboxUnsortedBlock = inboxUnsortedIndex > -1
    ? lines.slice(inboxUnsortedIndex)
    : [];
  const ignoredIndex = inboxUnsortedBlock.findIndex(line => MARKERS.isIgnored(line));
  const inboxUnsortedLines = ignoredIndex > -1
    ? inboxUnsortedBlock.slice(0, ignoredIndex)
    : inboxUnsortedBlock;
  const ignoredLines = ignoredIndex > -1
    ? inboxUnsortedBlock.slice(ignoredIndex)
    : [];

  return {
    ...createTaskLists(),
    sorted: taskLines(sortedLines),
    inboxSorted: taskLines(inboxSortedLines),
    inboxUnsorted: taskLines(inboxUnsortedLines),
    ignored: taskLines(ignoredLines),
    sourceBlocks: { inboxUnsorted: inboxUnsortedBlock },
  };
}

/**
 * Разбирает документ для команды Sort Tasks.
 * Начальные строки — inboxUnsorted; остальные списки начинаются со своих
 * маркеров. Полный ignored-блок сохраняется для обратной совместимости.
 */
function parseSortTaskLists(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sortedIndex = lines.findIndex(line => MARKERS.isSorted(line));
  const partiallySortedIndex = lines.findIndex(line => MARKERS.isPartiallySorted(line));
  const ignoredIndex = lines.findIndex(line => MARKERS.isIgnored(line));

  const sortedEnd = partiallySortedIndex > -1
    ? partiallySortedIndex
    : ignoredIndex > -1 ? ignoredIndex : lines.length;
  const partiallySortedEnd = ignoredIndex > -1 ? ignoredIndex : lines.length;

  const inboxUnsortedLines = sortedIndex > -1
    ? lines.slice(0, sortedIndex)
    : lines.slice(0, sortedEnd);
  const sortedLines = sortedIndex > -1
    ? lines.slice(sortedIndex + 1, sortedEnd)
    : [];
  const partiallySortedLines = partiallySortedIndex > -1
    ? lines.slice(partiallySortedIndex + 1, partiallySortedEnd)
    : [];
  const ignoredBlock = ignoredIndex > -1 ? lines.slice(ignoredIndex) : [];

  return {
    ...createTaskLists(),
    inboxUnsorted: taskLines(inboxUnsortedLines, { activeOnly: true }),
    sorted: taskLines(sortedLines, { activeOnly: true }),
    partiallySorted: taskLines(partiallySortedLines, { activeOnly: true }),
    ignored: taskLines(ignoredBlock),
    sourceBlocks: { ignored: ignoredBlock },
  };
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
    const line = String(rawLine).trimEnd();
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
