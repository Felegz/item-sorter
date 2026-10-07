const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const dropbox = fs.readFileSync('sorter 2025/dropbox.js', 'utf8');
const page = require('./helpers/task-page-source.cjs')();
const archiveSource = dropbox.slice(dropbox.indexOf('async function dbxArchiveCompleted('), dropbox.indexOf('// ─── Автоматическое скачивание'));
const handlerSource = page.slice(page.indexOf('    async function archiveCompleted('), page.indexOf('    function toggleFuture('));
const batch = ['x 2026-10-08 Задача один', 'x 2026-10-08 Задача один'];
const existing = 'x 2026-10-01 Старая задача\r\n\r\n';

function response(status, text = '', metadata = { rev: 'rev-one' }, error = null) {
  return {
    ok: status >= 200 && status < 300, status,
    text: async () => text,
    headers: { get: () => metadata === null ? null : JSON.stringify(metadata) },
    json: async () => error,
  };
}
function adapter(queue, refresh = { ok: false }) {
  const calls = [], statuses = [];
  let refreshCount = 0;
  const c = vm.createContext({
    console: { error() {} },
    DROPBOX_ARCHIVE_PATH: '/archive.txt',
    getToken: () => 'fake-token',
    updateDropboxUI() {}, setDbxStatus: s => statuses.push(s),
    tryRefreshToken: async () => { refreshCount++; return refresh; },
    fetch: async (url, options) => {
      calls.push({ url, ...options, arg: JSON.parse(options.headers['Dropbox-API-Arg']) });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, 'unexpected request');
      return next;
    },
  });
  vm.runInContext(fs.readFileSync('sorter 2025/markers.js', 'utf8'), c);
  vm.runInContext(archiveSource, c);
  return { c, calls, statuses, refreshCount: () => refreshCount };
}
function handler(write, initial = null) {
  const one = { complete: true, _raw: batch[0] };
  const two = { complete: true, _raw: batch[1] };
  const active = { complete: false, _raw: 'Задача три' };
  let saves = 0, renders = 0, confirms = 0;
  const alerts = [];
  const c = vm.createContext({
    items: initial || [one, two, active], archiveInProgress: false,
    confirm: () => { confirms++; return true; }, alert: s => alerts.push(s),
    getToken: () => 'fake-token', dbxArchiveCompleted: write,
    saveItems: () => { saves++; }, render: () => { renders++; },
  });
  vm.runInContext(handlerSource, c);
  return { c, one, two, active, alerts, saves: () => saves, renders: () => renders, confirms: () => confirms };
}

(async () => {
  const success = adapter([response(200, existing), response(200)]);
  assert.equal(await success.c.dbxArchiveCompleted(batch), true);
  assert.deepEqual(success.calls[1].arg.mode, { '.tag': 'update', update: 'rev-one' });
  assert.equal(success.calls[1].arg.strict_conflict, true);
  assert.equal(success.calls[1].arg.autorename, false);
  assert.ok(success.calls[1].body.startsWith(existing), 'existing archive is preserved byte for byte');
  assert.equal(success.calls[1].body.slice(existing.length), batch.join('\n\n') + '\n');

  const missing = response(409, '', null, { error: { '.tag': 'path', path: { '.tag': 'not_found' } } });
  const create = adapter([missing, response(200)]);
  assert.equal(await create.c.dbxArchiveCompleted(batch), true);
  assert.equal(create.calls[1].arg.mode, 'add');
  assert.equal(create.calls[1].arg.strict_conflict, true);
  assert.equal(create.calls[1].body, batch.join('\n\n') + '\n');

  // Every unreadable archive must stop before any upload, not act like an empty file.
  for (const failure of [new Error('network'), response(500), response(403), response(429),
    response(409, '', null, { error: { '.tag': 'path', path: { '.tag': 'restricted_content' } } }),
    response(409, '', null, { error_summary: 'path/not_found/' }),
    response(200, existing, null), response(200, existing, {}),
    { ...response(200), headers: { get: () => 'invalid json' } },
    { ...response(200), text: async () => { throw new Error('body interrupted'); } },
  ]) {
    const a = adapter([failure]);
    assert.equal(await a.c.dbxArchiveCompleted(batch), false);
    assert.equal(a.calls.length, 1, 'no upload after a failed read');
  }
  for (const download of [response(200, existing), missing]) {
    const a = adapter([download, response(409)]);
    assert.equal(await a.c.dbxArchiveCompleted(batch), false, 'concurrent writer/create is a conflict');
    assert.equal(a.calls.length, 2, 'do not retry as overwrite');
    assert.match(a.statuses.at(-1), /измен/);
  }
  for (const failure of [response(500), response(403), new Error('lost upload acknowledgement')]) {
    const a = adapter([response(200, existing), failure]);
    assert.equal(await a.c.dbxArchiveCompleted(batch), false);
    assert.equal(a.calls.length, 2);
  }
  const refresh = adapter([response(401), response(200, existing, { rev: 'new-rev' }), response(200)], { ok: true });
  assert.equal(await refresh.c.dbxArchiveCompleted(batch), true);
  assert.equal(refresh.calls[2].arg.mode.update, 'new-rev');
  assert.equal(refresh.refreshCount(), 1);
  const uploadRefresh = adapter([response(200, existing), response(401), response(200, existing, { rev: 'later-rev' }), response(200)], { ok: true });
  assert.equal(await uploadRefresh.c.dbxArchiveCompleted(batch), true);
  assert.equal(uploadRefresh.calls[3].arg.mode.update, 'later-rev');
  const expired = adapter([response(401), response(401)], { ok: true });
  assert.equal(await expired.c.dbxArchiveCompleted(batch), false);
  assert.equal(expired.refreshCount(), 1, 'refresh is bounded');
  const empty = adapter([]);
  assert.equal(await empty.c.dbxArchiveCompleted([]), false);
  assert.equal(empty.calls.length, 0);

  // Exercise the actual adapter and button handler against an in-memory CAS
  // server. Another device writes between our read and upload, then the user
  // retries explicitly. Its archive entry must survive both attempts.
  const raced = adapter([]);
  let cloudText = existing, cloudRev = 'rev-one', racePending = true, uploads = 0;
  const otherTask = 'x 2026-10-08 Задача с другого устройства\n';
  raced.c.fetch = async (url, options) => {
    if (url.endsWith('/download')) return response(200, cloudText, { rev: cloudRev });
    uploads++;
    if (racePending) { cloudText += otherTask; cloudRev = 'rev-two'; racePending = false; }
    const args = JSON.parse(options.headers['Dropbox-API-Arg']);
    assert.equal(args.strict_conflict, true);
    if (args.mode.update !== cloudRev) return response(409);
    cloudText = options.body;
    cloudRev = 'rev-three';
    return response(200);
  };
  const raceButton = handler(lines => raced.c.dbxArchiveCompleted(Array.from(lines)));
  await raceButton.c.archiveCompleted();
  assert.equal(raceButton.c.items.length, 3);
  assert.equal(cloudText, existing + otherTask);
  assert.equal(uploads, 1, 'no automatic conflict retry');
  await raceButton.c.archiveCompleted();
  assert.deepEqual(Array.from(raceButton.c.items), [raceButton.active]);
  assert.ok(cloudText.startsWith(existing + otherTask));
  assert.equal(cloudText.split(batch[0]).length - 1, 2, 'both identical occurrences survive');

  const header = { _sectionHeader: true, _raw: 'SORTED (2026.10.08)' };
  const retained = { complete: false, _raw: 'Не архивировать' };
  const section = handler(async () => true, [header, { complete: true, _raw: batch[0] }, retained]);
  await section.c.archiveCompleted();
  assert.deepEqual(Array.from(section.c.items), [header, retained]);
  const cancelled = handler(async () => { throw new Error('must not archive after cancel'); });
  cancelled.c.confirm = () => false;
  await cancelled.c.archiveCompleted();
  assert.equal(cancelled.c.items.length, 3);
  assert.equal(cancelled.saves(), 0);

  const failed = handler(async () => false);
  const before = failed.c.items.slice();
  await failed.c.archiveCompleted();
  assert.deepEqual(failed.c.items, before);
  assert.equal(failed.saves(), 0);
  assert.equal(failed.alerts.length, 1);

  const ok = handler(async lines => { assert.deepEqual(Array.from(lines), batch); return true; });
  await ok.c.archiveCompleted();
  assert.deepEqual(Array.from(ok.c.items), [ok.active]);
  assert.equal(ok.saves(), 1);

  let release, writes = 0;
  const waiting = handler(async () => { writes++; return new Promise(resolve => { release = resolve; }); });
  const pending = waiting.c.archiveCompleted();
  await waiting.c.archiveCompleted();
  assert.equal(writes, 1, 'double click must not submit the batch twice');
  assert.equal(waiting.confirms(), 1);
  waiting.active.complete = true;
  waiting.one._raw = 'x 2026-10-08 Задача один с новыми правками';
  release(true);
  await pending;
  assert.deepEqual(Array.from(waiting.c.items), [waiting.one, waiting.active], 'retain tasks edited/completed during upload');
  assert.equal(waiting.c.archiveInProgress, false);

  const throwing = handler(async () => { throw new Error('unexpected failure'); });
  await throwing.c.archiveCompleted();
  assert.equal(throwing.c.items.length, 3);
  assert.equal(throwing.saves(), 0);
  assert.equal(throwing.c.archiveInProgress, false);
  console.log('Archive safety: passed (mock Dropbox only)');
})().catch(error => { console.error(error); process.exitCode = 1; });
