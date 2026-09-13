const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = new Map();
const classes = new Set();
const mediaListeners = new Map();
const mobileViewport = {
  matches: true,
  addEventListener(type, callback) {
    if (!mediaListeners.has(type)) mediaListeners.set(type, []);
    mediaListeners.get(type).push(callback);
  },
};
let scrollIntoViewCalls = 0;
const shell = {
  isConnected: true,
  contains(target) { return target === editor || target === saveButton; },
  scrollIntoView() { scrollIntoViewCalls += 1; },
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
  window: {
    innerHeight: 844,
    innerWidth: 390,
    visualViewport: null,
    matchMedia() { return mobileViewport; },
  },
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
  assert.equal(scrollIntoViewCalls, 1, 'mobile focus keeps the editor visible');

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

  mobileViewport.matches = false;
  document.activeElement = editor;
  dispatch('focusin', editor);
  assert.equal(
    classes.has('mobile-editor-active'),
    false,
    'desktop focus must not activate the compact editor layout',
  );
  assert.equal(
    scrollIntoViewCalls,
    1,
    'desktop focus must not scroll the page',
  );

  const tasksHtml = fs.readFileSync('sorter 2025/tasks.html', 'utf8');
  assert.match(tasksHtml, /function keepTaskVisibleAfterEdit\(idx\)/);
  assert.match(tasksHtml, /keepTaskVisibleAfterEdit\(idx\);/);

  console.log('mobile edit return contract: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
