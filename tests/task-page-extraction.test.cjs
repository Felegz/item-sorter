const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
const source = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
// Exact migration was verified at f10bc74. Intentional later controller edits
// have behavioral tests; retain this test for syntax and loading contracts.
new vm.Script(source, { filename: 'tasks-page.js' });

// Keep a classic blocking script: later inline Dropbox code and onclick
// handlers depend on the same global functions and lexical state as before.
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const controller = scripts.findIndex(match => /src="tasks-page\.js\?/.test(match[1]));
assert.ok(controller > 0);
assert.equal(scripts[controller][1], ' src="tasks-page.js?v=20261006-completion"');
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
console.log('PASS controller syntax, classic global scope and script order');
