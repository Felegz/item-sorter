const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sorter 2025/markers.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(`${source}\nthis.__formatTaskList = formatTaskList;`, context);
const formatTaskList = context.__formatTaskList;

assert.equal(
  formatTaskList(['First task', 'Second task']),
  'First task\n\nSecond task'
);

assert.equal(
  formatTaskList([
    'SORTED (2026.09.05)',
    'First task',
    'Second task',
    'PARTIALLY SORTED (2026.09.05)',
    'Third task'
  ]),
  [
    'SORTED (2026.09.05)',
    'First task',
    '',
    'Second task',
    '',
    'PARTIALLY SORTED (2026.09.05)',
    'Third task'
  ].join('\n')
);

assert.equal(
  formatTaskList('\nFirst task\n\n\nSecond task\n'),
  'First task\n\nSecond task'
);

assert.equal(formatTaskList([]), '');

assert.equal(
  formatTaskList(['ranked', 'NEW ARRAY', 'new ranked']),
  'ranked\n\nINBOX SORTED\nnew ranked'
);

console.log('formatTaskList contract: passed');
