const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let hydrate;
const slot = { dataset: { sorterIcon: 'minimize-2' } };
const context = vm.createContext({
  window: {},
  document: {
    addEventListener(event, fn) { if (event === 'DOMContentLoaded') hydrate = fn; },
    querySelectorAll() { return [slot]; },
  },
});
vm.runInContext(fs.readFileSync('sorter 2025/icons.js', 'utf8'), context);
for (const name of ['minimize-2','pencil','list-filter','sparkles','arrow-up-down','bot','calendar-days','moon','check','undo-2','eye-off','eye','copy','trash']) {
  const svg = context.window.SorterIcons.render(name);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.doesNotMatch(svg, /<script|https?:|onload=/);
}
assert.throws(() => context.window.SorterIcons.render('__proto__'));
hydrate();
assert.match(slot.innerHTML, /class="lucide-icon"/);
for (const page of ['index.html', 'tasks.html', 'process.html']) {
  const html = page === 'tasks.html'
    ? require('./helpers/task-page-source.cjs')()
    : fs.readFileSync('sorter 2025/' + page, 'utf8');
  assert.match(html, /src="icons\.js/);
  assert.match(html, /data-mobile-editor-collapse aria-label="Свернуть редактор"/);
  assert.doesNotMatch(html, /data-mobile-editor-collapse[^>]*>Свернуть</);
}
const main = fs.readFileSync('sorter 2025/index.html', 'utf8');
assert.match(main, /class="editor-surface" data-mobile-editor-shell/);
assert.match(main, /class="question-panel" data-mobile-editor-shell/);
const gtd = fs.readFileSync('sorter 2025/process.html', 'utf8');
assert.equal((gtd.match(/data-sorter-icon="minimize-2"/g) || []).length, 2, 'Initial and output GTD editors have collapse icons');
assert.match(gtd, /if \(step\.type === 'text'\).*data-mobile-editor-collapse.*SorterIcons\.render\('minimize-2'\)/, 'Generated text steps use the same control');
assert.doesNotMatch(gtd, /onclick="[^\"]*"[^>]*data-mobile-editor-collapse/, 'The shared handler owns collapsing, not the GTD controller');
const taskPage = require('./helpers/task-page-source.cjs')();
assert.match(taskPage, /openTaskSnooze\(\$\{idx\}\).*SorterIcons\.render\('moon'\)/);
assert.match(taskPage, /openTaskDueDate\(\$\{idx\}\)">\s*\$\{SorterIcons\.render\('calendar-days'\)/, 'Due date keeps the calendar icon');
assert.match(taskPage, /openProcess\(\$\{idx\}\).*SorterIcons\.render\('sparkles'\)/);
assert.match(gtd, /data-sorter-icon="sparkles"/);
console.log('PASS local Lucide icons, static hydration and accessible collapse controls');
