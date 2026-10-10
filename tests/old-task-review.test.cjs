const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const c = vm.createContext({ URL, URLSearchParams });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js', 'task-age.js', 'gtd-task-tools.js']) {
  vm.runInContext(fs.readFileSync('sorter 2025/' + file, 'utf8'), c);
}
// The age module's date-fns delegation is covered by task-age.test.cjs. Here,
// known anniversaries keep the selection tests offline, without a new date library.
const anniversaries = {
  '2026-01-01/2': '2026-03-01', '2026-07-10/2': '2026-09-10',
  '2026-08-10/2': '2026-10-10', '2026-09-10/2': '2026-11-10',
  '2026-07-10/3': '2026-10-10', '2026-08-10/3': '2026-11-10',
};
c.dateFns = {
  isMatch: value => c.TaskGtd.validDate(value),
  startOfDay(date) { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; },
  addMonths(date, months) {
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    assert(anniversaries[day + '/' + months], 'Expected the shared age rule to use a known creation date');
    return c.TaskFormat.parseIsoDateLocal(anniversaries[day + '/' + months]);
  },
};
let preference = null;
c.SorterRuntime = { getItem: key => { assert.equal(key, 'old_task_months'); return preference; } };
const first = document => c.TaskGtd.firstOldUnprocessedTask(document, { now: new Date(2026, 9, 10) });
const raw = [
  'Без даты due:2020-01-01', '', '2026-09-10 Свежая задача', '',
  '2026-01-01 Разобрана gtd:2026-10-09', '', 'x 2026-10-01 2026-01-01 Выполненная', '',
  'INBOX SORTED', '2026-08-10 Первая старая @дом #review', '',
  'SORTED (2026.09.01)', '2026-01-01 Старше, но ниже', '',
  'PARTIALLY SORTED (2026.09.01)', '2026-07-10 Остаток', '',
  'IGNORED TASKS (2026.09.01)', '2026-01-01 Игнорируемая',
].join('\n');
const picked = first(raw);
assert.equal(picked.line, '2026-08-10 Первая старая @дом #review', 'First in document order, not oldest date');
assert.equal(raw.split('\n')[picked.index], picked.line);
preference = '3';
assert.equal(first('2026-08-10 Ещё не старая\n2026-07-10 Старая по настройке').line,
  '2026-07-10 Старая по настройке');
preference = null;
for (const document of ['', 'Без даты due:2020-01-01', '2026-02-30 Неверная дата',
  'X 2026-10-01 2026-01-01 Сделана', '2026-01-01 Разобрана gtd:2026-01-02',
  '2026-01-01 Когда-нибудь +someday-maybe', 'IGNORED TASKS\n2026-01-01 Игнорируемая']) {
  assert.equal(first(document), null);
}
assert.equal(first('2026-01-01 Задача gtd:2026-02-30').index, 0, 'Invalid GTD date is not a saved review');
const duplicate = '2026-08-10 Одинаковая задача';
const duplicates = ['IGNORED TASKS', duplicate, '', 'SORTED (2026.09.01)', duplicate, '', duplicate].join('\n');
assert.equal(first(duplicates).index, 4, 'Skip ignored occurrence without dropping duplicate candidates');
const available = c.dateFns;
c.dateFns = {};
assert.throws(() => first(raw), /Не загрузились/);
c.dateFns = available;

// Run the actual main-page handler in the existing memory-only DOM harness.
const app = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
const start = app.indexOf('async function openOldTaskReview()');
const end = app.indexOf("document.getElementById('old-task-review-btn')", start);
assert(start >= 0 && end > start);
const navigations = [];
const notices = [];
let savedDocument = duplicates;
let failRead = false;
const p = vm.createContext({ URLSearchParams, oldTaskMonths: 2,
  TaskGtd: { firstOldUnprocessedTask: first },
  SorterRuntime: {
    getTasks() { if (failRead) throw new Error('Нет доступа к хранилищу'); return savedDocument; },
    withMode: url => url.replace('/process?', '/process.html?') + '&mode=developer',
  },
  window: { location: { set href(value) {
    navigations.push(value);
  } } },
  Swal: { fire: async value => { notices.push(value); } },
});
vm.runInContext(app.slice(start, end), p);
(async () => {
  await p.openOldTaskReview();
  assert.equal(savedDocument, duplicates, 'Starting a review does not write task data');
  const url = new URL(navigations[0], 'http://localhost:4173/');
  assert.equal(url.pathname, '/process.html');
  for (const [key, value] of Object.entries({ task: duplicate, occurrence: '1', from: 'tasks', flow: 'korz', mode: 'developer' })) {
    assert.equal(url.searchParams.get(key), value);
  }
  assert.equal(c.TaskGtd.findTaskIndex(savedDocument, duplicate, 1), 4);
  failRead = true;
  await p.openOldTaskReview();
  assert.equal(navigations.length, 1, 'Storage failure must keep the current page and text');
  assert.equal(savedDocument, duplicates);
  assert.match(notices.at(-1).text, /хранилищу/);
  failRead = false;
  savedDocument = 'Нет даты';
  await p.openOldTaskReview();
  assert.equal(navigations.length, 1);
  assert.equal(savedDocument, 'Нет даты', 'No candidate must not trigger a write');
  assert.equal(notices.at(-1).text, 'Нет старых неразобранных задач');
  const html = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
  assert.match(html, /id="old-task-review-btn"[^>]*><span data-sorter-icon="sparkles"><\/span>Разобрать старую/);
  assert(html.indexOf('old-task-review-btn') > html.indexOf('</section>') && html.indexOf('old-task-review-btn') < html.indexOf('id="list"'), 'Button must be visible above tasks, outside tools');
  assert(!fs.readFileSync('sorter 2025/index.html', 'utf8').includes('old-task-review-btn'), 'No duplicate on raw list page');
  for (const dependency of ['task-age.js', 'gtd-task-tools.js']) assert(html.indexOf(dependency) < html.indexOf('src="tasks-page.js'));
  console.log('Old task review: shared age, GTD eligibility, order, duplicates, navigation and error paths passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
