const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const TaskFormat = require('../sorter 2025/task-format.js');
const TaskAge = require('../sorter 2025/task-age.js');

// Offline fixtures verify the age rule's boundary and delegation, not a second
// implementation of month arithmetic. The same cases can run with real date-fns.
const anniversaries = {
  '2026-08-09/2': '2026-10-09',
  '2026-01-31/1': '2026-02-28',
  '2024-01-31/1': '2024-02-29',
  '2026-01-31/2': '2026-03-31',
  '2026-08-09/3': '2026-11-09',
};
const fixtureDateFns = {
  isMatch(value, pattern) {
    assert.equal(pattern, 'yyyy-MM-dd');
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value !== '2026-02-30';
  },
  startOfDay(date) { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; },
  addMonths(date, months) {
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') + '/' + months;
    assert.ok(anniversaries[key], 'Month arithmetic delegated with the creation date and configured threshold');
    return TaskFormat.parseIsoDateLocal(anniversaries[key]);
  },
};
const dateFns = global.dateFns || fixtureDateFns;
const old = (date, now, months = 2) => TaskAge.isOldTask({ creationDate: date }, {
  now: TaskFormat.parseIsoDateLocal(now), months, dateFns, taskFormat: TaskFormat,
});
assert.equal(old('2026-08-09', '2026-10-08'), false);
assert.equal(old('2026-08-09', '2026-10-09'), true);
assert.equal(old('2026-08-09', '2026-10-10'), true);
assert.equal(old('2026-08-09', '2026-10-09', 3), false);
assert.equal(old('2026-01-31', '2026-02-27', 1), false);
assert.equal(old('2026-01-31', '2026-02-28', 1), true);
assert.equal(old('2024-01-31', '2024-02-28', 1), false);
assert.equal(old('2024-01-31', '2024-02-29', 1), true);
assert.equal(old('2026-01-31', '2026-03-30'), false);
assert.equal(old('2026-01-31', '2026-03-31'), true);
assert.equal(old('2026-08-09', '2026-08-08'), false);
for (const date of [null, '', '2026-02-30', 'invalid']) assert.equal(old(date, '2026-10-09'), false);
for (const raw of ['Без даты due:2020-01-01', 'Без даты snz:2020-01-01', 'x 2020-01-01 Без даты']) {
  const task = TaskFormat.parseTaskLine(raw);
  assert.equal(TaskAge.isOldTask(task, { dateFns, now: new Date(2026, 9, 9) }), false);
  assert.equal(task.raw, raw);
}
assert.equal(TaskAge.isOldTask({ creationDate: '2026-01-31' }, { dateFns: {}, taskFormat: TaskFormat }), false);

const entries = new Map();
const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)) };
assert.equal(TaskAge.getMonths(storage), 2);
assert.equal(TaskAge.setMonths('3', storage), 3);
assert.equal(TaskAge.getMonths(storage), 3);
assert.deepEqual([...entries.keys()], ['old_task_months']);
for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity']) {
  assert.equal(TaskAge.validMonths(value), false);
  assert.throws(() => TaskAge.setMonths(value, storage));
  entries.set('old_task_months', value);
  assert.equal(TaskAge.getMonths(storage), 2);
}
assert.equal(TaskAge.getMonths({ getItem() { throw Error('Storage denied'); } }), 2);

const page = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
const start = page.indexOf('    function renderTaskCreation(');
const end = page.indexOf('\n    function ', start + 1);
const context = vm.createContext({ TaskFormat, SorterIcons: { render: () => '<svg></svg>' } });
vm.runInContext(page.slice(start, end), context);
const raw = '2026-01-31 Задача @дом #review due:2027-01-01';
const task = TaskFormat.parseTaskLine(raw);
assert.match(context.renderTaskCreation(task, 17, true), /openProcess\(17\)/);
assert.match(context.renderTaskCreation(task, 17, true), /aria-label="Разобрать старую задачу"/);
assert.equal((context.renderTaskCreation(task, 17, true).match(/Создано/g) || []).length, 1);
assert.doesNotMatch(context.renderTaskCreation(task, 17, false), /<button/);
assert.equal(context.renderTaskCreation(TaskFormat.parseTaskLine('Без даты'), 17, true), '');
assert.equal(task.raw, raw);
assert.match(page, /TaskAge\.isOldTask\(t, \{ months: oldTaskMonths \}\)/);
const html = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
assert.match(html, /id="old-task-months" min="1" step="1" required/);
assert.ok(html.indexOf('task-age.js') < html.indexOf('tasks-page.js'));

let renders = 0, reports = 0;
const input = { value: '12', checkValidity: () => TaskAge.validMonths(input.value), reportValidity: () => { reports++; } };
const preferenceUi = vm.createContext({
  oldTaskMonths: 2, oldTaskInput: input, oldTaskNotice: { textContent: '' },
  TaskAge: { setMonths: value => TaskAge.setMonths(value, storage) },
  window: { dateFns }, render: () => { renders++; },
});
const changeStart = page.indexOf('    function changeOldTaskMonths(');
const changeEnd = page.indexOf('\n    oldTaskInput.addEventListener', changeStart);
vm.runInContext(page.slice(changeStart, changeEnd), preferenceUi);
preferenceUi.changeOldTaskMonths({ type: 'input' });
assert.equal(preferenceUi.oldTaskMonths, 12);
assert.equal(TaskAge.getMonths(storage), 12);
assert.equal(renders, 1);
preferenceUi.changeOldTaskMonths({ type: 'change' });
assert.equal(renders, 1, 'Blur does not rerender an already applied value');
input.value = '0';
preferenceUi.changeOldTaskMonths({ type: 'input' });
assert.equal(reports, 0, 'Intermediate typing does not interrupt the user');
preferenceUi.changeOldTaskMonths({ type: 'change' });
assert.equal(reports, 1);
assert.equal(TaskAge.getMonths(storage), 12);
assert.equal(preferenceUi.oldTaskMonths, 12);

const isolatedEntries = new Map([['old_task_months', '6'], ['tasks', 'Нормальный список']]);
const runtimeContext = vm.createContext({ URL, URLSearchParams, window: {
  location: { hostname: '127.0.0.1', search: '?mode=developer', href: 'http://127.0.0.1:4173/?mode=developer' },
  localStorage: {
    getItem: key => isolatedEntries.get(key) ?? null,
    setItem: (key, value) => isolatedEntries.set(key, String(value)),
    removeItem: key => isolatedEntries.delete(key),
  },
  document: { documentElement: { dataset: {} }, addEventListener() {} },
} });
vm.runInContext(fs.readFileSync('sorter 2025/runtime-mode.js', 'utf8'), runtimeContext);
const runtime = runtimeContext.window.SorterRuntime;
assert.equal(TaskAge.getMonths(runtime), 2);
TaskAge.setMonths(3, runtime);
assert.equal(isolatedEntries.get('sorter_dev_old_task_months'), '3');
assert.equal(isolatedEntries.get('old_task_months'), '6');
assert.equal(isolatedEntries.get('tasks'), 'Нормальный список');
console.log(`PASS task age, month boundaries, local preference, unknown dates and GTD control (${global.dateFns ? 'real date-fns' : 'offline fixtures'})`);
