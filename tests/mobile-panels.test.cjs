const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
const css = fs.readFileSync('sorter 2025/tasks.css', 'utf8');

const searchInput = html.match(/<input id="search"[^>]*>/)?.[0] || '';
assert.ok(searchInput, 'tasks.html must contain the task search input');
assert.match(searchInput, /data-mobile-editor(?:\s|>)/);
assert.match(searchInput, /data-mobile-editor-layout="search"/);
assert.match(html, /class="search-close"[^>]*data-mobile-close/);

assert.match(css, /data-mobile-editor-layout="search"/);
assert.match(css, /body\[data-mobile-panel="tools"\] \.task-add-fab\s*{[^}]*display:\s*none/s);
assert.doesNotMatch(css, /var\(--bg-elevated\)|var\(--border-hover\)/);

console.log('mobile panel contract: passed');
