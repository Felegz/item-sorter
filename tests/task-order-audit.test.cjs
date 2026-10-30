const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runtime() {
  const c = vm.createContext({ console, queueMicrotask });
  for (const file of ['markers.js', 'task-format.js', 'task-dialog.js', 'task-order-audit.js']) {
    vm.runInContext(fs.readFileSync('sorter 2025/' + file, 'utf8'), c);
  }
  return c;
}
function seeded(seed = 1) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
const documentFor = n => 'Входящая\n\nINBOX SORTED\nНовая партия\n\nSORTED (2026.10.21)\n'
  + Array.from({ length: n }, (_, i) => 'Задача ' + (i + 1)).join('\n\n')
  + '\n\nPARTIALLY SORTED (2026.10.21)\nЧастичная\n\nIGNORED TASKS (2026.10.21)\nИгнорируемая';
const c = runtime();
const audit = c.TaskOrderAudit;
const source = documentFor(100);
for (let seed = 1; seed <= 12; seed++) {
  const plan = audit.plan(source, { random: seeded(seed) });
  assert.equal(plan.total, 100);
  assert.equal(plan.pairs.length, 8);
  assert.equal(new Set(plan.pairs.map(audit.pairKey)).size, 8);
  assert.deepEqual(Array.from(['adjacent', 'nearby', 'distant'], kind => plan.pairs.filter(p => p.kind === kind).length), [4, 2, 2]);
  for (const pair of plan.pairs) {
    assert(pair.left.position < pair.right.position);
    const gap = pair.right.position - pair.left.position;
    if (pair.kind === 'adjacent') assert.equal(gap, 1);
    if (pair.kind === 'nearby') assert(gap >= 2 && gap <= 5);
    if (pair.kind === 'distant') assert(gap >= 34);
    assert.match(pair.left.line, /^Задача /);
    assert.match(pair.right.line, /^Задача /);
  }
  const adjacent = plan.pairs.filter(p => p.kind === 'adjacent');
  assert(adjacent[0].left.position <= 25 && adjacent[3].left.position >= 75, 'Sample spans the list');
}
for (let n = 0; n <= 6; n++) {
  const plan = audit.plan(documentFor(n), { random: () => 0 });
  assert.equal(plan.total, n);
  assert.equal(plan.pairs.length, n < 2 ? 0 : Math.min(8, n * (n - 1) / 2));
  assert.equal(new Set(plan.pairs.map(audit.pairKey)).size, plan.pairs.length);
}
const duplicates = 'SORTED (2026.10.21)\nx 2026-10-21 Выполнена\nТа же задача\nX 2026-10-21 Выполнена ещё\nТа же задача';
const duplicatePlan = audit.plan(duplicates);
assert.equal(duplicatePlan.total, 2);
assert.equal(duplicatePlan.pairs[0].left.position, 2);
assert.equal(duplicatePlan.pairs[0].right.position, 4);
assert.equal(duplicatePlan.pairs[0].left.line, duplicatePlan.pairs[0].right.line, 'Do not deduplicate task occurrences');
assert.throws(() => audit.plan('Только inbox'), /один основной блок/);
assert.throws(() => audit.plan('SORTED (2026.10.20)\nОдин\nSORTED (2026.10.21)\nДва'), /один основной блок/);
const first = audit.plan(source, { random: seeded() });
const excluded = new Set(first.pairs.map(audit.pairKey));
const second = audit.plan(source, { random: seeded(), exclude: excluded });
assert.equal(second.pairs.length, 8);
assert(second.pairs.every(pair => !excluded.has(audit.pairKey(pair))), 'Next run uses unanswered pairs');

// Memory-only DOM/Swal interaction harness. The explicit Apply action is the
// only permitted write, and its old value is captured before replacement.
function uiRuntime(doc, choices, options = {}) {
  const c = runtime();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(id);
  };
  const editor = element('task-list'); editor.value = doc;
  const question = element('user-question'); question.value = '<img src=x onerror=alert(1)> Как важнее?';
  const button = element('check-order-button');
  const dialogs = [];
  const writes = [];
  let closeActive;
  const writesForbidden = () => { throw Error('Unexpected storage/cloud mutation'); };
  c.document = { getElementById: element };
  c.localStorage = { setItem: writesForbidden, removeItem: writesForbidden };
  c.SorterRuntime = { setTasks: writesForbidden, setItem: writesForbidden };
  c.fetch = writesForbidden;
  c.applyTaskListMutation = (proposal, reason) => {
    if (!options.apply) throw Error('Unexpected task-list mutation');
    writes.push({ before: editor.value, after: proposal.text, reason });
    editor.value = proposal.text;
    return proposal.changed;
  };
  c.Swal = {
    close() { closeActive({}); },
    fire(config) {
      dialogs.push(config);
      return new Promise((resolve, reject) => {
        closeActive = resolve;
        queueMicrotask(() => {
          try {
            if (!config.didOpen) {
              if (config.title === 'Результат проверки') options.onReport?.(editor);
              resolve({ isConfirmed: Boolean(options.apply && config.showConfirmButton) });
              return;
            }
            config.didOpen();
            options.onQuestion?.(dialogs.length, editor, question, button);
            const choice = choices.shift() ?? 'uncertain';
            if (choice === 'left' || choice === 'right') element('audit-' + choice).listeners.click();
            else resolve({ isConfirmed: choice === 'uncertain', isDismissed: choice === 'stop' });
          } catch (error) { reject(error); }
        });
      });
    },
  };
  vm.runInContext(fs.readFileSync('sorter 2025/task-order-audit-ui.js', 'utf8'), c);
  return { c, dialogs, editor, question, button, writes };
}

(async () => {
  let asked = 0;
  const result = await audit.run(first, async () => ['left', 'right', 'uncertain'][asked++ % 3]);
  assert.equal(asked, 8);
  assert.equal(result.answers.length, 8);
  assert.equal(result.conflicts.length, 3);
  assert.equal(result.uncertain, 2);
  const stopped = await audit.run(first, async () => null);
  assert(stopped.stopped && stopped.answers.length === 0);
  assert((await audit.run(first, async () => 'right', () => false)).stale);
  let current = true;
  const stale = await audit.run(first, async () => { current = false; return 'right'; }, () => current);
  assert(stale.stale && stale.answers.length === 0, 'Stale answer must not count');
  await assert.rejects(() => audit.run(first, async () => 'other'), /Неизвестный/);
  asked = 0;
  await audit.run({ pairs: [...first.pairs, ...first.pairs] }, async () => { asked++; return 'left'; });
  assert.equal(asked, 8, 'Hard cap even for an oversized sample');

  const ui = uiRuntime(source, ['left', 'right', 'uncertain', 'stop']);
  await ui.button.listeners.click();
  assert.equal(ui.editor.value, source);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.dialogs.filter(d => d.didOpen).length, 4);
  assert.match(ui.dialogs.at(-1).html, /Проверено пар: 3/);
  assert.match(ui.dialogs.at(-1).html, /Найдены нарушения порядка: 1/);
  assert.match(ui.dialogs.at(-1).html, /завершена досрочно/);
  assert.match(ui.dialogs.at(-1).html, /Показать предлагаемый порядок/);
  assert.equal(ui.dialogs.at(-1).showConfirmButton, true);
  assert.match(ui.dialogs.at(-1).customClass.confirmButton, /task-dialog__action--primary/);
  assert.equal(ui.writes.length, 0, 'Closing a report never applies votes');
  assert.equal(ui.dialogs[0].titleText, ui.question.value, 'Custom criterion uses text, never raw title HTML');
  assert.match(ui.dialogs.at(-1).html, /Спорные пары/);
  for (const dialog of ui.dialogs) {
    assert.doesNotMatch(dialog.html || '', /позици/i, 'No task positions in comparison or report');
    assert.equal(dialog.customClass.popup, 'task-dialog', 'All states share one CSS component');
    assert.equal(dialog.background, undefined);
    assert.equal(dialog.color, undefined);
  }
  const tagged = uiRuntime('SORTED (2026.10.21)\nЗадача один @дом +быт #тест\nЗадача три @телефон +связь #короткое', ['right']);
  await tagged.button.listeners.click();
  for (const dialog of tagged.dialogs) {
    assert.match(dialog.html, /t-ctx/);
    assert.match(dialog.html, /t-proj/);
    assert.match(dialog.html, /t-hash/);
    assert.match(dialog.html, /task-dialog__task-body/);
    assert.doesNotMatch(dialog.html, /style=/);
  }
  assert(tagged.dialogs[0].html.indexOf('@дом') < tagged.dialogs[0].html.indexOf('Задача один'), 'Tags lead the task text');

  const noErrors = uiRuntime(source, Array(8).fill('left'));
  await noErrors.button.listeners.click();
  assert.match(noErrors.dialogs.at(-1).html, /В проверенных парах нарушений не найдено/);
  assert.equal(noErrors.dialogs.at(-1).confirmButtonText, 'Закрыть');
  assert.equal(noErrors.dialogs.at(-1).showCancelButton, false);
  const uncertain = uiRuntime(source, Array(8).fill('uncertain'));
  await uncertain.button.listeners.click();
  assert.match(uncertain.dialogs.at(-1).html, /Нет определённых ответов/);
  const empty = uiRuntime(documentFor(1), []);
  await empty.button.listeners.click();
  assert.equal(empty.dialogs.length, 1);
  assert.match(empty.dialogs[0].text, /хотя бы две/);
  const changed = uiRuntime(source, ['right'], { onQuestion(_step, editor) { editor.value += '\nНовая запись'; } });
  await changed.button.listeners.click();
  assert.match(changed.dialogs.at(-1).html, /Список или вопрос сравнения изменился/);
  assert.match(changed.dialogs.at(-1).html, /Проверено пар: 0/);
  assert(changed.editor.value.endsWith('Новая запись'), 'Never overwrite an external edit');
  const unsafe = uiRuntime('SORTED (2026.10.21)\n<img src=x onerror=alert(1)>\nВторая', ['right']);
  await unsafe.button.listeners.click();
  for (const dialog of unsafe.dialogs) assert(!dialog.html?.includes('<img'), 'Task HTML is escaped by shared renderer');
  const tiny = 'Входящая\n\nSORTED (2026.10.21)\nПервая @дом\n\nВторая +дела\n\nIGNORED TASKS (2026.10.20)\nИгнорируемая';
  const applied = uiRuntime(tiny, ['right'], { apply: true });
  await applied.button.listeners.click();
  assert.equal(applied.writes.length, 1, 'Apply writes exactly once');
  assert.equal(applied.writes[0].before, tiny, 'Existing snapshot path receives the original value');
  assert.match(applied.writes[0].reason, /перестановкой SORTED/);
  assert.equal(applied.editor.value, tiny.replace('Первая @дом\n\nВторая +дела', 'Вторая +дела\n\nПервая @дом'));
  assert.equal(applied.dialogs.at(-1).title, 'Порядок сохранён');
  const changedInReport = uiRuntime(tiny, ['right'], { apply: true,
    onReport(editor) { editor.value += '\nЕщё задача'; },
  });
  await changedInReport.button.listeners.click();
  assert.equal(changedInReport.writes.length, 0, 'A document edited after voting is not overwritten');
  assert.equal(changedInReport.dialogs.at(-1).title, 'Список изменился');
  assert.equal(changedInReport.editor.value, tiny + '\nЕщё задача');
  assert.equal(source, documentFor(100));
  const html = fs.readFileSync('sorter 2025/index.html', 'utf8');
  assert.equal((html.match(/id="check-order-button"/g) || []).length, 1);
  const actions = html.match(/<div class="primary-actions"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.match(actions, /id="check-order-button"/, 'Audit inherits the same button group CSS');
  const dialogCss = fs.readFileSync('sorter 2025/task-dialog.css', 'utf8');
  assert.match(dialogCss, /--task-dialog-font-size: 1rem/);
  assert.match(dialogCss, /--task-dialog-control-height: 44px/);
  assert.match(fs.readFileSync('sorter 2025/style.css', 'utf8'), /\.primary-actions button \{ min-height: 44px/);
  assert(html.indexOf('task-format.js') < html.indexOf('src="task-order-audit.js'));
  assert(html.indexOf('src="task-order-audit.js') < html.indexOf('src="task-order-audit-ui.js'));
  console.log('PASS order audit: bounded sampling, metadata, real UI choices, preview, explicit Apply, snapshot input and stale-write guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
