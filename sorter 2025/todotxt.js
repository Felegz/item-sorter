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
  if (/^(ИГНОРИРУЕМЫЕ ЗАДАЧИ|NEW ARRAY|НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ)/i.test(line.trim())) {
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
  const splitIdx = lines.findIndex(l => l.startsWith('ИГНОРИРУЕМЫЕ ЗАДАЧИ'));

  const toProcess = splitIdx > -1 ? lines.slice(0, splitIdx) : lines.slice();
  const rest      = splitIdx > -1 ? lines.slice(splitIdx) : [];

  let letterCode = 65; // 'A'
  const result = toProcess.map(line => {
    const trimmed = line.trim();
    if (!trimmed || /^(ИГНОРИРУЕМЫЕ ЗАДАЧИ|NEW ARRAY|НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ)/i.test(trimmed)) {
      return line;
    }
    // Пропускаем выполненные
    if (/^x /.test(trimmed)) return line;

    // Удаляем старый приоритет если есть
    const withoutPriority = trimmed.replace(/^\([A-Z]\) /, '');

    let prefix = '';
    if (letterCode <= 90) { // до Z
      prefix = `(${String.fromCharCode(letterCode++)}) `;
    }
    return prefix + withoutPriority;
  });

  ta.value = [...result, ...rest].join('\n');
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

function applyFilter() {
  const ta = document.getElementById('task-list');
  const hl = document.getElementById('hl-layer');
  if (!hl) return;

  const { project, context, priority } = currentFilter;
  if (!project && !context && !priority) {
    filterActive = false;
    ta.style.display = '';
    document.getElementById('filter-view')?.remove();
    return;
  }

  filterActive = true;
  ta.style.display = 'none'; // прячем textarea, показываем фильтр

  const lines = ta.value.split('\n');
  const filtered = lines.filter(line => {
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
  fv.innerHTML = filtered.length
    ? filtered.map(l => `<div class="filter-row">${highlightTodoLine(l)}</div>`).join('')
    : '<div class="filter-empty">Задач не найдено</div>';
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
