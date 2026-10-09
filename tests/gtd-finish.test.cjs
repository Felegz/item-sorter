const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const c = vm.createContext({ URL, URLSearchParams });
for (const file of ['markers.js', 'task-format.js', 'task-list-operations.js', 'gtd-task-tools.js']) {
  vm.runInContext(fs.readFileSync('sorter 2025/' + file, 'utf8'), c);
}
const gtd = c.TaskGtd;
const parse = c.TaskFormat.parseTaskLine;
const today = '2026-10-09';
const original = '(C) 2026-01-31 Задача один @дом +проект +💚 #review due:2026-11-01 snz:2026-10-15 gtd:2026-02-01 ➤цель:Цель ➤совет:Совет ➤исходное:Исходник due:2026-12-01';

const preview = gtd.withColor(gtd.prepareOutput('Изменённая задача', original, today), 'red');
assert.equal(parse(preview).priority, 'C');
assert.equal(parse(preview).creationDate, '2026-01-31');
assert.equal(gtd.taskColor(preview), 'red');
assert(!parse(preview).projects.includes('💚'));
assert(parse(preview).projects.includes('проект'));
assert.equal(parse(preview).tags.gtd, '2026-02-01', 'Preview does not stamp a new review date');
assert.equal(gtd.withColor(original, null), original);
assert.throws(() => gtd.withColor(original, 'blue'));
assert.equal(gtd.taskColor('(A) Задача без сердца'), null, 'Priority is not a heart colour');

const sections = [
  'Задача выше', '', 'INBOX SORTED', 'Новая партия', '', 'SORTED (2026.09.01)', original,
  '', 'X 2026-10-01 2026-09-01 Выполненная задача', '', 'PARTIALLY SORTED (2026.09.01)',
  'Задача ниже', '', 'IGNORED TASKS (2026.09.01)', 'Игнорируемая задача',
].join('\n');
const saved = gtd.saveOutputInDocument(sections, original, preview, today, { color: 'red' });
assert.equal(parse(saved.line).tags.gtd, today);
assert.equal((saved.line.match(/\bgtd:/g) || []).length, 1);
assert.equal(parse(saved.line).creationDate, '2026-01-31');
assert.equal(parse(saved.line).priority, 'C');
assert.equal(parse(saved.line).dueDate, '2026-11-01');
assert.equal(parse(saved.line).thresholdDate, '2026-10-15');
assert.equal(parse(saved.line).source, 'Исходник due:2026-12-01');
assert(saved.line.includes('#review'));
assert.deepEqual(saved.document.split('\n').filter(Boolean).filter(row => row !== saved.line),
  sections.split('\n').filter(Boolean).filter(row => row !== original), 'All other rows keep their sections and order');
assert.equal(saved.document.split('\n')[saved.index], saved.line);
assert(!saved.document.includes('\n\n\n'));

const clearedDue = gtd.saveOutputInDocument(sections, original, gtd.withDueDate(preview, ''), today, { color: 'green' });
assert.equal(parse(clearedDue.line).dueDate, null, 'Merging does not resurrect a removed due date');
assert.equal(parse(clearedDue.line).source, 'Исходник due:2026-12-01');
assert.equal(gtd.taskColor(clearedDue.line), 'green');
assert(!parse(clearedDue.line).projects.includes('🩷'));

const duplicate = '2026-01-01 Задача одинаковая';
const duplicates = [duplicate, '', 'SORTED (2026.09.01)', duplicate, '', 'IGNORED TASKS (2026.09.01)', duplicate].join('\n');
const second = gtd.saveOutputInDocument(duplicates, duplicate, 'Изменён второй экземпляр', today, { occurrence: 1 });
assert.equal(second.document.split('\n').filter(row => row === duplicate).length, 2);
assert.equal(second.document.split('\n')[0], duplicate);
assert(second.document.includes('SORTED (2026.09.01)\n' + second.line));
assert(second.document.endsWith(duplicate));
assert.throws(() => gtd.saveOutputInDocument(duplicates, duplicate, 'Новый текст', today), /одинаковые/);
assert.throws(() => gtd.saveOutputInDocument('Другой список', duplicate, 'Новый текст', today), /не найдена/);
assert.throws(() => gtd.saveOutputInDocument('IGNORED TASKS\nОдин\nIGNORED TASKS\nДва', '', 'Новое', today), /ignored/);
assert.throws(() => gtd.saveOutputInDocument('', '', 'Два\nабзаца', today), /одной строке/);
assert.throws(() => gtd.saveOutputInDocument('', '', '# УДАЛЕНО: задача', today));
const capture = gtd.saveOutputInDocument('SORTED (2026.09.01)\nСтарая задача', '', 'Новая задача +💚', today);
assert.equal(parse(capture.line).creationDate, today);
assert(capture.document.startsWith(capture.line + '\n\nSORTED'));

const queue = [
  'Задача сверху due:2026-10-10 @дом', '', 'INBOX SORTED', 'Разобрана gtd:2026-10-08',
  '', 'SORTED (2026.09.01)', 'Текущая задача', '',
  'X 2026-10-01 Выполнена', '', 'Позже +someday-maybe', '',
  'PARTIALLY SORTED (2026.09.01)', 'Следующая задача', '',
  'IGNORED TASKS (2026.09.01)', 'Игнорируемая задача',
].join('\n');
const currentIndex = queue.split('\n').indexOf('Текущая задача');
const candidate = gtd.nextUnprocessedTask(queue, currentIndex);
assert.equal(candidate.line, 'Следующая задача');
const afterNext = queue.replace('Следующая задача', 'Следующая задача gtd:2026-10-09');
assert.equal(gtd.nextUnprocessedTask(afterNext, currentIndex).line, 'Задача сверху due:2026-10-10 @дом', 'Wraps to unsaved tasks above, not only inbox');
assert.equal(gtd.nextUnprocessedTask('X 2026-10-01 Выполнена\nРазобрана gtd:2026-10-09\nПозже +someday-maybe\nIGNORED TASKS\nИгнорируемая'), null);
assert.equal(gtd.nextUnprocessedTask('IGNORED TASKS\nИгнорируемая\nSORTED (2026.09.01)\nДоступная').line, 'Доступная');
assert.equal(gtd.nextUnprocessedTask('Задача\n\nЗадача', 0).index, 2, 'Duplicate occurrences are not deduplicated');
assert(!gtd.isProcessed('Задача gtd:2026-02-30'));
assert(gtd.isProcessed('Задача gtd:2026-10-09'));
assert(!gtd.isProcessed('Задача due:2026-10-09 @дом ➤исходное:Не утверждаем, что был сохранён GTD'));

// Exercise real page handlers with the project's established memory-only DOM
// harness. No browser/cloud/user task data is read or written by these tests.
const html = fs.readFileSync('sorter 2025/process.html', 'utf8');
let stored = 'Задача выше\n\nТекущая задача\n\nРазобрана gtd:2026-10-09\n\nIGNORED TASKS\nИгнорируемая';
let storageFails = false;
let writes = 0;
let loadPage;
const elements = new Map();
c.document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', className: '', innerHTML: '', href: '/',
    classList: { add() {}, remove() {} }, focus() {}, addEventListener() {}, getAttribute() { return this.href; },
  });
  return elements.get(id);
} };
c.SorterRuntime = {
  getTasks: () => stored,
  setTasks(text) { if (storageFails) throw Error('Storage denied'); stored = text; writes++; },
  isDeveloperMode: true,
  withMode(input) { const url = new URL(input, 'http://127.0.0.1:4173/'); url.searchParams.set('mode', 'developer'); return url.pathname + url.search; },
};
let readDraft;
c.SorterUnsavedChanges = { register(name, read) { readDraft = read; }, confirmDiscard: async () => true };
c.window = { location: { href: '', search: '?from=tasks&mode=developer' }, addEventListener(name, callback) { loadPage = callback; }, scrollTo() {} };
const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim()).at(-1);
vm.runInContext(inline, c);
loadPage();
assert(elements.get('bottom-back-link').href.includes('mode=developer'));
assert.equal(elements.get('bottom-back-link').textContent, 'К задачам');
assert.equal(elements.get('back-link').textContent, '← К задачам');
vm.runInContext("S.originalTask = 'Текущая задача'; S.priority = 'red';", c);
elements.get('out-line').textContent = 'Текущая задача после разбора due:2026-12-01';
c.updateSaveStatus();
assert.equal(elements.get('out-save-status').textContent, 'Не сохранено');
assert(readDraft());
storageFails = true;
c.nextTask();
assert.equal(writes, 0);
assert.equal(c.window.location.href, '', 'A failed save must never navigate');
assert(elements.get('out-note').textContent.includes('Storage denied'));
assert.equal(elements.get('out-save-status').textContent, 'Не сохранено');
assert(readDraft(), 'The failed draft is still protected');
storageFails = false;
c.nextTask();
assert.equal(writes, 1);
const savedCurrent = stored.split('\n').find(row => row.includes('Текущая задача'));
assert.equal(gtd.taskColor(savedCurrent), 'red');
assert(gtd.isProcessed(savedCurrent));
const nextUrl = new URL(c.window.location.href, 'http://127.0.0.1:4173/');
assert.equal(nextUrl.searchParams.get('task'), 'Задача выше');
assert.equal(nextUrl.searchParams.get('from'), 'tasks');
assert.equal(nextUrl.searchParams.get('mode'), 'developer');
assert.equal(nextUrl.searchParams.get('occurrence'), '0');
assert.equal(elements.get('out-save-status').textContent, 'Сохранено в список');
assert.equal(readDraft(), '', 'The saved result no longer triggers a draft warning');
elements.get('out-line').textContent = c.TaskGtd.withDueDate(elements.get('out-line').textContent, '');
c.updateSaveStatus();
assert.equal(elements.get('out-save-status').textContent, 'Не сохранено');
assert(c.addToList());
assert.equal(stored.split('\n').filter(row => row.includes('Текущая задача')).length, 1);
assert.equal(parse(stored.split('\n').find(row => row.includes('Текущая задача'))).dueDate, null);
elements.get('out-line').textContent = elements.get('out-line').textContent.replace('+🩷', '+💚');
assert(c.addToList());
assert.equal(gtd.taskColor(stored.split('\n').find(row => row.includes('Текущая задача'))), 'green', 'Editing the result heart overrides the earlier red answer');
stored += '\n\nДобавлена на другом экране';
const beforeConflict = stored;
assert.equal(c.addToList(), false);
assert.equal(stored, beforeConflict, 'A changed document is never overwritten');
assert(elements.get('out-note').textContent.includes('Список изменился'));

assert.match(html, /id="save-task-btn" class="btn btn-p"/);
assert.match(html, /id="next-task-btn" class="btn"[^>]*>[\s\S]*?Сохранить и разобрать ещё<\/button>/);
assert.match(html, /id="bottom-back-link"/);
assert(!html.includes('>Готово</div>'));
assert(html.indexOf('id="out-due"') < html.indexOf('id="save-task-btn"'));
assert.match(html, /body\.mobile-editor-active #out-area \.completion-date/);
assert.match(html, /body\.mobile-editor-active #out-area #next-task-btn/);
assert.match(html, /body\.mobile-editor-active #out-area #out-note\.error\s*\{\s*display: block;/, 'Save errors remain visible above the keyboard');
assert(!inline.includes("parsedTask.priority === 'A' ? 'red'"));
const flows = fs.readFileSync('sorter 2025/flows.js', 'utf8');
assert(flows.includes("q: 'Красная или зелёная задача?'"));
console.log('PASS GTD hearts, preserved dates/priorities, review stamp, whole-list queue, duplicate safety, save-before-navigation and failed/stale saves');
