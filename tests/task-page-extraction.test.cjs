const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');

const html = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
const source = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
// This is a one-stage migration check, not a permanent ban on future edits.
// The hash locks the original inline controller before its mechanical move,
// excluding only whitespace after its final statement and using one final LF.
assert.equal(
  crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex'),
  'c0889f992c5d1d85f114c36971fef29f5b3bf644bd7ac1d35e16e13129c879cb',
  'extraction must not change any controller code',
);
new vm.Script(source, { filename: 'tasks-page.js' });

// Keep a classic blocking script: later inline Dropbox code and onclick
// handlers depend on the same global functions and lexical state as before.
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const controller = scripts.findIndex(match => /src="tasks-page\.js\?/.test(match[1]));
assert.ok(controller > 0);
assert.equal(scripts[controller][1], ' src="tasks-page.js?v=20261006-extract"');
assert.equal(scripts[controller][2], '');
assert.match(html.slice(0, scripts[controller].index), /id="list"/);
assert.match(scripts[controller + 1][1], /src="dropbox\.js/);
assert.match(scripts[controller + 2][1], /src="ai-dropbox\.js/);
assert.equal(scripts[controller + 3][1], '');
assert.equal(controller + 4, scripts.length);
const inline = scripts.filter(match => !/\bsrc=/.test(match[1]));
assert.equal(inline.length, 1, 'leave only the existing Dropbox integration inline');
assert.match(inline[0][2], /window\._onDbxLoad\s*=/);
assert.match(inline[0][2], /editingIdx = -1/);
assert.match(inline[0][2], /loadItems\(\)/);
new vm.Script(inline[0][2], { filename: 'tasks-dropbox-inline.js' });
console.log('PASS exact controller extraction, classic global scope and script order');
