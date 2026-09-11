const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = new Map();
const classes = new Set();
const shell = {
  isConnected: true,
  contains(target) { return target === editor || target === saveButton; },
  scrollIntoView() {},
};
const editor = {
  dataset: { mobileEditorLayout: 'task' },
  classList: { add() {}, remove() {} },
  closest(selector) {
    if (selector === '[data-mobile-editor]') return this;
    if (selector === '[data-mobile-editor-shell]') return shell;
    return null;
  },
};
const saveButton = { closest() { return null; } };
const outside = { closest() { return null; } };

const document = {
  activeElement: editor,
  body: {
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
    },
    dataset: {},
  },
  documentElement: {
    style: { setProperty() {}, removeProperty() {} },
  },
  addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  },
  querySelectorAll() { return []; },
};

function dispatch(type, target) {
  for (const listener of listeners.get(type) || []) listener({ target });
}

const context = vm.createContext({
  document,
  window: { innerHeight: 844, visualViewport: null },
  requestAnimationFrame(callback) { callback(); },
  queueMicrotask,
  setTimeout,
});
vm.runInContext(
  fs.readFileSync('sorter 2025/mobile-edit-mode.js', 'utf8'),
  context,
  { filename: 'mobile-edit-mode.js' },
);

(async function run() {
  dispatch('focusin', editor);
  assert.equal(classes.has('mobile-editor-active'), true);

  dispatch('pointerdown', saveButton);
  document.activeElement = outside;
  dispatch('focusout', editor);
  await Promise.resolve();
  assert.equal(
    classes.has('mobile-editor-active'),
    true,
    'focusout before click must not move the tapped Save button',
  );

  dispatch('click', saveButton);
  await Promise.resolve();
  assert.equal(
    classes.has('mobile-editor-active'),
    false,
    'the mobile editor layout must close after the Save click is dispatched',
  );

  const tasksHtml = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
  assert.match(tasksHtml, /function keepTaskVisibleAfterEdit\(idx\)/);
  assert.match(tasksHtml, /keepTaskVisibleAfterEdit\(idx\);/);

  console.log('mobile edit return contract: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
