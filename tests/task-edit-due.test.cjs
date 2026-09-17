const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf('\n    function ', start + 1);
  return html.slice(start, end);
}
const input = { value: '', focus() { throw Error('Calendar must not refocus textarea'); } };
const picker = { value: '', checkValidity() { return true; } };
let saved;
const context = vm.createContext({
  document: { getElementById(id) { return id.startsWith('due-pick') ? picker : input; } },
  parseLine(raw) { return { _raw: raw }; },
  saveItems() { saved = context.items[0]._raw; },
  render() {}, keepTaskVisibleAfterEdit() {}, cancelEdit() {},
  updateTagPicker() { context.editingTempValue = input.value; },
  items: [{ _raw: '', _ignored: true }], editingIdx: 0, editingTempValue: null,
});
vm.runInContext(extract('setDueOnEdit'), context);
vm.runInContext(extract('saveEdit'), context);
const original = '(B) 2026-09-01 Проверка @дом #test ⟦исх.: Старый текст⟧';
for (const oldDate of ['', ' due:2026-09-20']) {
  for (const newDate of ['2026-10-12', '']) {
    input.value = original + oldDate;
    picker.value = newDate;
    context.saveEdit(0);
    assert.equal(saved, original + (newDate ? ' due:' + newDate : ''));
    assert.equal(context.items[0]._ignored, true);
    assert.equal(context.editingIdx, -1);
  }
}
input.value = original;
context.setDueOnEdit(0, '2026-11-02');
assert.equal(input.value, original + ' due:2026-11-02');
assert.match(html, /currentDue = TaskFormat\.parseTaskLine\(editVal\)\.dueDate/);
assert.match(html, /oninput="setDueOnEdit/);
assert.match(html, /data-mobile-editor-collapse aria-label="Свернуть редактор"/);
assert.match(html, /SorterIcons\.render\('minimize-2'\)/);
console.log('PASS editor due selection, replacement, clearing and preservation');
