// todotxt.js — парсер и рендер формата todo.txt

/**
 * Парсит одну строку todo.txt.
 * Возвращает объект с полями:
 *   raw, completed, priority, completionDate, creationDate,
 *   text, projects, contexts, tags
 */
function parseTodoLine(line) {
  return TaskFormat.parseTaskLine(line);
}

/**
 * Сериализует объект задачи обратно в строку todo.txt.
 */
function serializeTodo(todo) {
  return TaskFormat.serializeTaskLine(todo);
}

/**
 * Экранирует HTML-спецсимволы.
 */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Подсвечивает строку todo.txt как HTML-фрагмент.
 */
function highlightTodoLine(line) {
  if (!line.trim()) return '&nbsp;';

  // Комментарии-разделители из единого справочника маркеров
  if (MARKERS.isAnyMarker(line)) {
    return `<span class="todo-section">${escHtml(line)}</span>`;
  }

  const todo = parseTodoLine(line);
  // Strip hidden note ⟦...⟧ from display
  const displayLine = line.replace(/\s*\u27e6[\s\S]*\u27e7/, '');
  let html = escHtml(displayLine);

  if (todo.completed) {
    return `<span class="todo-done">${html}</span>`;
  }

  // Подсвечиваем last-to-first чтобы не ломать индексы
  // Используем замену по regex на финальной строке
  html = escHtml(displayLine);

  // priority (A)
  html = html.replace(/^\(([A-Z])\)/, (m, p) => {
    const cls = p <= 'C' ? `todo-priority-${p.toLowerCase()}` : 'todo-priority-other';
    return `<span class="${cls}">(${p})</span>`;
  });

  // due:date — подсветка если просрочено
  html = html.replace(/\bdue:(\d{4}-\d{2}-\d{2})\b/g, (m, d) => {
    const isOverdue = d < new Date().toISOString().slice(0, 10);
    const cls = isOverdue ? 'todo-overdue' : 'todo-due';
    return `<span class="${cls}">${m}</span>`;
  });

  // key:value (кроме due)
  html = html.replace(/\b(?!due:)([a-zA-Z][a-zA-Z0-9_-]*):([^\s<]+)/g,
    '<span class="todo-tag">$&</span>');

  // +project
  html = html.replace(/\+([^\s<]+)/g, '<span class="todo-project">+$1</span>');

  // @context
  html = html.replace(/@([^\s<]+)/g, '<span class="todo-context">@$1</span>');

  // #hashtag
  html = html.replace(/#([^\s<]+?)([.,;!?]*(?=\s|$|<))/g, '<span class="todo-hashtag">#$1</span>$2');

  // дата создания после приоритета
  html = html.replace(/(\d{4}-\d{2}-\d{2})/g, '<span class="todo-date">$1</span>');

  return html;
}

// ─── Слой подсветки ──────────────────────────────────────────────

let highlightEnabled = true;
let filterActive = false;

function buildHighlightLayer(text) {
  const lines = text.split('\n');
  return lines.map(l => highlightTodoLine(l)).join('\n');
}

function syncHighlight() {
  renderFilterBar();
}

// ─── Старый редактор задачи (сейчас не вызывается) ──────────────

/**
 * Открывает старый модальный редактор исходного текста и хэштегов.
 * Функция сохранена для будущей переработки, но её привязка к списку отключена
 * в initHighlight(): модальное окно мешало обычному выделению и копированию текста.
 */
async function showTaskEditor(lineIdx, lines) {
  const Swal = window.Swal;
  if (!Swal) return;

  const line = lines[lineIdx];
  const todo = parseTodoLine(line);
  const current = new Set(todo.hashtags);
  const allKnown = collectMeta().hashtags;
  const merged = [...new Set([...allKnown, ...current])].sort();

  const chipsHtml = merged.map(h =>
    `<button type="button" class="ht-chip${current.has(h) ? ' ht-chip--on' : ''}" data-ht="${escHtml(h)}">#${escHtml(h)}</button>`
  ).join('');

  const { value: result, isConfirmed } = await Swal.fire({
    title: 'Задача',
    html: `
      <div style="font-size:0.8rem;color:#888;margin-bottom:0.5rem;text-align:left">${escHtml(todo.text)}</div>
      <div style="font-size:0.75rem;color:#888;margin-bottom:0.4rem;text-align:left">Исходная задача</div>
      <textarea id="task-source" rows="3" placeholder="Текст до GTD-разбора" style="width:100%;box-sizing:border-box;background:#1e1e1e;color:#ccc;border:1px solid #333;border-radius:6px;padding:0.5rem;font-family:inherit;font-size:0.85rem;resize:vertical;margin-bottom:0.75rem">${escHtml(todo.source || '')}</textarea>
      <div style="font-size:0.75rem;color:#888;margin-bottom:0.4rem;text-align:left"># Хэштеги</div>
      <div id="ht-chips" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem;min-height:1.5rem">${chipsHtml}</div>
      <input id="ht-new" class="swal2-input" placeholder="Новый тег (без #)" style="margin:0;width:100%;box-sizing:border-box">`,
    showCancelButton: true,
    confirmButtonText: 'Сохранить',
    cancelButtonText: 'Отмена',
    didOpen: () => {
      document.querySelectorAll('.ht-chip').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('ht-chip--on'));
      });
    },
    preConfirm: () => {
      const active = new Set(
        [...document.querySelectorAll('.ht-chip.ht-chip--on')].map(b => b.dataset.ht)
      );
      const newTag = (document.getElementById('ht-new')?.value || '').trim().replace(/^#/, '');
      if (newTag) active.add(newTag);
      const source = (document.getElementById('task-source')?.value || '').trim();
      return { hashtags: active, source };
    },
  });

  if (!isConfirmed) return;

  todo.hashtags = [...result.hashtags];
  todo.source = result.source || null;
  lines[lineIdx] = serializeTodo(todo);

  const ta = document.getElementById('task-list');
  ta.value = lines.join('\n');
  syncHighlight();
  saveDataToLocalStorage();
  renderFilterBar();
}

// ─── Инициализация подсветки ─────────────────────────────────────

function initHighlight() {
  const ta = document.getElementById('task-list');
  if (!ta) return;
  ta.addEventListener('input', renderFilterBar);

  /*
   * Намеренно отключено: этот обработчик открывал старый showTaskEditor поверх
   * списка и мешал выделять, копировать и вырезать текст. Код оставлен рядом,
   * чтобы редактор можно было переработать позже и вернуть только через явную
   * кнопку, не перехватывающую клики мыши внутри textarea.
   *
   * ta.addEventListener('contextmenu', async (e) => {
   *   e.preventDefault();
   *   const pos = ta.selectionStart;
   *   const lines = ta.value.split('\n');
   *   let charCount = 0, lineIdx = 0;
   *   for (let i = 0; i < lines.length; i++) {
   *     if (charCount + lines[i].length >= pos) { lineIdx = i; break; }
   *     charCount += lines[i].length + 1;
   *   }
   *   const line = lines[lineIdx]?.trim();
   *   if (!line || MARKERS.isAnyMarker(line)) return;
   *   await showTaskEditor(lineIdx, lines);
   * });
   */
}

// ─── Авто-приоритеты ─────────────────────────────────────────────

/**
 * Проходит по строкам выше маркера ИГНОРИРУЕМЫЕ ЗАДАЧИ
 * и назначает (A)(B)(C)… по порядку.
 * Уже выполненные задачи (x ...) пропускает.
 */
function assignPrioritiesAfterSort() {
  const ta = document.getElementById('task-list');
  const lines = ta.value.split('\n');

  // Приоритеты назначаем только секции SORTED (между маркером SORTED и следующим маркером).
  // Если маркера SORTED нет — ничего не делаем, чтобы случайно не затронуть PARTIALLY SORTED
  // и ИГНОРИРУЕМЫЕ ЗАДАЧИ секции.
  const iSorted = lines.findIndex(l => MARKERS.isSorted(l));
  const iEnd    = lines.findIndex(l => MARKERS.isSortedEnd(l));

  if (iSorted === -1) return; // нет SORTED-маркера — не трогаем ничего

  const start = iSorted + 1;
  const end   = iEnd > -1 ? iEnd : lines.length;

  let letterCode = 65; // 'A'
  const result = lines.map((line, idx) => {
    if (idx < start || idx >= end) return line;
    const trimmed = line.trim();
    if (!trimmed || MARKERS.isAnyMarker(trimmed)) {
      return line;
    }
    if (/^x /.test(trimmed)) return line;
    const withoutPriority = trimmed.replace(/^\([A-Z]\) /, '');
    let prefix = '';
    if (letterCode <= 90) {
      prefix = `(${String.fromCharCode(letterCode++)}) `;
    }
    return prefix + withoutPriority;
  });

  ta.value = result.join('\n');
  syncHighlight();
  saveDataToLocalStorage();
}

// ─── Отметить выполненным / снять отметку ────────────────────────

function toggleDoneCurrentLine() {
  const ta = document.getElementById('task-list');
  const pos = ta.selectionStart;
  const lines = ta.value.split('\n');

  let charCount = 0;
  let lineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= pos) { lineIdx = i; break; }
    charCount += lines[i].length + 1;
  }

  const line = lines[lineIdx];
  const today = new Date().toISOString().slice(0, 10);

  if (/^x /.test(line)) {
    // снять отметку — убрать "x DATE " или просто "x "
    lines[lineIdx] = line.replace(/^x \d{4}-\d{2}-\d{2} /, '').replace(/^x /, '');
  } else {
    // поставить отметку
    // убираем приоритет
    const withoutPriority = line.replace(/^\([A-Z]\) /, '');
    lines[lineIdx] = `x ${today} ${withoutPriority}`;
  }

  ta.value = lines.join('\n');
  syncHighlight();
  saveDataToLocalStorage();
}

// ─── Фильтр строк ────────────────────────────────────────────────

let currentFilter = { project: null, context: null, priority: null, hashtag: null };

// Строки видимые в filter-view; используются кнопками действия в строке
let filteredLines = [];

function applyFilter() {
  const ta = document.getElementById('task-list');
  if (!ta) return;

  const { project, context, priority, hashtag } = currentFilter;
  if (!project && !context && !priority && !hashtag) {
    filterActive = false;
    ta.style.display = '';
    document.getElementById('filter-view')?.remove();
    filteredLines = [];
    return;
  }

  filterActive = true;
  ta.style.display = 'none';

  const lines = ta.value.split('\n');
  filteredLines = lines.filter(line => {
    if (!line.trim()) return false;
    const todo = parseTodoLine(line);
    if (project  && !todo.projects.includes(project))    return false;
    if (context  && !todo.contexts.includes(context))    return false;
    if (priority && todo.priority !== priority)           return false;
    if (hashtag  && !todo.hashtags.includes(hashtag))    return false;
    return true;
  });

  let fv = document.getElementById('filter-view');
  if (!fv) {
    fv = document.createElement('div');
    fv.id = 'filter-view';
    fv.className = 'filter-view';
    ta.parentNode.insertBefore(fv, ta.nextSibling);
    fv.addEventListener('click', _filterViewDelegate);
  }
  fv.innerHTML = filteredLines.length
    ? filteredLines.map((l, i) => {
        const enc = encodeURIComponent(l.trim());
        const processHref = SorterRuntime.withMode('process.html?task=' + enc);
        const todoP = parseTodoLine(l);
        const done = todoP.completed;
        return '<div class="filter-row">'
          + '<div class="filter-row-text">'
          + TaskFormat.renderTaskContentHtml(todoP, { variant: 'list' })
          + TaskFormat.renderTaskMetaHtml(todoP)
          + '</div>'
          + '<span class="filter-row-actions">'
          + '<a href="' + processHref + '" class="frow-btn" title="GTD разбор">GTD</a>'
          + '<button class="frow-btn" onclick="filterRowToggleDone(' + i + ')" title="' + (done ? 'Снять отметку' : 'Выполнено') + '">' + (done ? '\u21A9' : '\u2713') + '</button>'
          + '</span></div>';
      }).join('')
    : '<div class="filter-empty">Задач не найдено</div>';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _filterViewDelegate(e) {
  const span = e.target.closest('.todo-hashtag, .todo-project, .todo-context');
  if (!span) return;
  if (span.classList.contains('todo-hashtag')) {
    const h = span.textContent.slice(1);
    currentFilter.hashtag = currentFilter.hashtag === h ? null : h;
  } else if (span.classList.contains('todo-project')) {
    const p = span.textContent.slice(1);
    currentFilter.project = currentFilter.project === p ? null : p;
  } else if (span.classList.contains('todo-context')) {
    const c = span.textContent.slice(1);
    currentFilter.context = currentFilter.context === c ? null : c;
  }
  renderFilterBar();
  applyFilter();
}

// Кнопка «✓/↩» в строке фильтра
function filterRowToggleDone(idx) {
  const ta = document.getElementById('task-list');
  const rawLine = filteredLines[idx];
  if (rawLine === undefined) return;
  const lines = ta.value.split('\n');
  const lineIdx = lines.indexOf(rawLine);
  if (lineIdx === -1) return;
  const today = new Date().toISOString().slice(0, 10);
  const todo = parseTodoLine(rawLine);
  lines[lineIdx] = todo.completed
    ? rawLine.replace(/^x \d{4}-\d{2}-\d{2} /, '')
    : 'x ' + today + ' ' + rawLine;
  ta.value = lines.join('\n');
  saveDataToLocalStorage();
  applyFilter();
}

function clearFilter() {
  currentFilter = { project: null, context: null, priority: null, hashtag: null };
  document.querySelectorAll('.filter-chip.active').forEach(el => el.classList.remove('active'));
  applyFilter();
}

/**
 * Собирает все уникальные проекты, контексты, приоритеты из textarea.
 */
function collectMeta() {
  const ta = document.getElementById('task-list');
  const projects = new Set(), contexts = new Set(), priorities = new Set(), hashtags = new Set();
  ta.value.split('\n').forEach(line => {
    const t = parseTodoLine(line);
    t.projects.forEach(p => projects.add(p));
    t.contexts.forEach(c => contexts.add(c));
    t.hashtags.forEach(h => hashtags.add(h));
    if (t.priority) priorities.add(t.priority);
  });
  return { projects: [...projects].sort(), contexts: [...contexts].sort(), priorities: [...priorities].sort(), hashtags: [...hashtags].sort() };
}

function renderFilterBar() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  const { projects, contexts, priorities, hashtags } = collectMeta();

  let html = '<button class="filter-chip filter-clear" id="filter-clear-btn">&#x2715; Сбросить</button>';

  priorities.forEach(p => {
    const cls = `todo-priority-${p <= 'C' ? p.toLowerCase() : 'other'}`;
    html += `<button class="filter-chip ${cls}" data-priority="${p}">(${p})</button>`;
  });
  projects.forEach(p => {
    html += `<button class="filter-chip todo-project" data-project="${p}">+${p}</button>`;
  });
  contexts.forEach(c => {
    html += `<button class="filter-chip todo-context" data-context="${c}">@${c}</button>`;
  });
  hashtags.forEach(h => {
    html += `<button class="filter-chip todo-hashtag" data-hashtag="${h}">#${h}</button>`;
  });

  bar.innerHTML = html;

  bar.querySelectorAll('[data-priority]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.priority;
      currentFilter.priority = currentFilter.priority === p ? null : p;
      btn.classList.toggle('active', currentFilter.priority === p);
      applyFilter();
    });
  });
  bar.querySelectorAll('[data-project]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.project;
      currentFilter.project = currentFilter.project === p ? null : p;
      btn.classList.toggle('active', currentFilter.project === p);
      applyFilter();
    });
  });
  bar.querySelectorAll('[data-context]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.context;
      currentFilter.context = currentFilter.context === c ? null : c;
      btn.classList.toggle('active', currentFilter.context === c);
      applyFilter();
    });
  });
  bar.querySelectorAll('[data-hashtag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = btn.dataset.hashtag;
      currentFilter.hashtag = currentFilter.hashtag === h ? null : h;
      btn.classList.toggle('active', currentFilter.hashtag === h);
      applyFilter();
    });
  });
  document.getElementById('filter-clear-btn')?.addEventListener('click', clearFilter);
}

// ─── Инициализация ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initHighlight();
  renderFilterBar();

  // Кнопка "Отметить выполненным"
  document.getElementById('done-button')?.addEventListener('click', toggleDoneCurrentLine);

  // Кнопка "Приоритеты" (ручная)
  document.getElementById('assign-priorities-btn')?.addEventListener('click', assignPrioritiesAfterSort);

  // Кнопка "⚡ Быстрый разбор" — КОРЗИНА через SweetAlert2, без смены страницы
  document.getElementById('quick-triage-btn')?.addEventListener('click', quickTriageCurrentTask);

  document.getElementById('delegate-ai-button')?.addEventListener('click', async () => {
    const ta = document.getElementById('task-list');
    const pos = ta.selectionStart;
    const lines = ta.value.split('\n');
    let offset = 0;
    const line = lines.find(value => {
      const containsCursor = offset + value.length + 1 > pos;
      offset += value.length + 1;
      return containsCursor;
    });
    const task = line?.trim();
    if (!task || MARKERS.isAnyMarker(task)) {
      Swal.fire({ title: 'Нет задачи', text: 'Поставьте курсор на строку с задачей.', icon: 'info' });
      return;
    }
    await window.SorterAiDropbox.showDelegateDialog(task);
  });

  document.getElementById('ai-jobs-btn')?.addEventListener('click', () => {
    window.SorterAiDropbox.showJobsDialog();
  });

  // Кнопка "Обработать задачу" → открыть GTD-страницу
  document.getElementById('process-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('task-list');
    const pos = ta.selectionStart;
    const lines = ta.value.split('\n');
    let charCount = 0, lineIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= pos) { lineIdx = i; break; }
      charCount += lines[i].length + 1;
    }
    const taskText = lines[lineIdx].trim();
    const encoded = encodeURIComponent(taskText);
    window.location.href = SorterRuntime.withMode(`process.html?task=${encoded}`);
  });
});

// ==========================================================================
// Быстрый разбор задачи прямо со страницы (без перехода на process.html).
// Запускает упрощённый КОРЗИНА-флоу через SweetAlert2.
// ==========================================================================
async function quickTriageCurrentTask() {
  const Swal = window.Swal;
  if (!Swal) { alert('SweetAlert2 не загружен'); return; }

  const ta = document.getElementById('task-list');
  const pos = ta.selectionStart;
  const lines = ta.value.split('\n');
  let charCount = 0, lineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= pos) { lineIdx = i; break; }
    charCount += lines[i].length + 1;
  }
  const task = lines[lineIdx]?.trim();
  if (!task) {
    Swal.fire({ title: 'Нет задачи', text: 'Поставь курсор на строку с задачей', icon: 'info', confirmButtonText: 'Ок' });
    return;
  }

  // Шаг 1: Действия нужны?
  const r1 = await Swal.fire({
    title: task,
    html: '<div style="font-size:1.05rem;font-weight:600;margin:0.5rem 0">С этим надо что-то делать?</div>',
    showConfirmButton: true, showDenyButton: true, showCancelButton: true,
    confirmButtonText: '✔ Да',
    denyButtonText:    '✘ Нет',
    cancelButtonText:  '← Отмена',
  });
  if (r1.isDismissed) return;

  if (r1.isDenied) {
    // Не нужны → выбрать судьбу
    const rna = await Swal.fire({
      title: 'Что сделать?',
      showConfirmButton: true, showDenyButton: true, showCancelButton: true,
      confirmButtonText: '💡 Когда-нибудь',
      denyButtonText:    '📂 Справочная',
      cancelButtonText:  '🗑 Удалить',
    });
    const today = new Date().toISOString().slice(0, 10);
    if      (rna.isConfirmed)                                        lines[lineIdx] = task + ' someday:yes';
    else if (rna.isDenied)                                           lines[lineIdx] = task + ' ref:yes';
    else if (rna.dismiss === Swal.DismissReason.cancel)              lines.splice(lineIdx, 1);
    else                                                             return;
    _updateTaskArea(ta, lines);
    return;
  }

  // Шаг 2: < 2 минут?
  const r2 = await Swal.fire({
    title: task,
    html: '<div style="font-size:1.05rem;font-weight:600;margin:0.5rem 0">Займёт меньше 2 минут?</div>',
    showConfirmButton: true, showDenyButton: true, showCancelButton: true,
    confirmButtonText: '⚡ Да — сделаю сейчас',
    denyButtonText:    '📋 Нет — в список',
    cancelButtonText:  '← Назад',
  });
  if (r2.isDismissed) return;

  if (r2.isConfirmed) {
    const today = new Date().toISOString().slice(0, 10);
    lines[lineIdx] = 'x ' + today + ' ' + task;
    _updateTaskArea(ta, lines);
  } else {
    // Подробный разбор на странице GTD
    window.location.href = SorterRuntime.withMode('process.html?task=' + encodeURIComponent(task));
  }
}

function _updateTaskArea(ta, lines) {
  ta.value = lines.join('\n');
  saveDataToLocalStorage();
  renderFilterBar();
}
