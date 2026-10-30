const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const c = vm.createContext({ console });
for (const name of ['markers.js', 'task-format.js', 'task-order-audit.js']) {
  vm.runInContext(fs.readFileSync('sorter 2025/' + name, 'utf8'), c, { filename: name });
}
const { proposeReorder } = c.TaskOrderAudit;
const plain = value => JSON.parse(JSON.stringify(value));
const pair = (left, right, leftPosition, rightPosition, choice) => ({
  pair: { left: { line: left, position: leftPosition }, right: { line: right, position: rightPosition } },
  choice,
});

// Synthetic sample only. The real list and cloud are never opened or written.
const sample = [
  'Новая @дом', '', 'INBOX SORTED', 'Партия', '', 'SORTED (2026.10.21)',
  'А @дом', '', 'Б +дела', '', 'В #проверка', '', 'Г @ноут', '',
  'PARTIALLY SORTED (2026.10.21)', 'Частичная', '',
  'IGNORED TASKS (2026.10.20)', 'Игнорируемая',
].join('\n');
const proposed = plain(proposeReorder(sample, [pair('А @дом', 'В #проверка', 1, 3, 'right')]));
assert.equal(proposed.changed, true);
assert.equal(proposed.moves, 3);
assert.deepEqual(proposed.ordered, ['Б +дела', 'В #проверка', 'А @дом', 'Г @ноут']);
assert.equal(proposed.text, sample.replace('А @дом\n\nБ +дела\n\nВ #проверка', 'Б +дела\n\nВ #проверка\n\nА @дом'));
for (const section of ['Новая @дом', 'INBOX SORTED', 'Партия', 'PARTIALLY SORTED', 'Частичная', 'IGNORED TASKS', 'Игнорируемая']) {
  assert(proposed.text.includes(section));
}
assert.deepEqual(sample.split('\n').sort(), proposed.text.split('\n').sort(), 'Every raw line and blank separator survives');
assert.equal(proposeReorder(sample, [pair('А @дом', 'Б +дела', 1, 2, 'left')]).changed, false);
assert.equal(proposeReorder(sample, [pair('А @дом', 'Б +дела', 1, 2, 'uncertain')]).changed, false);
const compatible = proposeReorder(sample, [
  pair('А @дом', 'Б +дела', 1, 2, 'left'),
  pair('А @дом', 'В #проверка', 1, 3, 'right'),
]);
assert.deepEqual(plain(compatible.ordered), ['В #проверка', 'А @дом', 'Б +дела', 'Г @ноут']);

const duplicate = 'SORTED (2026.10.21)\r\nТа же задача\r\n\r\nx 2026-10-21 Сделано\r\n\r\nТа же задача\r\n\r\nДругая\r\n\r\nIGNORED TASKS (2026.10.20)\r\nПервая\r\n\r\nIGNORED TASKS (2026.09.20)\r\nВторая';
const duplicatesResult = proposeReorder(duplicate, [pair('Та же задача', 'Другая', 3, 4, 'right')]);
assert.equal(duplicatesResult.text.match(/Та же задача/g).length, 2);
assert.equal(duplicatesResult.text.match(/IGNORED TASKS/g).length, 2);
assert.equal(duplicatesResult.text.match(/x 2026-10-21 Сделано/g).length, 1);
assert.deepEqual(duplicate.split(/\r\n/).sort(), duplicatesResult.text.split(/\r\n/).sort());
assert(!/(?<!\r)\n/.test(duplicatesResult.text), 'CRLF separators are retained');
assert.deepEqual(plain(duplicatesResult.ordered), ['Та же задача', 'Другая', 'Та же задача']);

const cycle = [
  pair('А @дом', 'Б +дела', 1, 2, 'left'),
  pair('Б +дела', 'В #проверка', 2, 3, 'left'),
  pair('А @дом', 'В #проверка', 1, 3, 'right'),
];
assert.throws(() => proposeReorder(sample, cycle), /противоречат/);
assert.throws(() => proposeReorder(sample, [pair('Другая', 'В #проверка', 1, 3, 'right')]), /изменился/);
assert.throws(() => proposeReorder(sample, [pair('А @дом', 'В #проверка', 1, 3, 'invalid')]), /Неизвестный/);
assert.throws(() => proposeReorder('Нет блока SORTED', []), /один основной блок/);
console.log('PASS sample reorder: voted constraints, stable unvoted order, completed/duplicate slots, two ignored blocks, CRLF, no loss, cycles and stale answers');
