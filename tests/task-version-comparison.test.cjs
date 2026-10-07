const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync('sorter 2025/' + name, 'utf8');

function harness() {
  const memory = new Map([['tasks', 'Задача один'], ['dbx_last_tasks', 'Задача ноль'], ['dbx_last_rev', 'old']]);
  const calls = [], dialogs = [], responses = [];
  let choice = {}, onDialog = () => {}, draft = false, refreshes = 0, mergeDecisions = null, cancelAt = '';
  const context = {
    console, URLSearchParams, URL, Date,
    location: { origin: 'http://localhost', search: '', pathname: '/tasks.html' },
    document: { getElementById: () => null, addEventListener() {} },
    addEventListener() {}, removeEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {},
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) },
    SorterRuntime: { getTasks: () => memory.get('tasks'), setTasks: value => memory.set('tasks', value),
      setItem: (key, value) => memory.set(key, value), storageKey: key => key, isDeveloperMode: false },
    SorterUnsavedChanges: { state: () => JSON.stringify([memory.get('tasks'), draft]), hasDraft: () => draft,
      allowReplace: async () => true },
    Swal: { async fire(options, message) {
      dialogs.push(options);
      if (message) dialogs.push({ message });
      if (options.title === 'Сравнение версий') {
        await onDialog();
        return mergeDecisions !== null ? { isConfirmed: true }
          : choice.isConfirmed || choice.isDenied ? { isDenied: true } : {};
      }
      if (options.title === 'Выбрать одну версию') return choice;
      if (options.title === cancelAt) return {};
      if (options.title === 'Что оставить') return { isConfirmed: true, value: options.preConfirm() };
      if (options.title === 'Сохранить общий список?') return { isConfirmed: true };
      return {};
    }, getHtmlContainer: () => ({ querySelectorAll: () => Object.entries(mergeDecisions || {})
      .map(([mergeId, value]) => ({ dataset: { mergeId }, value })) }),
    showValidationMessage: message => { throw new Error(message); } },
    async fetch(url, options) {
      const args = JSON.parse(options.headers['Dropbox-API-Arg'] || options.body || '{}');
      calls.push({ url, args, body: options.body });
      const next = responses.shift();
      assert(next, 'unexpected request ' + url);
      if (next instanceof Error) throw next;
      if (next.run) next.run();
      return { ok: next.status === 200, status: next.status,
        text: async () => next.text || '', json: async () => next.json || {},
        headers: { get: () => JSON.stringify(next.meta || {}) } };
    },
  };
  context.window = context;
  vm.createContext(context);
  for (const name of ['markers.js', 'task-format.js', 'task-version-comparison.js', 'dropbox.js']) vm.runInContext(read(name), context);
  context.getToken = () => 'synthetic-token';
  context.tryRefreshToken = async () => { refreshes++; return { ok: true }; };
  context.updateDropboxUI = () => {};
  context.setDbxStatus = () => {};
  return { context, memory, calls, dialogs, responses, get refreshes() { return refreshes; },
    choose: value => { choice = value; }, merge: (decisions = {}, stop = '') => { mergeDecisions = decisions; cancelAt = stop; },
    duringDialog: fn => { onDialog = fn; }, draft: value => { draft = value; } };
}
const cloud = { status: 200, text: 'Задача два', meta: { rev: 'shown', client_modified: '2026-10-08T10:00:00Z' } };
const archive = { status: 200, text: 'x 2026-10-08 Задача один', meta: { rev: 'archive' } };

async function run() {
  let h = harness(), cmp = h.context.TaskVersionComparison;
  let result = cmp.compare('Задача один\n\nЗадача один', 'Задача один', 'Задача один', archive.text);
  assert.equal(result.shared, 1);
  assert.equal(result.onlyLocal.length, 1, 'do not deduplicate occurrences');
  assert.equal(result.onlyLocal[0].inBaseline, false);
  assert.equal(result.onlyLocal[0].archiveMatch, true);
  result = cmp.compare('Задача один\nЗадача один', '', null, archive.text);
  assert.equal(result.onlyLocal.filter(row => row.archiveMatch).length, 1, 'one archive occurrence does not explain two tasks');
  result = cmp.compare('SORTED (2026.10.08)\nЗадача один\n\nЗадача два',
    'INBOX SORTED\nЗадача два\n\nЗадача один', null, null);
  assert.equal(result.moved.length, 2);
  assert.equal(result.reordered, true);
  assert.equal(result.markersChanged, true);
  assert.equal(result.onlyLocal.length, 0);
  result = cmp.compare('Новая\nЗадача один\nЗадача два', 'Задача один\nЗадача два', null, '');
  assert.equal(result.reordered, false, 'an insertion is not a reorder');
  result = cmp.compare('Задача один due:2026-10-09', 'Задача один due:2026-10-10', 'Задача один due:2026-10-09', '');
  assert.equal(result.onlyLocal[0].inBaseline, true);
  assert.equal(result.onlyCloud[0].inBaseline, false);
  assert.equal(result.shared, 0, 'do not guess changed task identity');
  result = cmp.compare('Задача один\n', 'Задача один\n\n', null, null);
  assert.equal(result.onlyLocal.length + result.onlyCloud.length, 0);
  assert.match(cmp.render(result), /пустые строки/);
  result = cmp.compare('<img src=x onerror=alert(1)>', '', null, null);
  assert(!cmp.render(result).includes('<img'));
  assert(cmp.render(result).includes('&lt;img'));
  result = cmp.compare('x 2026-10-08 Задача один\n\nx 2026-10-08 Задача один\n\nIGNORED TASKS (2026.10.07)\nЗадача два', '', null, '');
  assert.equal(result.onlyLocal.length, 3, 'completed and ignored occurrences remain visible');
  assert.equal(result.onlyLocal[2].listName, 'ignored');
  const many = Array.from({ length: 1000 }, (_, i) => 'Задача ' + i).join('\n');
  result = cmp.compare(many, many, many, '');
  assert.equal(result.shared, 1000);

  // Conservative merge uses synced occurrences, not a Set of equal task text.
  let plan = cmp.createMergePlan(cmp.compare('Один\nОдин', 'Один\nДва', 'Один', ''));
  let merged = cmp.finalizeMerge(plan);
  assert.equal(h.context.parseTaskDocument(merged.text).inboxUnsorted.length, 3);
  assert.equal(merged.kept, 3);
  plan = cmp.createMergePlan(cmp.compare('Новая', 'Новая', '', ''));
  assert.equal(plan.uncertain, 1);
  assert.equal(cmp.finalizeMerge(plan).kept, 2, 'independent equal additions survive');
  assert.equal(cmp.finalizeMerge(plan, { 'cloud:0': 'skip' }).kept, 1);
  plan = cmp.createMergePlan(cmp.compare('Один\nОдин', '', null, 'x 2026-10-08 Один'));
  assert.throws(() => cmp.finalizeMerge(plan, { 'local:0': 'archived', 'local:1': 'archived' }), /недостаточно/);
  merged = cmp.finalizeMerge(plan, { 'local:0': 'archived' });
  assert.equal(merged.kept, 1, 'exclude only one matching occurrence');
  assert.throws(() => cmp.validateArchivedSelections(merged, ''), /недостаточно/);
  assert.throws(() => cmp.finalizeMerge(plan, { 'local:900': 'skip' }), /Неизвестное/);
  plan = cmp.createMergePlan(cmp.compare('x 2026-10-08 Сделано', '', null, ''));
  assert.match(cmp.finalizeMerge(plan).text, /^x /, 'completed task retained by default');
  merged = cmp.finalizeMerge(plan, { 'local:0': 'archive' });
  assert.equal(merged.text, '');
  assert.deepEqual(Array.from(merged.archiveLines), ['x 2026-10-08 Сделано']);
  const sections = 'Входящая\nINBOX SORTED\nПартия\nSORTED (2026.10.01)\n(A) Первая\nПервая\nPARTIALLY SORTED (2026.10.02)\nХвост\nIGNORED TASKS (2026.10.03)\nСтарая';
  plan = cmp.createMergePlan(cmp.compare(sections, 'Новая\nIGNORED TASKS (2026.10.05)\nНовая ignored', sections, ''));
  merged = cmp.finalizeMerge(plan);
  let doc = h.context.parseTaskDocument(merged.text);
  assert.deepEqual(Array.from(doc.inboxUnsorted), ['Новая', 'Входящая']);
  assert.deepEqual(Array.from(doc.sorted), ['(A) Первая', 'Первая']);
  assert.deepEqual(Array.from(doc.inboxSorted), ['Партия']);
  assert.deepEqual(Array.from(doc.partiallySorted), ['Хвост']);
  assert.deepEqual(Array.from(doc.ignored), ['Новая ignored', 'Старая']);
  assert.equal(doc.markers.ignored, 'IGNORED TASKS (2026.10.03)');
  assert.equal(merged.text, h.context.formatTaskList(merged.text), 'canonical blank separators');
  assert(merged.text.startsWith('Новая\n\nВходящая'), 'canonical top inbox has no legacy heading');
  for (const local of ['Один\nNEW ARRAY\nДва', 'INBOX SORTED\nДва']) {
    plan = cmp.createMergePlan(cmp.compare(local, 'Три', local, ''));
    doc = h.context.parseTaskDocument(cmp.finalizeMerge(plan).text);
    assert.deepEqual(Array.from(doc.inboxUnsorted), ['Три']);
    assert.deepEqual(Array.from(doc.sorted), local.startsWith('Один') ? ['Один'] : []);
    assert.deepEqual(Array.from(doc.inboxSorted), ['Два']);
  }
  assert.throws(() => cmp.createMergePlan(cmp.compare('IGNORED TASKS (2026.10.01)\nОдин\nIGNORED TASKS (2026.10.02)\nДва', '', '', '')), /несколько/);
  plan = cmp.createMergePlan(cmp.compare('', 'Один', '', ''));
  assert.equal(cmp.finalizeMerge(plan).kept, 1);

  // Cancel: only downloads, zero mutation including backups and sync metadata.
  h = harness(); h.responses.push(cloud, archive);
  const before = JSON.stringify([...h.memory]);
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(JSON.stringify([...h.memory]), before);
  assert.equal(h.calls.length, 2);
  assert(h.dialogs[0].html.includes('Есть совпадение в архиве'));

  // Exact local choice: both versions recoverable and a conditional upload, never overwrite.
  h = harness(); h.choose({ isDenied: true }); h.responses.push(cloud, archive, { status: 200, json: { rev: 'saved' } });
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert.equal(h.calls[2].args.mode.update, 'shown');
  assert.equal(h.calls[2].args.strict_conflict, true);
  assert.equal(h.calls[2].body, 'Задача один');
  assert.equal(h.memory.get('dbx_last_tasks'), 'Задача один');
  assert.equal(JSON.parse(h.memory.get('tasks_snapshots'))[1].text, cloud.text);
  assert.equal(h.memory.get('tasks'), 'Задача один');

  // Actual shared UI flow, with no-op cancellation at each merge step.
  for (const stage of ['Что оставить', 'Сохранить общий список?']) {
    h = harness(); h.merge({}, stage); h.responses.push(cloud, archive);
    const initial = JSON.stringify([...h.memory]);
    assert.equal(await h.context.dbxResolveConflict(), false);
    assert.equal(JSON.stringify([...h.memory]), initial);
    assert.equal(h.calls.length, 2);
  }
  h = harness(); h.merge(); h.responses.push(cloud, archive, cloud, { status: 200, json: { rev: 'merged' } });
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert.match(h.memory.get('tasks'), /Задача два\n\nЗадача один/);
  assert.equal(h.calls[3].args.mode.update, 'shown');
  assert.equal(h.calls[3].args.strict_conflict, true);
  assert.equal(h.memory.get('dbx_last_tasks'), h.memory.get('tasks'));
  assert.equal(JSON.parse(h.memory.get('tasks_snapshots'))[2].text, h.memory.get('tasks'));

  // Existing archive must be freshly verified before excluding a record.
  h = harness(); h.merge({ 'local:0': 'archived' }); h.responses.push(cloud, archive, cloud, { ...archive, text: '' });
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.calls.filter(call => call.url.endsWith('/upload')).length, 0);
  assert.equal(h.memory.get('tasks'), 'Задача один');
  h = harness(); h.merge({ 'local:0': 'archived' });
  h.responses.push(cloud, archive, cloud, archive, { status: 200, json: { rev: 'merged' } });
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert(!h.memory.get('tasks').includes('Задача один'));

  // Archive failure never permits writing a list that excludes the batch.
  h = harness(); h.merge({ 'local:0': 'archive' }); h.responses.push(cloud, archive, cloud, { status: 500 });
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.calls.filter(call => call.url.endsWith('/upload')).length, 0);
  assert.equal(h.memory.get('tasks'), 'Задача один');
  for (const failure of ['conflict', 'local-change', 'network']) {
    h = harness(); h.merge({ 'local:0': 'archive' });
    h.responses.push(cloud, archive, cloud, archive,
      { status: 200, run: failure === 'local-change' ? () => h.memory.set('tasks', 'Новая правка') : undefined });
    if (failure !== 'local-change') h.responses.push(failure === 'network' ? new Error('offline') : { status: 409 });
    assert.equal(await h.context.dbxResolveConflict(), false);
    assert.equal(h.memory.get('tasks'), failure === 'local-change' ? 'Новая правка' : 'Задача один');
    const text = JSON.stringify(h.dialogs);
    assert(text.includes('Архив уже записан'), failure + ' must disclose partial success');
    assert.equal(h.memory.get('dbx_last_rev'), 'old');
  }
  h = harness(); h.merge({ 'local:0': 'archive' });
  h.responses.push(cloud, archive, cloud, archive, { status: 200 }, { status: 200, json: { rev: 'merged' } });
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert.equal(h.calls[4].args.path, '/archive.txt');
  assert.equal(h.calls[5].args.path, '/tasks.txt');
  assert(!h.memory.get('tasks').includes('Задача один'));
  h = harness(); h.merge(); h.responses.push(cloud, archive, { ...cloud, meta: { rev: 'newer' } });
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.calls.filter(call => call.url.endsWith('/upload')).length, 0);
  h = harness(); h.merge(); h.responses.push(cloud, archive, cloud,
    { status: 200, json: { rev: 'merged' }, run: () => h.memory.set('tasks', 'Новая правка') });
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert.equal(h.memory.get('tasks'), 'Новая правка');
  assert(h.memory.get('dbx_last_tasks').includes('Задача два'));

  for (const entry of ['dbxAutoUpload', 'dropboxSave', 'autoSyncOnFocus', 'dropboxSmartSync']) {
    h = harness();
    h.context.dbxGetMetadata = async () => ({ rev: 'changed' });
    if (entry === 'dbxAutoUpload' || entry === 'dropboxSave') h.responses.push({ status: 409 });
    h.responses.push(cloud, archive);
    const initial = JSON.stringify([...h.memory]);
    await h.context[entry]();
    assert.equal(h.dialogs.filter(dialog => dialog.title === 'Сравнение версий').length, 1, entry);
    assert.equal(JSON.stringify([...h.memory]), initial, entry + ' cancellation');
  }

  // While the preview is open, no second dialog or background writer can run.
  h = harness(); h.responses.push(cloud, archive);
  h.duringDialog(async () => {
    assert.equal(await h.context.dbxResolveConflict(), false);
    await h.context.dbxAutoUpload();
    await h.context.dropboxSave();
    await h.context.autoSyncOnFocus();
    await h.context.dropboxSmartSync();
  });
  await h.context.dbxResolveConflict();
  assert.equal(h.calls.length, 2);
  assert.equal(h.dialogs.length, 1);

  // Archive failure must not fabricate a deletion or block viewing the task diff.
  h = harness(); h.responses.push(cloud, { status: 500 });
  await h.context.dbxResolveConflict();
  assert(h.dialogs[0].html.includes('Архив недоступен'));
  h = harness(); h.responses.push(cloud, { status: 409, json: { error: { '.tag': 'path', path: { '.tag': 'not_found' } } } });
  await h.context.dbxResolveConflict();
  assert(h.dialogs[0].html.includes('Архив проверен'));
  for (const failed of [{ status: 403 }, { status: 200, meta: {} }, new Error('offline')]) {
    h = harness(); h.responses.push(failed);
    await h.context.dbxResolveConflict();
    assert.equal(h.calls.length, 1);
    assert.equal(h.memory.get('tasks_snapshots'), undefined);
    assert.equal(h.memory.get('dbx_last_rev'), 'old');
  }
  h = harness(); h.responses.push({ status: 401 }, { status: 401 });
  await h.context.dbxResolveConflict();
  assert.equal(h.refreshes, 1);
  assert.equal(h.calls.length, 2);

  for (const changed of ['local', 'draft']) {
    h = harness(); h.choose({ isDenied: true }); h.responses.push(cloud, archive);
    h.duringDialog(() => changed === 'local' ? h.memory.set('tasks', 'Задача три') : h.draft(true));
    await h.context.dbxResolveConflict();
    assert.equal(h.calls.length, 2);
    assert.equal(h.memory.get('tasks_snapshots'), undefined);
  }
  h = harness(); h.draft(true); h.choose({ isConfirmed: true }); h.responses.push(cloud, archive);
  await h.context.dbxResolveConflict();
  assert.equal(h.calls.length, 2, 'open draft must not be discarded');
  assert.equal(h.memory.get('tasks_snapshots'), undefined);

  // Server change after preview: local choice must stop on CAS conflict, no retry.
  h = harness(); h.choose({ isDenied: true }); h.responses.push(cloud, archive, { status: 409 });
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.calls.length, 3);
  assert.equal(h.memory.get('dbx_last_rev'), 'old');
  assert.equal(h.memory.get('tasks'), 'Задача один');
  // Cloud choice rechecks the downloaded revision AND content before replacement.
  for (const newer of [{ ...cloud, meta: { rev: 'newer' } }, { ...cloud, text: 'Невидимая правка' }]) {
    h = harness(); h.choose({ isConfirmed: true }); h.responses.push(cloud, archive, newer);
    assert.equal(await h.context.dbxResolveConflict(), false);
    assert.equal(h.memory.get('tasks'), 'Задача один');
    assert.equal(h.memory.get('dbx_last_rev'), 'old');
  }
  h = harness(); h.choose({ isConfirmed: true }); h.responses.push(cloud, archive, cloud);
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert.equal(h.memory.get('tasks'), cloud.text);
  assert.equal(h.memory.get('dbx_last_rev'), 'shown');
  assert.equal(JSON.parse(h.memory.get('tasks_snapshots'))[0].text, 'Задача один');
  h = harness(); h.choose({ isConfirmed: true }); h.responses.push(cloud, archive, { status: 401 }, { status: 401 });
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.refreshes, 1, 'bounded refresh for the post-preview download');
  assert.equal(h.memory.get('tasks'), 'Задача один');
  h = harness(); h.choose({ isConfirmed: true }); h.responses.push(cloud, archive, { ...cloud, run: () => h.memory.set('tasks', 'Новая правка') });
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.memory.get('tasks'), 'Новая правка');

  // Quota failure stops before any upload/download replacement request.
  h = harness(); h.choose({ isDenied: true }); h.responses.push(cloud, archive);
  h.context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(await h.context.dbxResolveConflict(), false);
  assert.equal(h.calls.length, 2);
  // New local edits during upload survive and remain different from sync baseline.
  h = harness(); h.choose({ isDenied: true }); h.responses.push(cloud, archive,
    { status: 200, json: { rev: 'saved' }, run: () => h.memory.set('tasks', 'Новая правка') });
  assert.equal(await h.context.dbxResolveConflict(), true);
  assert.equal(h.memory.get('tasks'), 'Новая правка');
  assert.equal(h.memory.get('dbx_last_tasks'), 'Задача один');

  // All old conflict branches share the resolver, and no longer clear revision for overwrite.
  assert.equal((read('dropbox.js').match(/await dbxResolveConflict\(\)/g) || []).length, 4);
  for (const page of ['index.html', 'tasks.html']) {
    const html = read(page);
    assert(html.indexOf('task-version-comparison.js') < html.indexOf('src="dropbox.js'));
  }
  console.log('PASS conflict comparison, duplicate occurrences, baseline/archive hints, cancellation, backups and stale-version guards');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
