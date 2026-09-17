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
for (const name of ['minimize-2','pencil','list-filter','arrow-up-down','bot','check','undo-2','eye-off','eye','copy','trash']) {
  const svg = context.window.SorterIcons.render(name);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.doesNotMatch(svg, /<script|https?:|onload=/);
}
assert.throws(() => context.window.SorterIcons.render('__proto__'));
hydrate();
assert.match(slot.innerHTML, /class="lucide-icon"/);
for (const page of ['index.html', 'tasks.html']) {
  const html = fs.readFileSync('sorter 2025/' + page, 'utf8');
  assert.match(html, /src="icons\.js/);
  assert.match(html, /data-mobile-editor-collapse aria-label="Свернуть редактор"/);
  assert.doesNotMatch(html, /data-mobile-editor-collapse[^>]*>Свернуть</);
}
const main = fs.readFileSync('sorter 2025/index.html', 'utf8');
assert.match(main, /class="editor-surface" data-mobile-editor-shell/);
assert.match(main, /class="question-panel" data-mobile-editor-shell/);
console.log('PASS local Lucide icons, static hydration and accessible collapse controls');
