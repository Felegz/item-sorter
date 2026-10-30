const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(projectRoot, 'sorter 2025', 'runtime-mode.js'), 'utf8');
const dropboxSource = fs.readFileSync(path.join(projectRoot, 'sorter 2025', 'dropbox.js'), 'utf8');
const mainSyncCss = fs.readFileSync(path.join(projectRoot, 'sorter 2025', 'style.css'), 'utf8');
const tasksSyncCss = fs.readFileSync(path.join(projectRoot, 'sorter 2025', 'tasks.css'), 'utf8');

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
    developer.runtime.withMode('/tasks/auto'),
    '/tasks.html?mode=developer&auto=1',
  );
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

  const loadParsers = test => {
    for (const file of ['markers.js', 'task-format.js']) {
      vm.runInContext(fs.readFileSync(path.join(projectRoot, 'sorter 2025', file), 'utf8'), test.context);
    }
  };
  loadParsers(developer);
  for (const line of developer.runtime.defaultDeveloperTasks) {
    const task = developer.context.TaskFormat.parseTaskLine(line);
    assert(task.contexts.length && task.projects.length && task.hashtags.length, 'All ten demo tasks exercise every tag family');
  }
  const oldFixture = 'Задача один\r\n\r\nINBOX SORTED\r\nЗадача три\r\n\r\nSORTED (2026.10.21)\r\n'
    + '(B) 2026-01-31 Задача восемь due:2026-11-01 gtd:2026-10-21 ➤совет:Отдохнуть ➤исходное:Старый текст\r\n\r\n'
    + 'Задача один\r\n\r\nPARTIALLY SORTED (2026.10.21)\r\nЗадача два @свой +свой #свой\r\n\r\n'
    + 'IGNORED TASKS (2026.10.21)\r\nx 2026-10-21 2026-01-31 Сделана\r\n\r\n';
  const enriched = createRuntime('http://localhost:4173/?mode=developer', {
    tasks: 'Не менять рабочие задачи', sorter_dev_tasks: oldFixture,
  });
  loadParsers(enriched);
  const updated = enriched.runtime.getTasks();
  assert.equal(enriched.storage.get('tasks'), 'Не менять рабочие задачи');
  assert.equal(enriched.storage.get('sorter_dev_fixture_tags_backup_v1'), oldFixture);
  assert.equal(enriched.storage.get('sorter_dev_fixture_tags_v1'), '1');
  assert.equal(updated.split('\n').length, oldFixture.split('\n').length);
  const beforeLines = oldFixture.split('\n');
  const afterLines = updated.split('\n');
  beforeLines.forEach((line, index) => {
    if (!line.trim() || enriched.context.MARKERS?.isAnyMarker?.(line) || /^(?:INBOX SORTED|SORTED|PARTIALLY SORTED|IGNORED TASKS)/.test(line)) {
      assert.equal(afterLines[index], line, 'Keep markers and blank separators exactly');
      return;
    }
    const before = enriched.context.TaskFormat.parseTaskLine(line);
    const after = enriched.context.TaskFormat.parseTaskLine(afterLines[index]);
    for (const key of ['text', 'completed', 'completionDate', 'creationDate', 'priority', 'dueDate', 'goal', 'advice', 'source']) {
      assert.equal(after[key], before[key], 'Preserve ' + key);
    }
    assert(after.contexts.length && after.projects.length && after.hashtags.length);
    if (before.contexts.length) assert.deepEqual(after.contexts, before.contexts);
    if (before.projects.length) assert.deepEqual(after.projects, before.projects);
    if (before.hashtags.length) assert.deepEqual(after.hashtags, before.hashtags);
    assert(afterLines[index].endsWith('\r'), 'Keep CRLF separators');
  });
  assert.equal(enriched.runtime.getTasks(), updated, 'One-time migration is idempotent');
  enriched.runtime.setTasks('Новая developer-задача без тегов');
  assert.equal(enriched.runtime.getTasks(), 'Новая developer-задача без тегов', 'Do not silently tag later user input');
  assert.equal(enriched.storage.get('sorter_dev_fixture_tags_backup_v1'), oldFixture);
  for (const test of [normal, production]) {
    loadParsers(test);
    const original = test.storage.get('tasks');
    assert.equal(test.runtime.getTasks(), original);
    assert(!test.storage.has('sorter_dev_fixture_tags_v1'));
    assert(!test.storage.has('fixture_tags_v1'));
  }

  let fetchCalls = 0;
  developer.context.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Dropbox must not be called in developer mode');
  };
  developer.context.Swal = { fire() {} };
  vm.runInContext(
    `${dropboxSource}\n;globalThis.__dropboxGuard = { getToken, dropboxLogin, getCompactSyncAge };`,
    developer.context,
    { filename: 'dropbox.js' },
  );
  assert.equal(developer.context.__dropboxGuard.getToken(), null);
  await developer.context.__dropboxGuard.dropboxLogin();
  assert.equal(fetchCalls, 0);
  assert.equal(developer.storage.get('dbx_access_token'), 'real-token-must-stay-unreachable');

  const syncAge = developer.context.__dropboxGuard.getCompactSyncAge;
  const now = Date.UTC(2026, 9, 4, 12, 0, 0);
  const recent = syncAge(now - 29 * 60_000, now);
  assert.equal(recent.state, 'ok');
  assert.equal(recent.label, '✓ Sync · 29 min ago');
  const stale = syncAge(now - 30 * 60_000, now);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.label, '! Sync · 30 min ago');
  for (const css of [mainSyncCss, tasksSyncCss]) {
    assert.match(css, /\.sync-badge\[data-state="stale"\]\s*\{[^}]*248, 113, 113/s);
    assert.doesNotMatch(css, /\.sync-badge\[data-state="stale"\]\s*,/);
  }

  console.log('runtime mode isolation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
