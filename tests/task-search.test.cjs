const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const AutoContext = require('../sorter 2025/auto-context.js');
const TaskFormat = require('../sorter 2025/task-format.js');

const source = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
const start = source.indexOf('    function tokenizeSearch(');
const end = source.indexOf('    // --- Parsing ---', start);
assert(start >= 0 && end > start, 'search functions must be present on the tasks page');
const { searchMatches, queryTerms } = vm.runInNewContext(
  `${source.slice(start, end)}\n({ searchMatches, queryTerms })`,
);
const task = (text, contexts = []) => ({ _raw: text, contexts });

// Existing English operators, implicit AND, exclusions and phrases remain usable.
assert.equal(searchMatches(task('купить хлеб'), 'купить хлеб'), true);
assert.equal(searchMatches(task('купить хлеб'), 'купить OR позвонить'), true);
assert.equal(searchMatches(task('купить хлеб'), 'купить AND молоко'), false);
assert.equal(searchMatches(task('купить хлеб'), 'купить -молоко'), true);
assert.equal(searchMatches(task('купить хлеб'), 'купить -хлеб'), false);
assert.equal(searchMatches(task('купить хлеб'), '"купить хлеб"'), true);

// Russian and English operators have the same precedence and can be mixed.
for (const or of ['ИЛИ', 'OR', '||', 'или']) {
  assert.equal(searchMatches(task('позвонить'), `купить ${or} позвонить`), true);
}
for (const and of ['И', 'AND', '&&', 'и']) {
  assert.equal(searchMatches(task('купить хлеб'), `купить ${and} хлеб`), true);
  assert.equal(searchMatches(task('купить хлеб'), `купить ${and} молоко`), false);
}
assert.equal(searchMatches(task('позвонить'), 'купить И хлеб ИЛИ позвонить'), true);
assert.equal(searchMatches(task('купить хлеб'), '(купить ИЛИ позвонить) И хлеб'), true);
assert.equal(searchMatches(task('позвонить'), '(купить ИЛИ позвонить) И хлеб'), false);

// Context terms match whole parsed tags, not words or prefixes in the title.
assert.equal(searchMatches(task('Работа', ['ПК']), '@ПК'), true);
assert.equal(searchMatches(task('Работа', ['дома']), '@дом'), false);
assert.equal(searchMatches(task('Поговорить дома'), '@дома'), false);
assert.equal(searchMatches(task('Работа', ['дома']), '-@дом'), true);

const homeOr = AutoContext.buildAutoSearchQuery(['ноут', 'дом']);
const homeAnd = AutoContext.buildAutoSearchQuery(['ноут', 'дом'], 'and');
for (const contexts of [['ноут'], ['ПК'], ['дом'], ['дома']]) {
  assert.equal(searchMatches(task('Задача', contexts), homeOr), true, contexts.join(','));
}
assert.equal(searchMatches(task('Задача', ['ПК', 'дома']), homeAnd), true);
assert.equal(searchMatches(task('Задача', ['ноут', 'дом']), homeAnd), true);
const parsedTask = TaskFormat.parseTaskLine('Задача @ПК @дома');
assert.equal(searchMatches({ ...parsedTask, _raw: parsedTask.raw }, homeAnd), true);
assert.equal(searchMatches(task('Задача', ['ПК']), homeAnd), false);
assert.equal(searchMatches(task('Задача', ['город']), homeOr), false);
assert.deepEqual([...queryTerms('купить И хлеб ИЛИ @дом -молоко')], ['купить', 'хлеб']);

// The tasks page must use the visible query as the only context condition in /auto.
const filterStart = source.indexOf('    function getFiltered()');
const filterEnd = source.indexOf('    function getSorted(', filterStart);
assert(filterStart >= 0 && filterEnd > filterStart);
function filtered(autoMode, searchQ) {
  return vm.runInNewContext(`${source.slice(filterStart, filterEnd)}\ngetFiltered()`, {
    autoMode, searchQ, searchMatches, SorterAutoContext: AutoContext,
    items: [task('Первое', ['ПК']), task('Второе', ['город'])],
    sortMode: 'order', tab: 'active', showIgnored: false, showFuture: false,
    TaskListOperations: { localIsoDate: () => '2026-10-30' },
    priF: null, ctxF: new Set(['ноут', 'дом']), contextOperator: 'or',
    projF: null, hashtagF: null,
  });
}
assert.equal(filtered(true, homeOr).length, 1);
assert.equal(filtered(true, homeOr)[0]._raw, 'Первое');
assert.equal(filtered(false, '').length, 0);

const autoStart = source.indexOf('    function updateAutoSearchQuery(');
const autoEnd = source.indexOf('    const originalRender = render;', autoStart);
assert(autoStart >= 0 && autoEnd > autoStart);
function autoRuntime() {
  const input = { value: '' };
  const clear = { style: { display: 'none' } };
  let resolveLocation;
  const location = new Promise(resolve => { resolveLocation = resolve; });
  const context = vm.createContext({
    autoMode: true, autoSearchEdited: false, searchQ: '',
    ctxF: new Set(), contextOperator: 'or', autoContextState: null,
    SorterAutoContext: {
      ...AutoContext,
      detectDeviceContext: () => 'ноут',
      resolveAutoContexts: () => location,
    },
    document: { getElementById: id => id === 'search' ? input : clear },
    navigator: {}, window: { innerWidth: 1280 }, localStorage: {},
    renderAutoContextBanner() {}, render() {},
  });
  const api = vm.runInContext(`${source.slice(autoStart, autoEnd)}\n({
    initAutoContextMode,
    edit(query) {
      autoSearchEdited = true;
      ctxF.clear();
      searchQ = query;
      document.getElementById('search').value = query;
    }
  })`, context);
  return { api, input, resolveLocation };
}

(async () => {
  const normal = autoRuntime();
  const normalRun = normal.api.initAutoContextMode();
  assert.equal(normal.input.value, '@ноут ИЛИ @ПК');
  normal.resolveLocation({ contexts: ['ноут', 'дом'], location: 'home', error: null });
  await normalRun;
  assert.equal(normal.input.value, homeOr);

  const edited = autoRuntime();
  const editedRun = edited.api.initAutoContextMode();
  edited.api.edit('мой запрос');
  edited.resolveLocation({ contexts: ['ноут', 'дом'], location: 'home', error: null });
  await editedRun;
  assert.equal(edited.input.value, 'мой запрос');
  console.log('task search tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
