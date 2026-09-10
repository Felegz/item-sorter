const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sorter 2025/markers.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(
  `${source}\n` +
  `this.__model = { TASK_LIST_NAMES, createTaskLists, MARKERS, parseTaskDocument, serializeTaskDocument };`,
  context,
);

const {
  TASK_LIST_NAMES,
  createTaskLists,
  MARKERS,
  parseTaskDocument,
  serializeTaskDocument,
} = context.__model;

assert.deepEqual(
  Array.from(TASK_LIST_NAMES),
  ['inboxUnsorted', 'inboxSorted', 'sorted', 'partiallySorted', 'ignored'],
);
assert.deepEqual(
  Object.keys(createTaskLists()),
  ['inboxUnsorted', 'inboxSorted', 'sorted', 'partiallySorted', 'ignored'],
);

assert.equal(MARKERS.getListName('NEW ARRAY'), 'inboxSorted');
assert.equal(MARKERS.getListName('SORTED (2026.09.05)'), 'sorted');
assert.equal(MARKERS.getListName('PARTIALLY SORTED (2026.09.05)'), 'partiallySorted');
assert.equal(MARKERS.getListName('НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ'), 'inboxUnsorted');
assert.equal(MARKERS.getListName('ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05'), 'ignored');
assert.equal(MARKERS.getListName('ordinary task'), null);
assert.equal(MARKERS.isSortedEnd('NEW ARRAY'), true);
assert.equal(MARKERS.isSortedEnd('PARTIALLY SORTED (2026.09.05)'), true);
assert.equal(MARKERS.getDate('SORTED (2026.09.05)'), '2026-09-05');
assert.equal(MARKERS.getDate('PARTIALLY SORTED (2025.12.31)'), '2025-12-31');
assert.equal(MARKERS.getDate('ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.01.02'), '2026-01-02');
assert.equal(MARKERS.getDate('NEW ARRAY'), null);

const documentText = [
  'raw one',
  'x 2026-09-05 completed raw task',
  'SORTED (2026.09.05)',
  'sorted one',
  'NEW ARRAY',
  'new sorted one',
  'PARTIALLY SORTED (2026.09.05)',
  'partial one',
  'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05',
  'ignored one',
].join('\n');
const lists = parseTaskDocument(documentText);
assert.deepEqual(Array.from(lists.inboxUnsorted), ['raw one', 'x 2026-09-05 completed raw task']);
assert.deepEqual(Array.from(lists.sorted), ['sorted one']);
assert.deepEqual(Array.from(lists.inboxSorted), ['new sorted one']);
assert.deepEqual(Array.from(lists.partiallySorted), ['partial one']);
assert.deepEqual(Array.from(lists.ignored), ['ignored one']);

const legacy = parseTaskDocument([
  'old sorted',
  'NEW ARRAY',
  'new sorted',
  'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
  'raw one',
  'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05',
  'ignored one',
]);
assert.equal(legacy.legacyMergeLayout, true);
assert.deepEqual(Array.from(legacy.sorted), ['old sorted']);
assert.deepEqual(Array.from(legacy.inboxSorted), ['new sorted']);
assert.deepEqual(Array.from(legacy.inboxUnsorted), ['raw one']);
assert.deepEqual(Array.from(legacy.ignored), ['ignored one']);

const roundTrip = serializeTaskDocument(lists, { today: '2026-09-09' });
const reparsed = parseTaskDocument(roundTrip);
for (const name of TASK_LIST_NAMES) {
  assert.deepEqual(Array.from(reparsed[name]), Array.from(lists[name]));
}

const noMarkers = parseTaskDocument('first\n\nx 2026-09-05 done\nsecond');
assert.deepEqual(Array.from(noMarkers.inboxUnsorted), ['first', 'x 2026-09-05 done', 'second']);
assert.deepEqual(Array.from(noMarkers.sorted), []);

console.log('task list model contract: passed');
