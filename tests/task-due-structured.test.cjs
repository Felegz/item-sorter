const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ console });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js']) {
  vm.runInContext(fs.readFileSync(`sorter 2025/${file}`, 'utf8'), context);
}
const { TaskFormat: format, TaskListOperations: operations } = context;

// A date appended after a GTD marker belongs to that field, not to the task.
// Check the parsed value and field contents, not just the presence of due:.
const main = '(B) 2026-09-01 Проверка @телефон #test';
for (const suffix of [
  ' ➤цель:Готово ➤сложность:сложно ➤совет:Начать ➤исходное:Оригинал',
  ' ➤совет:Начать',
  ' ➤ исх.:Оригинал',
  ' ⟦исх.: Оригинал⟧',
  ' ➤совет:Начать ⟦исх.: Оригинал⟧',
  ' ➤исходное:Оригинал due:2026-09-20',
  ' ➤совет:Проверить due:2026-09-20 ⟦исх.: Оригинал due:2026-08-01⟧',
]) {
  const original = main + suffix;
  const before = format.parseTaskLine(original);
  let updated = operations.setTaskDueDate(original, '2026-10-24');
  assert.equal(updated, main + ' due:2026-10-24' + suffix);
  assert.equal(format.parseTaskLine(updated).dueDate, '2026-10-24');
  updated = operations.setTaskDueDate(updated, '2026-11-02');
  assert.equal(format.parseTaskLine(updated).dueDate, '2026-11-02');
  for (const key of ['creationDate', 'priority', 'text', 'goal', 'difficulty', 'advice', 'source']) {
    assert.equal(format.parseTaskLine(updated)[key], before[key], key);
  }
  assert.equal(operations.setTaskDueDate(updated, ''), original);
}
const withUrl = 'Проверка https://example.test/?due:2026-09-01';
assert.equal(operations.setTaskDueDate(withUrl, '2026-10-24'), withUrl + ' due:2026-10-24');
const legacyTail = main + ' ⟦исх.: Оригинал due:2026-08-01⟧ due:2026-09-20';
const replacedTail = operations.setTaskDueDate(legacyTail, '2026-10-24');
assert.equal(format.parseTaskLine(replacedTail).dueDate, '2026-10-24');
assert.equal(format.parseTaskLine(replacedTail).source, 'Оригинал due:2026-08-01');
console.log('PASS due dates before GTD/source fields, replacement, clearing and preserved text');

const page = require('./helpers/task-page-source.cjs')();
function extract(name) {
  const start = page.indexOf(`    ${name === 'openTaskDueDate' ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0);
  const end = page.indexOf('\n    function ', start + 1);
  return page.slice(start, end);
}
(async () => {
  const raw = main + ' ➤совет:Начать ➤исходное:Оригинал';
  const state = vm.createContext({
    TaskListOperations: operations,
    document: { querySelectorAll: () => [] },
    parseLine(value) { return { _raw: value, _due: format.parseTaskLine(value).dueDate }; },
    saveItems() { saves++; }, render() {}, keepTaskVisibleAfterEdit() {},
    Swal: {
      getInput: () => ({ value: selectedDate }),
      showValidationMessage: value => { validation = value; },
      async fire(options) {
        if (typeof options !== 'object') { warnings++; return {}; }
        dialog = options;
        if (replaceWhileOpen) state.items[0] = { _raw: 'Другая задача' };
        if (result.isConfirmed && options.preConfirm() === false) return {};
        return result;
      },
    },
  });
  let saves = 0, warnings = 0, selectedDate = '', validation = '', dialog;
  let result = {}, replaceWhileOpen = false;
  vm.runInContext(extract('openTaskDueDate'), state);
  vm.runInContext(extract('applyTaskDueDate'), state);
  function reset(date = null) {
    const value = date ? operations.setTaskDueDate(raw, date) : raw;
    state.items = [{ _raw: value, _due: date, _ignored: true }, { _raw: value }];
    saves = 0; validation = ''; replaceWhileOpen = false;
  }
  for (const previousDate of [null, '2026-10-20']) {
    reset(previousDate);
    selectedDate = '2026-10-24'; result = { isConfirmed: true, value: selectedDate };
    const duplicate = state.items[1];
    await state.openTaskDueDate(0);
    assert.equal(saves, 1);
    assert.equal(dialog.input, 'date');
    assert.equal(dialog.inputValue, previousDate || '');
    assert.equal(state.items[0]._due, selectedDate);
    assert.equal(state.items[0]._ignored, true);
    assert.equal(state.items[1], duplicate);
  }
  reset('2026-10-20'); result = { isDenied: true };
  await state.openTaskDueDate(0);
  assert.equal(state.items[0]._raw, raw);
  assert.equal(saves, 1);
  for (const date of ['', '2026-02-30']) {
    reset(); selectedDate = date; result = { isConfirmed: true, value: date };
    await state.openTaskDueDate(0);
    assert.equal(saves, 0); assert.ok(validation);
  }
  reset(); result = { isDismissed: true };
  await state.openTaskDueDate(0); assert.equal(saves, 0);
  reset(); selectedDate = '2026-10-24'; result = { isConfirmed: true, value: selectedDate };
  replaceWhileOpen = true;
  await state.openTaskDueDate(0);
  assert.equal(saves, 0); assert.equal(warnings, 1);
  console.log('PASS menu due dialog, validation, cancel, clear, stale index and duplicate preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
