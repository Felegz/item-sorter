const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const c = vm.createContext({ console });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js']) {
  vm.runInContext(fs.readFileSync(`sorter 2025/${file}`, 'utf8'), c, { filename: file });
}
const format = c.TaskFormat;
const ops = c.TaskListOperations;

// Legacy input remains readable; only explicit writes use the new spelling.
assert.equal(format.parseTaskLine('Задача t:2026-11-10').thresholdDate, '2026-11-10');
assert.equal(format.parseTaskLine('Задача snz:2026-11-12').thresholdDate, '2026-11-12');
for (const tags of ['t:2026-11-10 snz:2026-11-12', 'snz:2026-11-12 t:2026-11-10']) {
  assert.equal(format.parseTaskLine('Задача ' + tags).thresholdDate, '2026-11-12');
}
const legacyTail = format.parseTaskLine('Задача t:2026-11-10 ⟦исх.: Оригинал⟧ заметка snz:2026-11-12 due:2026-12-01');
assert.equal(legacyTail.thresholdDate, '2026-11-12');
assert.equal(legacyTail.dueDate, '2026-12-01');
assert.equal(legacyTail.unparsed, 'заметка');
assert.equal(format.parseTaskLine('Задача snz:2026-11-12 ⟦исх.: Оригинал⟧ t:2026-11-10').thresholdDate, '2026-11-12');
assert.equal(format.parseTaskLine('Задача snz:2026-02-30').thresholdDate, null);
const canonical = format.serializeTaskLine(format.parseTaskLine('Задача t:2026-11-10'));
assert.match(canonical, /snz:2026-11-10/);
assert.doesNotMatch(canonical, /(?:^|\s)t:/);
assert.match(format.serializeTaskLine(format.parseTaskLine('Задача snz:неизвестно')), /snz:неизвестно/);
assert.match(format.serializeTaskLine(format.parseTaskLine('Задача t:2026-11-12 snz:2026-02-30')), /snz:2026-02-30/);

const original = '(B) 2026-09-01 Позвонить @дом #test due:2026-12-01';
const protectedText = ' ⟦исх.: Проверить t:2026-01-01 и snz:2026-02-01⟧ ➤совет:Сохранить snz:2026-03-01 в совете';
for (const prefix of ['', 'x 2026-10-07 ']) {
  const raw = prefix + original + ' t:2026-11-01' + protectedText;
  const snoozed = ops.setTaskSnoozeDate(raw, '2026-11-12');
  assert.equal(snoozed, prefix + original + ' snz:2026-11-12' + protectedText);
  assert.equal(ops.setTaskSnoozeDate(snoozed, '2026-11-12'), snoozed);
  assert.equal(ops.setTaskSnoozeDate(snoozed, ''), prefix + original + protectedText);
  assert.equal(format.parseTaskLine(snoozed).creationDate, '2026-09-01');
  assert.equal(format.parseTaskLine(snoozed).dueDate, '2026-12-01');
}
assert.equal(ops.setTaskSnoozeDate(original + ' ⟦исх.: Оригинал⟧ t:2026-11-01', '2026-11-12'),
  original + ' snz:2026-11-12 ⟦исх.: Оригинал⟧');
assert.equal(ops.setTaskSnoozeDate(original + ' t:2026-11-01 snz:2026-11-02', ''), original);
assert.equal(ops.setTaskSnoozeDate(original + ' https://example.com/snz:2026-11-01', ''), original + ' https://example.com/snz:2026-11-01');
for (const invalid of ['2026-02-30', '2026-13-01', 'tomorrow']) {
  assert.throws(() => ops.setTaskSnoozeDate(original, invalid));
}
assert.throws(() => ops.setTaskSnoozeDate('SORTED (2026.10.07)', '2026-11-12'));
assert.throws(() => ops.setTaskSnoozeDate('', '2026-11-12'));
assert.throws(() => ops.setTaskSnoozeDate('snz:2026-11-12', ''));
assert.equal(ops.setTaskSnoozeDate(original + ' ⟦исх.: t:2026-11-01', '2026-11-12'), original + ' snz:2026-11-12 ⟦исх.: t:2026-11-01');
assert.match(format.renderTaskMetaHtml(original + ' snz:2026-11-12'), /Отложено до/);

const page = fs.readFileSync('sorter 2025/tasks-page.js', 'utf8');
function extract(name) {
  const match = new RegExp(`    (?:async )?function ${name}\\(`).exec(page);
  assert.ok(match, name);
  const end = page.indexOf('\n    function ', match.index + 1);
  return page.slice(match.index, end < 0 ? page.length : end);
}
let saves = 0;
const ui = vm.createContext({
  TaskListOperations: ops,
  TaskFormat: format,
  parseLine(raw) { return { _raw: raw, _threshold: format.parseTaskLine(raw).thresholdDate }; },
  saveItems() { saves += 1; }, render() {}, keepTaskVisibleAfterEdit() {},
  showFuture: false, tab: 'active', contextOperator: 'OR',
  items: [{ _raw: original, _ignored: true }, { _raw: original, _ignored: false }],
});
vm.runInContext(extract('applyTaskSnoozeDate'), ui);
ui.applyTaskSnoozeDate(0, '2026-11-12');
assert.equal(ui.items[0]._threshold, '2026-11-12');
assert.equal(ui.items[0]._ignored, true);
assert.equal(ui.items[1]._raw, original);
assert.equal(saves, 1);
ui.applyTaskSnoozeDate(0, '');
assert.equal(ui.items[0]._raw, original);
assert.equal(ui.items[1]._raw, original);

// Filtering changes visibility, never the stored task instances or section.
Object.assign(ui, {
  tab: 'active', sortMode: 'order', showFuture: false, showIgnored: false,
  priF: null, ctxF: new Set(), projF: null, hashtagF: null, searchQ: '',
  SorterAutoContext: { matchesSelectedContexts: () => true },
});
vm.runInContext(extract('getFiltered'), ui);
const today = ops.localIsoDate();
ui.items = [
  { _raw: 'SORTED (2026.10.07)', _sectionHeader: true },
  { _raw: original, _threshold: today },
  { _raw: original, _threshold: '2999-01-01' },
  { _raw: 'x 2026-10-07 Готово', complete: true, _threshold: '2999-01-01' },
];
const before = JSON.stringify(ui.items);
for (const mode of ['order', 'priority']) {
  ui.sortMode = mode;
  ui.showFuture = false;
  ui.tab = 'active';
  assert.equal(ui.getFiltered().filter(t => !t._sectionHeader).length, 1);
  ui.showFuture = true;
  assert.equal(ui.getFiltered().filter(t => !t._sectionHeader).length, 2);
  ui.tab = 'all';
  ui.showFuture = false;
  assert.equal(ui.getFiltered().filter(t => !t._sectionHeader).length, 3);
  assert.equal(JSON.stringify(ui.items), before);
}
// Presets delegate date arithmetic to the already loaded date-fns library.
const calls = [];
ui.window = { dateFns: {
  addDays(now, days) { calls.push(['days', days]); return new Date(2026, 10, days); },
  addMonths(now, months) { calls.push(['months', months]); return new Date(2026, 1, 28); },
} };
vm.runInContext(extract('snoozePresetDate'), ui);
assert.equal(ui.snoozePresetDate('day', new Date(2026, 0, 31)), '2026-11-01');
assert.equal(ui.snoozePresetDate('week', new Date(2026, 0, 31)), '2026-11-07');
assert.equal(ui.snoozePresetDate('month', new Date(2026, 0, 31)), '2026-02-28');
assert.deepEqual(calls, [['days', 1], ['days', 7], ['months', 1]]);
assert.throws(() => ui.snoozePresetDate('unknown'));
assert.match(page, /onclick="openTaskSnooze\(\$\{idx\}\)"/);
// The real dialog handler must not write on cancel or after a concurrent reload.
vm.runInContext(extract('openTaskSnooze'), ui);
ui.document = { querySelector() { return null; } };
async function checkDialog() {
  const answers = [{ isDismissed: true }, { isConfirmed: true, value: '2026-11-12' }, { isDenied: true }];
  const popups = [];
  ui.Swal = { async fire(options) { popups.push(options); return answers.shift(); } };
  ui.items = [{ _raw: original, _ignored: false }];
  const beforeCancel = saves;
  await ui.openTaskSnooze(0);
  assert.equal(saves, beforeCancel);
  await ui.openTaskSnooze(0);
  assert.equal(ui.items[0]._threshold, '2026-11-12');
  await ui.openTaskSnooze(0);
  assert.equal(ui.items[0]._raw, original);
  assert.equal(popups[2].showDenyButton, true);
  let warnings = 0;
  ui.Swal = { async fire(options) {
    if (typeof options === 'string') { warnings += 1; return {}; }
    ui.items = [{ _raw: original, _ignored: false }];
    return { isConfirmed: true, value: '2026-11-12' };
  } };
  const beforeReload = saves;
  await ui.openTaskSnooze(0);
  assert.equal(saves, beforeReload);
  assert.equal(warnings, 1);
  console.log('PASS snz compatibility, protected text, one occurrence, visibility, presets and cancel/reload');
}
checkDialog().catch(error => { console.error(error); process.exitCode = 1; });
