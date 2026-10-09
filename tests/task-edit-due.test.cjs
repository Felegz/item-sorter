const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = require('./helpers/task-page-source.cjs')();
const operationsContext = vm.createContext({ console });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js']) {
  vm.runInContext(fs.readFileSync(`sorter 2025/${file}`, 'utf8'), operationsContext, { filename: file });
}
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf('\n    function ', start + 1);
  return html.slice(start, end);
}
const input = { value: '', focus() { throw Error('Calendar must not refocus textarea'); } };
const picker = {
  value: '', valid: true, reports: 0,
  checkValidity() { return this.valid; },
  reportValidity() { this.reports += 1; },
};
let saved;
let saveCount = 0;
let cancelCount = 0;
const context = vm.createContext({
  document: { getElementById(id) { return id.startsWith('due-pick') ? picker : input; } },
  parseLine(raw) { return { _raw: raw }; },
  saveItems() { saved = context.items[0]._raw; saveCount += 1; },
  render() {}, keepTaskVisibleAfterEdit() {}, cancelEdit() { cancelCount += 1; },
  setTimeout() {},
  updateTagPicker() { context.editingTempValue = input.value; },
  TaskListOperations: operationsContext.TaskListOperations,
  items: [{ _raw: '', _ignored: true }], editingIdx: 0, editingTempValue: null,
});
vm.runInContext(extract('setDueOnEdit'), context);
vm.runInContext(extract('commitEditDraft'), context);
vm.runInContext(extract('saveEdit'), context);
vm.runInContext(extract('editTask'), context);
const original = '(B) 2026-09-01 Проверка @дом #test ⟦исх.: Старый текст⟧';
function expectedOriginalDue(date) {
  return '(B) 2026-09-01 Проверка @дом #test'
    + (date ? ' due:' + date : '') + ' ⟦исх.: Старый текст⟧';
}
for (const oldDate of ['', ' due:2026-09-20']) {
  for (const newDate of ['2026-10-12', '']) {
    input.value = original + oldDate;
    picker.value = newDate;
    context.saveEdit(0);
    assert.equal(saved, expectedOriginalDue(newDate));
    assert.equal(context.items[0]._ignored, true);
    assert.equal(context.editingIdx, -1);
  }
}
input.value = original;
context.setDueOnEdit(0, '2026-11-02');
assert.equal(input.value, expectedOriginalDue('2026-11-02'));

// Characterize switching before refactoring: only the edited occurrence changes,
// the ignored section is retained, and an empty draft is not a deletion.
context.items = [{ _raw: original, _ignored: true }, { _raw: original, _ignored: false }];
context.editingIdx = 0;
input.value = original + ' @телефон +проект';
context.editTask(1);
assert.equal(context.items[0]._raw, input.value);
assert.equal(context.items[0]._ignored, true);
assert.equal(context.items[1]._raw, original);
assert.equal(context.editingIdx, 1);
context.editingIdx = 0;
input.value = '   ';
const beforeEmpty = context.items[0]._raw;
const beforeEmptySaves = saveCount;
context.editTask(1);
assert.equal(context.items[0]._raw, beforeEmpty);
assert.equal(saveCount, beforeEmptySaves);

// No calendar input/change callback: both exit paths must read its live value.
for (const exit of ['save', 'switch']) {
  for (const oldDate of ['', ' due:2026-09-20']) {
    for (const newDate of ['2026-10-12', '']) {
      const originalRaw = original + oldDate;
      context.items = [{ _raw: originalRaw, _ignored: true }, { _raw: originalRaw, _ignored: false }];
      context.editingIdx = 0;
      context.editingTempValue = 'Stale text must not replace the live input';
      input.value = originalRaw + ' @телефон +проект';
      picker.value = newDate;
      if (exit === 'save') context.saveEdit(0);
      else context.editTask(1);
      assert.equal(context.items[0]._raw,
        expectedOriginalDue(newDate) + ' @телефон +проект');
      assert.equal(context.items[0]._ignored, true);
      assert.equal(context.items[1]._raw, originalRaw, 'duplicate occurrence is untouched');
      assert.equal(context.editingIdx, exit === 'save' ? -1 : 1);
      assert.equal(context.editingTempValue, null);
    }
  }
}

// Invalid dates keep the current draft open and never write or switch tasks.
for (const exit of ['save', 'switch']) {
  context.items = [{ _raw: original, _ignored: true }, { _raw: original }];
  context.editingIdx = 0;
  input.value = original + ' #edited';
  picker.valid = false;
  const before = saveCount;
  if (exit === 'save') context.saveEdit(0);
  else context.editTask(1);
  assert.equal(saveCount, before);
  assert.equal(context.items[0]._raw, original);
  assert.equal(context.editingIdx, 0);
}
assert.equal(picker.reports, 2);
picker.valid = true;

// Empty Save closes the editor without throwing, deleting, or inventing due-only tasks.
input.value = '   ';
picker.value = '2026-10-12';
const beforeBlank = saveCount;
context.saveEdit(0);
assert.equal(saveCount, beforeBlank);
assert.equal(context.items[0]._raw, original);
assert.equal(context.editingIdx, -1);

// Preserve the old distinction: switching unchanged text is not another save.
input.value = original;
picker.value = '';
context.editingIdx = 0;
const beforeUnchanged = saveCount;
context.editTask(1);
assert.equal(saveCount, beforeUnchanged);
context.editingIdx = 0;
context.saveEdit(0);
assert.equal(saveCount, beforeUnchanged + 1);
assert.match(html, /currentDue = TaskFormat\.parseTaskLine\(editVal\)\.dueDate/);
assert.match(html, /oninput="setDueOnEdit/);
assert.match(html, /data-mobile-editor-collapse aria-label="Свернуть редактор"/);
assert.match(html, /SorterIcons\.render\('minimize-2'\)/);
assert.match(html, /class="task-due-action"/);
assert.match(html, /onclick="openTaskDueDate\(\$\{idx\}\)"/);
assert.doesNotMatch(html, /class="task-due-action"[^]*?<input type="date"[^]*?<\/label>/);
console.log('PASS unified editor save/switch, due selection/clearing/validation, empty drafts and duplicates');
