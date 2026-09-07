const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ console });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js']) {
  vm.runInContext(fs.readFileSync(`sorter 2025/${file}`, 'utf8'), context, { filename: file });
}
const operations = context.TaskListOperations;

(async function run() {
  assert.equal(
    operations.prepareNewTask('(B) Позвонить @телефон due:2026-09-12', { today: '2026-09-07' }),
    '(B) 2026-09-07 Позвонить @телефон due:2026-09-12'
  );
  assert.equal(
    operations.prepareNewTask('2026-09-01 Существующая дата due:2026-09-12', { today: '2026-09-07' }),
    '2026-09-01 Существующая дата due:2026-09-12'
  );
  assert.equal(
    operations.prepareNewTask('Задача #важно', { today: '2026-09-07', dueDate: '2026-09-15' }),
    '2026-09-07 Задача #важно due:2026-09-15'
  );

  const existingMarker = operations.insertTaskIntoInbox([
    'SORTED (2026.09.01)',
    'Старая задача',
  ], 'Новая @дома', { today: '2026-09-07' });
  assert.equal(existingMarker.markerCreated, false);
  assert.equal(existingMarker.text, [
    '2026-09-07 Новая @дома',
    '',
    'SORTED (2026.09.01)',
    'Старая задача',
  ].join('\n'));

  const missingMarker = operations.insertTaskIntoInbox(['Старая первая', 'Старая вторая'], 'Новая', { today: '2026-09-07' });
  assert.equal(missingMarker.markerCreated, true);
  assert.equal(missingMarker.text, [
    '2026-09-07 Новая',
    '',
    'SORTED (2026.09.07)',
    'Старая первая',
    '',
    'Старая вторая',
  ].join('\n'));

  const weight = new Map([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]);
  const compare = (candidate, existing) => weight.get(candidate) - weight.get(existing);
  const placement = await operations.insertTaskByRank(['A', 'C', 'E'], 'D', compare);
  assert.equal(placement.index, 2);
  assert.deepEqual(Array.from(placement.tasks), ['A', 'C', 'D', 'E']);
  assert.ok(placement.comparisons <= 2);

  const ranked = await operations.rankTaskAtIndex([
    'D',
    'B',
    'SORTED (2026.09.01)',
    'A',
    'C',
    'E',
    'PARTIALLY SORTED (2026.09.01)',
    'B',
  ], 0, compare, { today: '2026-09-07' });
  assert.equal(ranked.sortedPosition, 2);
  assert.deepEqual(Array.from(ranked.lines), [
    'B',
    'SORTED (2026.09.01)',
    'A',
    'C',
    'D',
    'E',
    'PARTIALLY SORTED (2026.09.01)',
    'B',
  ]);

  const duplicate = await operations.rankTaskAtIndex([
    'B',
    'B',
    'SORTED (2026.09.01)',
    'A',
    'C',
  ], 1, compare);
  assert.deepEqual(Array.from(duplicate.lines), ['B', 'SORTED (2026.09.01)', 'A', 'B', 'C']);

  console.log('task list operations: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
