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
// Focused search constrains the list to the area above the keyboard. Its flex
// children must scroll at their natural heights instead of shrinking to fit.
// This source contract complements the browser overlap/scroll measurements.
const searchStyles = css.slice(css.lastIndexOf('@media (max-width: 760px)'));
assert.ok(
  /body\.mobile-editor-active\[data-mobile-editor-layout="search"\] \.tasks-app main\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/.test(searchStyles),
  'mobile search column must fit the viewport even with long task content',
);
assert.ok(
  /body\.mobile-editor-active\[data-mobile-editor-layout="search"\] #list > \*\s*{\s*flex-shrink:\s*0;\s*}/.test(searchStyles),
  'mobile search must prevent shrinking of every list child, including section headers',
);
assert.match(css, /body\[data-mobile-panel="tools"\] \.task-add-fab\s*{[^}]*display:\s*none/s);
assert.doesNotMatch(css, /var\(--bg-elevated\)|var\(--border-hover\)/);

console.log('mobile panel contract: passed');
