const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('sorter 2025/app.js', 'utf8');
const markersSource = fs.readFileSync('sorter 2025/markers.js', 'utf8');

// Load only the restored declarations. Running app.js as a whole would attach
// browser listeners and mix this contract test with unrelated page behavior.
function extractFunction(name) {
  const pattern = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'gm');
  const matches = Array.from(appSource.matchAll(pattern));
  assert.ok(matches.length, `Function ${name} must exist in app.js`);
  const start = matches[matches.length - 1].index;
  const openingBrace = appSource.indexOf('{', start);
  let depth = 0;

  for (let index = openingBrace; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }

  throw new Error(`Could not find the end of ${name}`);
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

function createRuntime() {
  const context = vm.createContext({
    console: { log() {}, error: console.error },
  });
  vm.runInContext(markersSource, context, { filename: 'markers.js' });
  vm.runInContext([
    ...restoredNames.map(extractFunction),
    `globalThis.__sorting = { ${restoredNames.join(', ')} };`,
  ].join('\n\n'), context, { filename: 'restored-sorting-functions.js' });
  return { context, sorting: context.__sorting };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function installComparator(context, ranks, trace) {
  context.__testCompare = async (left, right) => {
    trace.push([left, right]);
    return ranks.get(left) < ranks.get(right) ? -1 : 1;
  };
  vm.runInContext('compareTasks = __testCompare;', context);
}

(async function run() {
  const { context, sorting } = createRuntime();

  // The restored comparison window returns the selected side and renders the
  // historical raw task strings. Rendering will be adapted in a separate step.
  let comparisonHtml = '';
  context.counter = 0;
  context.userQuestion = { value: 'Что важнее?' };
  context.Swal = {
    fire(options) {
      comparisonHtml = options.html;
      options.didOpen();
    },
    getHtmlContainer() {
      return {
        querySelector(selector) {
          return {
            addEventListener(_event, handler) {
              if (selector === '#swal-btn1') handler();
            },
          };
        },
      };
    },
    close() {},
  };
  assert.equal(await sorting.compareTasks('Первая задача', 'Вторая задача'), -1);
  assert.match(comparisonHtml, /Первая задача/);
  assert.match(comparisonHtml, /Вторая задача/);

  const parsedSort = sorting.parseAllSections([
    'B new',
    'x 2026-09-01 completed inbox',
    'SORTED (2026.09.01)',
    'C old',
    'x 2026-09-01 completed sorted',
    'PARTIALLY SORTED (2026.09.01)',
    'E partial',
    'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.01',
    'I ignored',
  ].join('\n'));
  assert.deepEqual(plain(parsedSort), {
    newTasks: ['B new'],
    sortedTasks: ['C old'],
    partiallySorted: ['E partial'],
    tail: ['ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.01', 'I ignored'],
  });

  const parsedMerge = sorting.parseArrays([
    'A old',
    'NEW ARRAY',
    'B batch',
    'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
    'C tail',
  ].join('\n'));
  assert.deepEqual(plain(parsedMerge), {
    first: ['A old'],
    second: ['B batch'],
    tail: ['НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ', 'C tail'],
  });

  const ranks = new Map([
    ['A new', 1], ['B new', 2], ['C old', 3], ['D old', 4],
    ['E partial', 5], ['A', 1], ['B', 2], ['C', 3], ['D', 4],
    ['E', 5], ['F', 6], ['G', 7],
  ]);
  let trace = [];
  installComparator(context, ranks, trace);

  assert.deepEqual(
    plain(await sorting.mergeSort(['B new', 'A new'])),
    ['A new', 'B new'],
  );
  assert.deepEqual(trace, [['B new', 'A new']]);

  trace = [];
  installComparator(context, ranks, trace);
  const stoppedTail = await sorting.promoteTailCandidates(
    ['A', 'C'],
    ['D', 'B'],
  );
  assert.deepEqual(plain(stoppedTail), {
    sortedTasks: ['A', 'C'],
    partiallySorted: ['D', 'B'],
    promoted: 0,
  });
  assert.deepEqual(trace, [['D', 'C']]);

  trace = [];
  installComparator(context, ranks, trace);
  const partial = await sorting.partialSortTasks(['E', 'A', 'D', 'B', 'C'], 2);
  assert.deepEqual(plain(partial.sorted), ['A', 'B']);
  assert.deepEqual(plain(partial.remaining).sort(), ['C', 'D', 'E']);

  // Sort Tasks sorts only the incoming block. The new internally sorted batch
  // is prepended to the old SORTED block without comparing the two blocks.
  trace = [];
  installComparator(context, ranks, trace);
  context.taskList = { value: [
    'B new',
    'A new',
    'SORTED (2026.09.01)',
    'C old',
    'D old',
    'PARTIALLY SORTED (2026.09.01)',
    'E partial',
    'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.01',
    'I ignored',
  ].join('\n') };
  context.saveDataToLocalStorage = () => {};
  context.getDateParts = () => ({ year: '2026', month: '09', day: '10' });
  context.Swal = {
    fire: async options => options && options.title === 'Проверить хвост?'
      ? { isConfirmed: false }
      : { isConfirmed: false },
  };
  await sorting.sortTasks();
  assert.equal(context.taskList.value, [
    'SORTED (2026.09.10)',
    'A new',
    'B new',
    'C old',
    'D old',
    '',
    'PARTIALLY SORTED (2026.09.10)',
    'E partial',
    '',
    'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.01',
    'I ignored',
  ].join('\n'));
  assert.deepEqual(trace, [['B new', 'A new']]);

  // Merge Arrays keeps an empty NEW ARRAY marker and the untouched unordered
  // tail after merging the two already ranked arrays.
  trace = [];
  installComparator(context, ranks, trace);
  context.taskList.value = [
    'SORTED (2026.09.01)',
    'A',
    'C',
    'NEW ARRAY',
    'B',
    'D',
    'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
    'G',
  ].join('\n');
  await sorting.mergeArraysUI();
  assert.equal(context.taskList.value, [
    'A',
    'B',
    'C',
    'D',
    'NEW ARRAY',
    'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
    'G',
  ].join('\n'));
  assert.deepEqual(trace, [['A', 'B'], ['C', 'B'], ['C', 'D']]);

  // The restored batch insertion treats every non-marker line above the
  // ignored section as one ranked array and moves its markers to the top.
  trace = [];
  installComparator(context, ranks, trace);
  context.taskList.value = [
    'A',
    'SORTED (2026.09.01)',
    'C',
    'E',
    'PARTIALLY SORTED (2026.09.01)',
    'G',
    'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.01',
    'ignored',
  ].join('\n');
  await sorting.insertUnsortedTasksUI(['B', 'F']);
  assert.equal(context.taskList.value, [
    'SORTED (2026.09.01)',
    'PARTIALLY SORTED (2026.09.01)',
    'A',
    'B',
    'C',
    'E',
    'F',
    'G',
    '',
    'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.01',
    'ignored',
  ].join('\n'));

  // Filter Tasks deduplicates active lines and rebuilds the document using the
  // historical double-newline join. Completed lines do not survive this path.
  context.taskList.value = [
    'A',
    'SORTED (2026.09.01)',
    'A',
    'B',
    'x 2026-09-01 completed',
    'C',
  ].join('\n');
  context.chooseWindow = async task => {
    if (task === 'A') return { action: 'include', text: 'A edited' };
    if (task === 'B') return { action: 'ignore', text: 'B ignored' };
    return { action: 'delete', text: task };
  };
  await sorting.filterTasksUI();
  assert.equal(
    context.taskList.value,
    'A edited\n\n\n\nИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.10\n\nB ignored',
  );

  console.log('restored sorting characterization: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
