const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const FIXTURE_PATH = 'private-test-data/default-tasks.txt';
const appSource = fs.readFileSync('sorter 2025/app.js', 'utf8');
const markersSource = fs.readFileSync('sorter 2025/markers.js', 'utf8');

function ensure(condition, code) {
  if (!condition) throw new Error(`real-list smoke failed: ${code}`);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function orderedBagDigest(lines) {
  return digest(JSON.stringify([...lines].sort()));
}

// Keep private task text out of assertion output. Only fixed error codes and
// aggregate counts may leave this test process.
function extractFunction(name) {
  const pattern = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'gm');
  const matches = Array.from(appSource.matchAll(pattern));
  ensure(matches.length > 0, `missing-function-${name}`);
  const start = matches[matches.length - 1].index;
  const openingBrace = appSource.indexOf('{', start);
  let depth = 0;

  for (let index = openingBrace; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }

  throw new Error(`real-list smoke failed: incomplete-function-${name}`);
}

const restoredNames = [
  'mergeSort',
  'merge',
  'compareTasks',
  'parseArrays',
  'gallopRight',
  'gallopLeft',
  'mergeGalloping',
  'mergeArraysUI',
  'filterTasks',
  'insertUnsortedTasksUI',
  'filterTasksUI',
  'heapifyDown',
  'partialSortTasks',
  'parseAllSections',
  'promoteTailCandidates',
  'sortTasks',
];

const supportNames = ['applyTaskListMutation'];

function createRuntime() {
  const storage = new Map();
  const context = vm.createContext({
    // Several historical functions log complete task strings. Suppress those
    // logs so the private fixture can never leak into CI or terminal output.
    console: { log() {}, error() {} },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    Event: class Event {
      constructor(type, options) {
        this.type = type;
        this.options = options;
      }
    },
  });
  vm.runInContext(markersSource, context, { filename: 'markers.js' });
  vm.runInContext([
    ...restoredNames.map(extractFunction),
    ...supportNames.map(extractFunction),
    `globalThis.__sorting = { ${restoredNames.join(', ')} };`,
    'globalThis.__markers = MARKERS;',
    'globalThis.__parseTaskDocument = parseTaskDocument;',
    'globalThis.__serializeTaskDocument = serializeTaskDocument;',
  ].join('\n\n'), context, { filename: 'restored-sorting-functions.js' });
  return {
    context,
    sorting: context.__sorting,
    markers: context.__markers,
    parseDocument: context.__parseTaskDocument,
    serializeDocument: context.__serializeTaskDocument,
  };
}

function installDeterministicComparator(context, counters) {
  context.__testCompare = async (left, right) => {
    counters.comparisons += 1;
    if (left === right) return -1;
    return left < right ? -1 : 1;
  };
  vm.runInContext('compareTasks = __testCompare;', context);
}

function activeSections(parsed) {
  return [...parsed.newTasks, ...parsed.sortedTasks, ...parsed.partiallySorted];
}

(async function run() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    process.stdout.write('real-list sorting smoke: skipped (private fixture unavailable)\n');
    return;
  }
  const realBytesBefore = fs.readFileSync(FIXTURE_PATH);
  const realText = realBytesBefore.toString('utf8').replace(/^\uFEFF/, '');
  const sourceDigest = digest(realBytesBefore);
  const { context, sorting, markers, parseDocument, serializeDocument } = createRuntime();
  const counters = { comparisons: 0, saves: 0, filterDecisions: 0 };

  installDeterministicComparator(context, counters);
  context.saveDataToLocalStorage = () => { counters.saves += 1; };
  context.getDateParts = () => ({ year: '2026', month: '09', day: '10' });
  context.assignPrioritiesAfterSort = () => {};
  context.syncHighlight = () => {};
  context.renderFilterBar = () => {};
  context.saveSnapshot = () => {};
  context.Swal = {
    fire: async options => {
      ensure(!(options === 'Ошибка' || options?.title === 'Ошибка'), 'ui-reported-error');
      return { isConfirmed: false, isDenied: true };
    },
  };

  const beforeSort = sorting.parseAllSections(realText);
  const beforeActive = activeSections(beforeSort);
  ensure(beforeActive.length > 1, 'fixture-has-too-few-sortable-tasks');
  ensure(beforeSort.tail.length > 0, 'fixture-has-no-ignored-tail');

  // Exercise the exact current document through Sort Tasks. All writes happen
  // only on this in-memory textarea stand-in.
  context.taskList = { value: realText };
  await sorting.sortTasks();
  const afterSort = sorting.parseAllSections(context.taskList.value);
  ensure(
    orderedBagDigest(activeSections(afterSort)) === orderedBagDigest(beforeActive),
    'sort-changed-active-task-multiset',
  );
  ensure(
    digest(afterSort.tail.join('\n')) === digest(beforeSort.tail.join('\n')),
    'sort-changed-ignored-tail',
  );
  const expectedWinnerCount = beforeActive.length <= 60
    ? beforeActive.length
    : Math.min(50, Math.ceil(beforeActive.length * 0.2));
  ensure(afterSort.sortedTasks.length === expectedWinnerCount,
    'sort-produced-wrong-winner-count');

  // Build all five current lists in memory from the private fixture. The two
  // merge inputs are individually ranked; the other lists must survive byte
  // for byte at the task-line level and the fixture itself must remain read-only.
  const parsedReal = parseDocument(realText);
  const ranked = [...parsedReal.inboxUnsorted].sort();
  ensure(ranked.length > 4, 'fixture-has-too-few-tasks-for-five-list-merge');
  const untouchedInbox = ranked.slice(0, 1);
  const untouchedPartial = ranked.slice(1, 2);
  const mergePool = ranked.slice(2);
  const first = mergePool.filter((_task, index) => index % 2 === 0);
  const second = mergePool.filter((_task, index) => index % 2 === 1);
  const mergeInput = serializeDocument({
    inboxUnsorted: untouchedInbox,
    sorted: first,
    inboxSorted: second,
    partiallySorted: untouchedPartial,
    ignored: [...parsedReal.ignored],
    markers: {
      sorted: 'SORTED (2026.09.01)',
      inboxSorted: 'INBOX SORTED',
      partiallySorted: 'PARTIALLY SORTED (2026.09.01)',
      ignored: parsedReal.markers.ignored,
    },
  }, { today: '2026-09-10' });
  context.taskList = { value: mergeInput, dispatchEvent() {} };
  await sorting.mergeArraysUI();
  const afterMerge = parseDocument(context.taskList.value);
  ensure(
    orderedBagDigest(afterMerge.sorted) === orderedBagDigest(mergePool),
    'merge-changed-ranked-task-multiset',
  );
  ensure(afterMerge.inboxSorted.length === 0, 'merge-left-inbox-sorted-content');
  ensure(!/(?:^|\n)(?:NEW ARRAY|INBOX SORTED)(?:\n|$)/.test(context.taskList.value),
    'merge-left-inbox-sorted-marker');
  ensure(orderedBagDigest(afterMerge.inboxUnsorted) === orderedBagDigest(untouchedInbox),
    'merge-changed-unsorted-inbox');
  ensure(orderedBagDigest(afterMerge.partiallySorted) === orderedBagDigest(untouchedPartial),
    'merge-changed-partial-list');
  ensure(
    orderedBagDigest(afterMerge.ignored) === orderedBagDigest(parsedReal.ignored),
    'merge-changed-ignored-list',
  );

  // Exercise batch insertion against the exact current structure. The source
  // list need not already be ordered for this no-loss smoke assertion.
  const syntheticTask = '__REAL_LIST_SMOKE_TASK_DO_NOT_PERSIST__';
  ensure(!realText.includes(syntheticTask), 'synthetic-task-collision');
  context.taskList.value = realText;
  await sorting.insertUnsortedTasksUI([syntheticTask]);
  const insertedLines = context.taskList.value.split(/\r?\n/);
  const ignoredIndex = insertedLines.findIndex(line => markers.isIgnored(line));
  ensure(ignoredIndex >= 0, 'insert-lost-ignored-marker');
  const insertedUpperTasks = insertedLines.slice(0, ignoredIndex)
    .filter(line => line.trim() && !markers.isAnyMarker(line));
  ensure(
    orderedBagDigest(insertedUpperTasks)
      === orderedBagDigest([...beforeActive, syntheticTask]),
    'insert-changed-upper-task-multiset',
  );
  ensure(
    digest(insertedLines.slice(ignoredIndex).join('\n')) === digest(beforeSort.tail.join('\n')),
    'insert-changed-ignored-tail',
  );

  // Exercise Filter Tasks without subjective edits: keep every active task.
  const originalNonMarkerTasks = realText.split(/\r?\n|\t/)
    .filter(line => line.trim() && !markers.isAnyMarker(line) && !/^x /.test(line.trim()));
  const expectedUniqueTasks = Array.from(new Set(originalNonMarkerTasks));
  context.chooseWindow = async task => {
    counters.filterDecisions += 1;
    return { action: 'include', text: task };
  };
  context.taskList.value = realText;
  await sorting.filterTasksUI();
  const filteredTasks = context.taskList.value.split(/\r?\n/)
    .filter(line => line.trim() && !markers.isAnyMarker(line));
  ensure(
    orderedBagDigest(filteredTasks) === orderedBagDigest(expectedUniqueTasks),
    'filter-output-does-not-match-historical-contract',
  );
  ensure(counters.filterDecisions === expectedUniqueTasks.length,
    'filter-decision-count-mismatch');

  const realBytesAfter = fs.readFileSync(FIXTURE_PATH);
  ensure(digest(realBytesAfter) === sourceDigest, 'private-fixture-was-modified');

  process.stdout.write(`${JSON.stringify({
    sourceLines: realText.split(/\r?\n/).length,
    sortableTasks: beforeActive.length,
    ignoredTailLines: beforeSort.tail.length,
    comparisons: counters.comparisons,
    filterDecisions: counters.filterDecisions,
    sourceUnchanged: true,
  })}\nreal-list sorting smoke: passed\n`);
})().catch(error => {
  // Error messages are fixed codes by design and cannot include task text.
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
