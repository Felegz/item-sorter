const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sorter 2025/markers.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(
  `${source}\n` +
  `this.__model = { TASK_LIST_NAMES, createTaskLists, MARKERS, parseMergeTaskLists, parseSortTaskLists };`,
  context
);

const {
  TASK_LIST_NAMES,
  createTaskLists,
  MARKERS,
  parseMergeTaskLists,
  parseSortTaskLists,
} = context.__model;

assert.deepEqual(
  Array.from(TASK_LIST_NAMES),
  ['inboxUnsorted', 'inboxSorted', 'sorted', 'partiallySorted', 'ignored']
);
assert.deepEqual(
  Object.keys(createTaskLists()),
  ['inboxUnsorted', 'inboxSorted', 'sorted', 'partiallySorted', 'ignored']
);

assert.equal(MARKERS.getListName('NEW ARRAY'), 'inboxSorted');
assert.equal(MARKERS.getListName('SORTED (2026.09.05)'), 'sorted');
assert.equal(MARKERS.getListName('PARTIALLY SORTED (2026.09.05)'), 'partiallySorted');
assert.equal(MARKERS.getListName('НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ'), 'inboxUnsorted');
assert.equal(MARKERS.getListName('ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05'), 'ignored');
assert.equal(MARKERS.getListName('ordinary task'), null);

const sortDocument = [
  'raw one',
  'x 2026-09-05 completed raw task',
  'SORTED (2026.09.05)',
  'sorted one',
  'PARTIALLY SORTED (2026.09.05)',
  'partial one',
  'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05',
  'ignored one',
].join('\n');
const sortLists = parseSortTaskLists(sortDocument);
assert.deepEqual(Array.from(sortLists.inboxUnsorted), ['raw one']);
assert.deepEqual(Array.from(sortLists.inboxSorted), []);
assert.deepEqual(Array.from(sortLists.sorted), ['sorted one']);
assert.deepEqual(Array.from(sortLists.partiallySorted), ['partial one']);
assert.deepEqual(Array.from(sortLists.ignored), ['ignored one']);
assert.deepEqual(
  Array.from(sortLists.sourceBlocks.ignored),
  ['ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05', 'ignored one']
);

const mergeDocument = [
  'sorted one',
  'NEW ARRAY',
  'new sorted one',
  'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
  'raw one',
].join('\n');
const mergeLists = parseMergeTaskLists(mergeDocument);
assert.deepEqual(Array.from(mergeLists.sorted), ['sorted one']);
assert.deepEqual(Array.from(mergeLists.inboxSorted), ['new sorted one']);
assert.deepEqual(Array.from(mergeLists.inboxUnsorted), ['raw one']);
assert.deepEqual(Array.from(mergeLists.partiallySorted), []);
assert.deepEqual(Array.from(mergeLists.ignored), []);
assert.deepEqual(
  Array.from(mergeLists.sourceBlocks.inboxUnsorted),
  ['НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ', 'raw one']
);

const noMarkers = parseSortTaskLists('first\n\nx 2026-09-05 done\nsecond');
assert.deepEqual(Array.from(noMarkers.inboxUnsorted), ['first', 'second']);
assert.deepEqual(Array.from(noMarkers.sorted), []);
assert.deepEqual(Array.from(noMarkers.partiallySorted), []);
assert.deepEqual(Array.from(noMarkers.ignored), []);

const noUnsortedBlock = parseMergeTaskLists('old\nNEW ARRAY\nnew');
assert.deepEqual(Array.from(noUnsortedBlock.sorted), ['old']);
assert.deepEqual(Array.from(noUnsortedBlock.inboxSorted), ['new']);
assert.deepEqual(Array.from(noUnsortedBlock.inboxUnsorted), []);
assert.deepEqual(Array.from(noUnsortedBlock.sourceBlocks.inboxUnsorted), []);

const mergeWithIgnored = parseMergeTaskLists([
  'old',
  'NEW ARRAY',
  'new',
  'НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ',
  'raw',
  'ИГНОРИРУЕМЫЕ ЗАДАЧИ 2026.09.05',
  'ignored',
].join('\n'));
assert.deepEqual(Array.from(mergeWithIgnored.inboxUnsorted), ['raw']);
assert.deepEqual(Array.from(mergeWithIgnored.ignored), ['ignored']);

console.log('task list model contract: passed');
