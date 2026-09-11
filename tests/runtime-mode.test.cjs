const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(projectRoot, 'sorter 2025', 'runtime-mode.js'), 'utf8');
const dropboxSource = fs.readFileSync(path.join(projectRoot, 'sorter 2025', 'dropbox.js'), 'utf8');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    api: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
  };
}

function createRuntime(urlString, initialStorage = {}) {
  const url = new URL(urlString);
  const storage = createStorage(initialStorage);
  const domCallbacks = [];
  const document = {
    documentElement: { dataset: {} },
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') domCallbacks.push(callback);
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const contextObject = {
    URL,
    URLSearchParams,
    console,
    document,
    localStorage: storage.api,
    location: {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    },
  };
  contextObject.window = contextObject;
  const context = vm.createContext(contextObject);
  vm.runInContext(runtimeSource, context, { filename: 'runtime-mode.js' });
  return { context, runtime: context.SorterRuntime, storage: storage.values, domCallbacks };
}

(async function run() {
  const normal = createRuntime('http://127.0.0.1:4173/', { tasks: 'Рабочий список' });
  assert.equal(normal.runtime.isDeveloperMode, false);
  assert.equal(normal.runtime.storageKey('tasks'), 'tasks');
  assert.equal(normal.runtime.getTasks(), 'Рабочий список');
  assert.equal(normal.storage.has('sorter_dev_tasks'), false);

  const developer = createRuntime('http://127.0.0.1:4173/?mode=developer', {
    tasks: 'Рабочий список',
    dbx_access_token: 'real-token-must-stay-unreachable',
  });
  assert.equal(developer.runtime.isDeveloperMode, true);
  assert.equal(developer.runtime.storageKey('tasks'), 'sorter_dev_tasks');
  assert.equal(developer.storage.get('tasks'), 'Рабочий список');
  assert.equal(developer.runtime.getTasks(), developer.runtime.defaultDeveloperTasks.join('\n\n'));
  assert.equal(developer.runtime.defaultDeveloperTasks.length, 10);
  assert.equal(developer.runtime.withMode('/tasks'), '/tasks.html?mode=developer');
  assert.equal(
    developer.runtime.withMode('/process?task=one'),
    '/process.html?task=one&mode=developer',
  );
  assert.equal(
    developer.runtime.withMode('https://example.com/tasks'),
    'https://example.com/tasks',
  );

  const production = createRuntime('https://item-sorter.pages.dev/?mode=developer', {
    tasks: 'Production tasks',
  });
  assert.equal(production.runtime.isDeveloperMode, false);
  assert.equal(production.runtime.getTasks(), 'Production tasks');
  assert.equal(production.storage.has('sorter_dev_tasks'), false);

  let fetchCalls = 0;
  developer.context.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Dropbox must not be called in developer mode');
  };
  developer.context.Swal = { fire() {} };
  vm.runInContext(
    `${dropboxSource}\n;globalThis.__dropboxGuard = { getToken, dropboxLogin };`,
    developer.context,
    { filename: 'dropbox.js' },
  );
  assert.equal(developer.context.__dropboxGuard.getToken(), null);
  await developer.context.__dropboxGuard.dropboxLogin();
  assert.equal(fetchCalls, 0);
  assert.equal(developer.storage.get('dbx_access_token'), 'real-token-must-stay-unreachable');

  console.log('runtime mode isolation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
