const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync('sorter 2025/' + name, 'utf8');

function declaration(file, name) {
  const source = read(file);
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert(start >= 0, name);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let i = opening; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw Error('Missing declaration ' + name);
}

// Memory-only fixture. Run the actual dialog handlers without storage or a
// sorting mock. These contracts are locked before changing presentation.
function runtime(action, edited) {
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, {
      value: '', innerHTML: '', listeners: {}, classList: { add() {} },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      insertBefore() {},
    });
    return elements.get(key);
  };
  const input = element('input');
  const configs = [];
  let resolveActive, active;
  const c = vm.createContext({ console, queueMicrotask,
    counter: 0, userQuestion: { value: '<b>Какую раньше?</b>' },
    esc: text => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    document: {
      addEventListener() {},
      getElementById: element,
      querySelector: element,
      createElement: () => element('done'),
    },
    Swal: {
      getInput: () => input,
      getHtmlContainer: () => ({ querySelector: element }),
      close() { active.willClose?.(); resolveActive({}); },
      fire(config) {
        active = config; configs.push(config);
        input.value = config.inputValue;
        return new Promise((resolve, reject) => {
          resolveActive = resolve;
          queueMicrotask(() => {
            try {
              config.didOpen?.();
              if (edited !== undefined) {
                input.value = edited;
                input.listeners.input?.();
              }
              if (action === 'include') resolve({ value: config.preConfirm(input.value) });
              else if (action === 'ignore') resolve({ value: config.preDeny(input.value) });
              else if (action === 'delete') resolve({ isDismissed: true });
              else if (action === 'cancel') { config.willClose?.(); resolve({ isDismissed: true }); }
              else element(action).listeners.click();
            } catch (error) { reject(error); }
          });
        });
      },
    },
  });
  for (const file of ['markers.js', 'task-format.js']) vm.runInContext(read(file), c);
  if (fs.existsSync('sorter 2025/task-dialog.js')) vm.runInContext(read('task-dialog.js'), c);
  vm.runInContext(declaration('app.js', 'compareTasks') + '\n' + declaration('app.js', 'chooseWindow')
    + '\n' + declaration('tasks-page.js', 'compareTaskRank'), c);
  return { c, configs, input, elements };
}

(async () => {
  for (const [button, answer] of [['#swal-btn1', -1], ['#swal-btn2', 1]]) {
    const r = runtime(button);
    const progress = { done: 2, expected: 8, tasksDone: 1, tasksTotal: 3 };
    assert.equal(await r.c.compareTasks('Первая @дом +быт #тест', 'Вторая @ноут +дела #ещё', progress), answer);
    assert.equal(r.c.counter, 1);
    assert.equal(progress.done, 3);
    assert.equal(r.configs[0].allowOutsideClick, false);
    assert.equal(r.configs[0].allowEscapeKey, false);
  }
  for (const action of ['include', 'ignore', 'delete', 'done']) {
    const r = runtime(action === 'done' ? 'done' : action, 'Отредактирована @телефон +дела #тест');
    const result = await r.c.chooseWindow('Исходная @дом', { current: 2, total: 5 });
    assert.equal(result.action, action);
    assert.equal(result.text, 'Отредактирована @телефон +дела #тест');
    assert.equal(r.configs[0].inputValue, 'Исходная @дом');
    assert.equal(r.configs[0].allowEscapeKey, false);
  }
  for (const action of ['include', 'ignore', 'delete', 'done']) {
    const r = runtime(action === 'done' ? 'done' : action, '   ');
    const result = await r.c.chooseWindow('Исходная @дом');
    assert.equal(result.text, 'Исходная @дом', 'Empty editing retains the original task');
  }
  for (const [button, answer] of [['rank-candidate', -1], ['rank-existing', 1]]) {
    const r = runtime(button);
    assert.equal(await r.c.compareTaskRank('Первая @дом +быт #тест', 'Вторая @ноут +дела #ещё', {}), answer);
  }
  const cancelled = runtime('cancel');
  await assert.rejects(cancelled.c.compareTaskRank('Первая', 'Вторая', {}), { name: 'AbortError' });
  // Every mode gets precisely the same card, not a separately reimplemented
  // metadata layout. Long tokens and user HTML remain safe selectable text.
  const line = '(B) 2026-09-01 Текст <img src=x onerror=alert(1)> https://example.com @дом +быт #тест due:2026-12-31';
  for (const mode of ['compare', 'rank', 'filter']) {
    const r = runtime(mode === 'compare' ? '#swal-btn1' : mode === 'rank' ? 'rank-candidate' : 'include', line);
    if (mode === 'compare') await r.c.compareTasks(line, line);
    if (mode === 'rank') await r.c.compareTaskRank(line, line, { comparison: 2, maxComparisons: 4 });
    if (mode === 'filter') await r.c.chooseWindow(line);
    const config = r.configs[0];
    assert.equal(config.customClass.popup, 'task-dialog');
    assert.equal(config.buttonsStyling, false);
    const id = mode === 'compare' ? 'swal-btn1' : mode === 'rank' ? 'rank-candidate' : null;
    assert(config.html.includes(r.c.TaskDialog.renderTask(line, { choiceId: id })), mode + ' must use shared card');
    assert.doesNotMatch(config.html, /<img|style=/);
    for (const marker of ['t-ctx', 't-proj', 't-hash', 't-due', 't-created']) assert(config.html.includes(marker));
    assert(config.html.indexOf('@дом') < config.html.indexOf('Текст'));
    assert.match(config.html, /target="_blank" rel="noopener noreferrer"/);
    if (id) assert.match(config.html, new RegExp(`aria-describedby="${id}-description"`));
    if (mode === 'compare') assert.equal(config.titleText, '1. <b>Какую раньше?</b>');
    if (mode === 'filter') assert.equal(r.elements.get('filter-task-preview').innerHTML, r.c.TaskDialog.renderTask(line));
  }
  const longTask = 'Длинная задача '.repeat(100) + '@' + 'длинный-контекст'.repeat(20) + ' +проект #тест';
  const rendered = cancelled.c.TaskDialog.renderTask(longTask);
  assert.match(rendered, /t-ctx/);
  assert(rendered.includes('Длинная задача '.repeat(100).trim()), 'Never truncate long task text');
  const first = cancelled.c.TaskDialog.options();
  first.customClass.popup = 'changed';
  assert.equal(cancelled.c.TaskDialog.options().customClass.popup, 'task-dialog');
  for (const page of ['index.html', 'tasks.html']) {
    const html = read(page);
    assert.equal((html.match(/src="task-dialog.js\?/g) || []).length, 1);
    assert.equal((html.match(/href="task-dialog.css\?/g) || []).length, 1);
    assert(html.indexOf('src="task-format.js') < html.indexOf('src="task-dialog.js'));
    assert(html.indexOf('src="task-dialog.js') < html.indexOf(page === 'index.html' ? 'src="app.js' : 'src="tasks-page.js'));
  }
  assert.doesNotMatch(read('tasks.css'), /rank-choice|rank-dialog/);
  assert.doesNotMatch(read('style.css'), /filter-task-actions/);
  console.log('PASS task-dialog: both comparison results, counters/progress, all four filter actions, edited/empty text, ranking and cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
