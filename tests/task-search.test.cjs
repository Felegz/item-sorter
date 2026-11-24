const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const AutoContext = require('../sorter 2025/auto-context.js');
const TaskFormat = require('../sorter 2025/task-format.js');

const source = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
const page = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
assert.match(page, /<input id="search" type="search"/);
assert.doesNotMatch(page, /id="search-clear"/, 'native search clear is the only visible clear control');
assert.doesNotMatch(source, /getElementById\('search-clear'\)/);
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

const homeOr = AutoContext.buildAutoSearchQuery(['ноут', 'дом'], 'or');
const homeAnd = AutoContext.buildAutoSearchQuery(['ноут', 'дом'], 'and');
const phoneHome = AutoContext.buildAutoSearchQuery(['телефон', 'дом'], 'and');
const desktopCity = AutoContext.buildAutoSearchQuery(['ноут', 'город'], 'and');
const phoneCity = AutoContext.buildAutoSearchQuery(['телефон', 'город'], 'and');
const visibility = (contexts, query) => searchMatches(task('Задача', contexts), query);
for (const query of [homeAnd, phoneHome, desktopCity, phoneCity]) {
  assert.equal(visibility([], query), true, 'untagged tasks stay visible');
  assert.equal(visibility(['телефон', 'ноут'], query), true, 'dual-device tasks stay visible');
  assert.equal(visibility(['телефон', 'ПК'], query), true, 'phone and PC tasks stay visible');
}
assert.equal(visibility(['ПК'], homeAnd), true);
assert.equal(visibility(['ПК'], phoneHome), false);
assert.equal(visibility(['телефон'], homeAnd), false);
assert.equal(visibility(['телефон'], phoneHome), true);
assert.equal(visibility(['дом'], phoneHome), true);
assert.equal(visibility(['дом'], phoneCity), false);
assert.equal(visibility(['дома'], desktopCity), false);
assert.equal(visibility(['город'], homeAnd), false);
assert.equal(visibility(['город'], desktopCity), true);
assert.equal(searchMatches(task('Задача', ['ПК', 'дома']), homeAnd), true);
assert.equal(searchMatches(task('Задача', ['ноут', 'дом']), homeAnd), true);
const parsedTask = TaskFormat.parseTaskLine('Задача @ПК @дома');
assert.equal(searchMatches({ ...parsedTask, _raw: parsedTask.raw }, homeAnd), true);
assert.equal(searchMatches(task('Задача', ['ПК']), homeAnd), true);
assert.equal(searchMatches(task('Задача', ['город']), homeOr), true);
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
assert.equal(filtered(true, homeAnd).length, 1);
assert.equal(filtered(true, homeAnd)[0]._raw, 'Первое');
assert.equal(filtered(false, '').length, 0);

// The browser's native clear changes the search input value and fires input.
// That path must also mark AUTO as manually edited, without a second button.
const searchWiringStart = source.indexOf('    // Search');
const searchWiringEnd = source.indexOf('    // Mobile command bar', searchWiringStart);
assert(searchWiringStart >= 0 && searchWiringEnd > searchWiringStart);
const searchEvents = new Map();
const searchInput = {
  value: homeAnd,
  addEventListener(name, callback) { searchEvents.set(name, callback); },
};
const searchWiring = vm.createContext({
  document: {
    getElementById: id => id === 'search' ? searchInput : null,
    querySelector: () => ({ classList: { add() {}, remove() {} } }),
  },
  autoMode: true, autoSearchEdited: false, ctxF: new Set(['ноут', 'дом']),
  searchQ: homeAnd, render() {},
});
vm.runInContext(source.slice(searchWiringStart, searchWiringEnd), searchWiring);
searchInput.value = '';
searchEvents.get('search')();
assert.equal(searchWiring.searchQ, '');
assert.equal(searchWiring.autoSearchEdited, true);
assert.equal(searchWiring.ctxF.size, 0);
searchInput.oninput();
assert.equal(searchWiring.searchQ, '', 'input after search is a no-op for the same value');

// The banner offers a real exit and points to the existing home setting.
assert.match(page, /id="auto-context-exit"[^>]*aria-label="Выключить автофильтр"/);
assert.match(page, /id="auto-home-help"[^>]*>Дом не задан\. Задать координаты: Список → Ещё инструменты/);
const bannerStart = source.indexOf('    function renderAutoContextBanner(');
const bannerEnd = source.indexOf('    function updateAutoSearchQuery(', bannerStart);
assert(bannerStart >= 0 && bannerEnd > bannerStart);
const banner = { hidden: true };
const summary = { textContent: '' };
const help = { hidden: true, href: '' };
const exit = { onclick: null };
const currentUrl = 'http://localhost:4173/tasks.html?auto=1&mode=developer';
let exitDestination = '';
const bannerContext = vm.createContext({
  autoMode: true, autoSearchEdited: false, contextOperator: 'and', searchQ: homeAnd,
  autoContextState: { contexts: ['ноут'], location: 'unset' },
  document: { getElementById(id) {
    return ({ 'auto-context-banner': banner, 'auto-context-summary': summary,
      'auto-home-help': help, 'auto-context-exit': exit })[id];
  } },
  SorterAutoContext: AutoContext,
  SorterRuntime: { withMode(input) {
    const url = new URL(input, currentUrl);
    if (!url.searchParams.has('mode')) url.searchParams.set('mode', 'developer');
    return url.pathname + url.search + url.hash;
  } },
  window: { location: { href: currentUrl, replace(value) { exitDestination = value; } } },
  navigator: {},
});
vm.runInContext(source.slice(bannerStart, bannerEnd), bannerContext);
bannerContext.renderAutoContextBanner();
assert.equal(banner.hidden, false);
assert.equal(help.hidden, false);
assert.equal(help.href, '/?mode=developer');
assert.match(summary.textContent, /Устройство: ПК; место: дом не задан; режим: И/);
exit.onclick();
assert.equal(exitDestination, '/tasks.html?mode=developer');
bannerContext.autoContextState = { contexts: ['ноут', 'дом'], location: 'home' };
bannerContext.renderAutoContextBanner();
assert.equal(help.hidden, true);
assert.match(summary.textContent, /Устройство: ПК; место: дом; режим: И/);
bannerContext.autoSearchEdited = true;
bannerContext.renderAutoContextBanner();
assert.match(summary.textContent, /Поиск изменён вручную/);

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
    ctxF: new Set(), contextOperator: 'and', autoContextState: null,
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
  assert.equal(normal.input.value, '@ноут ИЛИ @ПК ИЛИ -@телефон');
  normal.resolveLocation({ contexts: ['ноут', 'дом'], location: 'home', error: null });
  await normalRun;
  assert.equal(normal.input.value, homeAnd);

  const edited = autoRuntime();
  const editedRun = edited.api.initAutoContextMode();
  edited.api.edit('мой запрос');
  edited.resolveLocation({ contexts: ['ноут', 'дом'], location: 'home', error: null });
  await editedRun;
  assert.equal(edited.input.value, 'мой запрос');
  console.log('task search tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
