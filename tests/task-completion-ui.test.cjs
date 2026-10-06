const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = require('./helpers/task-page-source.cjs')();
const start = html.indexOf('    function toggleDone(');
const end = html.indexOf('\n    function ', start + 1);
assert.ok(start >= 0 && end > start, 'the actual page handler must be tested');
const fixedInstant = '2026-10-05T23:30:00-07:00';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedInstant])); }
}
const context = vm.createContext({ console, Date: FixedDate });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js']) {
  vm.runInContext(fs.readFileSync(`sorter 2025/${file}`, 'utf8'), context, { filename: file });
}
let savedText;
let saves = 0;
let renders = 0;
context.parseLine = raw => ({
  ...context.TaskFormat.parseTaskLine(raw),
  complete: context.TaskFormat.parseTaskLine(raw).completed,
  _raw: raw,
});
context.saveItems = () => {
  savedText = context.formatTaskList(context.items.map(t => t._raw));
  saves += 1;
};
context.render = () => { renders += 1; };
vm.runInContext(html.slice(start, end), context);

const original = '(B) 2026-09-01 Проверка @дом +проект #tag due:2026-11-12 ➤совет:Отдохнуть ⟦исх.: Исходная задача⟧';
const sourceLines = [
  original,
  'INBOX SORTED',
  original,
  'SORTED (2026.09.13)',
  'x 2026-09-04 2026-09-01 Сохранить завершённую',
  'PARTIALLY SORTED (2026.09.12)',
  'Не изменять частичную сортировку',
  'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
  'Сохранить хвост',
  'IGNORED TASKS (2026.09.11)',
  original,
];
const expectedDate = '2026-10-06'; // UTC day, not the local date in the timestamp.

for (const target of [0, 2, 10]) {
  context.items = sourceLines.map(raw => ({ ...context.parseLine(raw), _ignored: false }));
  context.items[10]._ignored = true;
  const beforeSaves = saves;
  context.toggleDone(target);
  const expected = sourceLines.slice();
  expected[target] = `x ${expectedDate} ${original}`;
  assert.equal(savedText, context.formatTaskList(expected));
  assert.equal(context.items[target]._ignored, target === 10);
  assert.equal(context.items[target].complete, true);
  assert.equal(context.items[target].creationDate, '2026-09-01');
  assert.equal(context.items[target].completionDate, expectedDate);
  assert.equal(context.items[target].dueDate, '2026-11-12');
  assert.equal(context.items.length, sourceLines.length);
  assert.equal(saves, beforeSaves + 1);
  context.toggleDone(target);
  assert.equal(savedText, context.formatTaskList(sourceLines));
}

// Lock unusual old undo results too. This stage must not quietly fix them.
for (const [raw, expected] of [
  ['x Без даты @дом', 'Без даты @дом'],
  ['X 2026-09-01 Верхний регистр', 'X 2026-09-01 Верхний регистр'],
  ['x 2026-09-01', '2026-09-01'],
]) {
  context.items = [context.parseLine(raw)];
  context.toggleDone(0);
  assert.equal(context.items[0]._raw, expected);
}
assert.equal(renders, saves);
assert.match(html, /onchange="toggleDone\(\$\{idx\}\)"/);
assert.match(html, /<button onclick="toggleDone\(\$\{idx\}\)">/);
console.log('PASS completion handler: legacy UTC date, metadata, duplicate occurrences, sections and undo');
