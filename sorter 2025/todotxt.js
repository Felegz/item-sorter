// todotxt.js — парсер и рендер формата todo.txt

/**
 * Парсит одну строку todo.txt.
 * Возвращает объект с полями:
 *   raw, completed, priority, completionDate, creationDate,
 *   text, projects, contexts, tags
 */
function parseTodoLine(line) {
  const raw = line;
  let rest = line;
  let completed = false;
  let priority = null;
  let completionDate = null;
  let creationDate = null;

  // x (completed)
  if (/^x /.test(rest)) {
    completed = true;
    rest = rest.slice(2).trim();
    // completion date
    const dMatch = rest.match(/^(\d{4}-\d{2}-\d{2}) /);
    if (dMatch) {
      completionDate = dMatch[1];
      rest = rest.slice(dMatch[0].length);
    }
  }

  // priority (only if not completed)
  if (!completed) {
    const pMatch = rest.match(/^\(([A-Z])\) /);
    if (pMatch) {
      priority = pMatch[1];
      rest = rest.slice(pMatch[0].length);
    }
  }

  // creation date
  const cdMatch = rest.match(/^(\d{4}-\d{2}-\d{2}) /);
  if (cdMatch) {
    creationDate = cdMatch[1];
    rest = rest.slice(cdMatch[0].length);
  }

  const text = rest;

  // extract +projects, @contexts, key:value tags
  const projects = [];
  const contexts = [];
  const tags = {};
  const words = text.split(/\s+/);
  for (const word of words) {
    if (word.startsWith('+') && word.length > 1) projects.push(word.slice(1));
    else if (word.startsWith('@') && word.length > 1) contexts.push(word.slice(1));
    else {
      const kv = word.match(/^([a-zA-Z][a-zA-Z0-9_-]*):([^\s]+)$/);
      if (kv) tags[kv[1]] = kv[2];
    }
  }

  return { raw, completed, priority, completionDate, creationDate, text, projects, contexts, tags };
}

/**
 * Сериализует объект задачи обратно в строку todo.txt.
 */
function serializeTodo(todo) {
  let parts = [];
  if (todo.completed) {
    parts.push('x');
    if (todo.completionDate) parts.push(todo.completionDate);
  } else {
    if (todo.priority) parts.push(`(${todo.priority})`);
  }
  if (todo.creationDate) parts.push(todo.creationDate);
  parts.push(todo.text);
  return parts.join(' ');
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

  // Комментарии-разделители (типа "ИГНОРИРУЕМЫЕ ЗАДАЧИ..." и "NEW ARRAY")
  if (/^(ИГНОРИРУЕМЫЕ ЗАДАЧИ|NEW ARRAY|НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ|PARTIALLY SORTED|SORTED\s*\()/i.test(line.trim())) {
    return `<span class="todo-section">${escHtml(line)}</span>`;
  }

  const todo = parseTodoLine(line);
  let html = escHtml(line);

  if (todo.completed) {
    return `<span class="todo-done">${html}</span>`;
  }

  // Подсвечиваем last-to-first чтобы не ломать индексы
  // Используем замену по regex на финальной строке
  html = escHtml(todo.raw);

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

// ─── Инициализация подсветки ─────────────────────────────────────

function initHighlight() {
  const ta = document.getElementById('task-list');
  if (!ta) return;
  ta.addEventListener('input', renderFilterBar);
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
  localStorage.setItem('tasks', ta.value);
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
  localStorage.setItem('tasks', ta.value);
}

// ─── Фильтр строк ────────────────────────────────────────────────

let currentFilter = { project: null, context: null, priority: null };

// Строки видимые в filter-view; используются кнопками действия в строке
let filteredLines = [];

function applyFilter() {
  const ta = document.getElementById('task-list');
  const hl = document.getElementById('hl-layer');
  if (!hl) return;

  const { project, context, priority } = currentFilter;
  if (!project && !context && !priority) {
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
    if (project  && !todo.projects.includes(project))   return false;
    if (context  && !todo.contexts.includes(context))   return false;
    if (priority && todo.priority !== priority)          return false;
    return true;
  });

  let fv = document.getElementById('filter-view');
  if (!fv) {
    fv = document.createElement('div');
    fv.id = 'filter-view';
    fv.className = 'filter-view';
    ta.parentNode.insertBefore(fv, ta.nextSibling);
  }
  fv.innerHTML = filteredLines.length
    ? filteredLines.map((l, i) => {
        // Split ➤цель: suffix for visual rendering (it stays on one line in storage)
        const SEP = '\u27A4\u0446\u0435\u043B\u044C:';
        const sepIdx = l.indexOf(SEP);
        const mainPart = sepIdx !== -1 ? l.slice(0, sepIdx).trim() : l;
        const goalPart = sepIdx !== -1 ? l.slice(sepIdx + SEP.length).trim() : null;

        const enc = encodeURIComponent(l.trim());
        const done = parseTodoLine(l).done;
        return '<div class="filter-row">'
          + '<span class="filter-row-text">'
          + highlightTodoLine(mainPart)
          + (goalPart ? '<span class="frow-goal">\uD83C\uDFAF ' + escHtml(goalPart) + '</span>' : '')
          + '</span>'
          + '<span class="filter-row-actions">'
          + '<a href="process.html?task=' + enc + '" class="frow-btn" title="GTD разбор">GTD</a>'
          + '<button class="frow-btn" onclick="filterRowToggleDone(' + i + ')" title="' + (done ? 'Снять отметку' : 'Выполнено') + '">' + (done ? '\u21A9' : '\u2713') + '</button>'
          + '</span></div>';
      }).join('')
    : '<div class="filter-empty">Задач не найдено</div>';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  lines[lineIdx] = todo.done
    ? rawLine.replace(/^x \d{4}-\d{2}-\d{2} /, '')
    : 'x ' + today + ' ' + rawLine;
  ta.value = lines.join('\n');
  localStorage.setItem('tasks', ta.value);
  applyFilter();
}

function clearFilter() {
  currentFilter = { project: null, context: null, priority: null };
  document.querySelectorAll('.filter-chip.active').forEach(el => el.classList.remove('active'));
  applyFilter();
}

/**
 * Собирает все уникальные проекты, контексты, приоритеты из textarea.
 */
function collectMeta() {
  const ta = document.getElementById('task-list');
  const projects = new Set(), contexts = new Set(), priorities = new Set();
  ta.value.split('\n').forEach(line => {
    const t = parseTodoLine(line);
    t.projects.forEach(p => projects.add(p));
    t.contexts.forEach(c => contexts.add(c));
    if (t.priority) priorities.add(t.priority);
  });
  return { projects: [...projects].sort(), contexts: [...contexts].sort(), priorities: [...priorities].sort() };
}

function renderFilterBar() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  const { projects, contexts, priorities } = collectMeta();

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
    window.location.href = `process.html?task=${encoded}`;
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
    window.location.href = 'process.html?task=' + encodeURIComponent(task);
  }
}

function _updateTaskArea(ta, lines) {
  ta.value = lines.join('\n');
  localStorage.setItem('tasks', ta.value);
  renderFilterBar();
}
