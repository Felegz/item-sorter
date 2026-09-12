// task-format.js — единая модель, сериализация и безопасный HTML-рендер задачи.
(function initTaskFormat(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TaskFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function taskFormatFactory(root) {
  'use strict';

  const FIELD_MARKERS = Object.freeze({
    goal: '➤цель:',
    difficulty: '➤сложность:',
    advice: '➤совет:',
    source: '➤исходное:',
  });

  const FIELD_NAME_BY_RUSSIAN = Object.freeze({
    'цель': 'goal',
    'сложность': 'difficulty',
    'совет': 'advice',
    'исходное': 'source',
    'исх.': 'source',
    'исх': 'source',
  });

  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function cleanInline(value) {
    return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyHighlights(escapedHtml, terms) {
    let result = escapedHtml;
    for (const term of unique(terms).filter(Boolean)) {
      const escapedTerm = escapeHtml(term);
      result = result.replace(new RegExp(`(${escapeRegExp(escapedTerm)})`, 'gi'), '<mark>$1</mark>');
    }
    return result;
  }

  function renderRichText(value, terms) {
    const text = String(value == null ? '' : value);
    let html = '';
    let lastIndex = 0;
    let match;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(text)) !== null) {
      html += applyHighlights(escapeHtml(text.slice(lastIndex, match.index)), terms);
      const url = match[0];
      html += `<a class="task-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${applyHighlights(escapeHtml(url), terms)}</a>`;
      lastIndex = match.index + url.length;
    }
    html += applyHighlights(escapeHtml(text.slice(lastIndex)), terms);
    return html;
  }

  function stripLegacySource(raw) {
    const pattern = /\s*⟦\s*(?:исх\.?|исходное)\s*:\s*([\s\S]*?)⟧/i;
    const match = pattern.exec(raw);
    if (!match) return { text: raw, source: null, unparsed: null };
    const before = raw.slice(0, match.index).trim();
    const after = raw.slice(match.index + match[0].length).trim();
    return {
      text: before,
      source: cleanInline(match[1]) || null,
      unparsed: cleanInline(after) || null,
    };
  }

  function splitStructuredFields(raw) {
    const markerRe = /➤\s*(цель|сложность|совет|исходное|исх\.?)\s*:/gi;
    const matches = [];
    let match;
    while ((match = markerRe.exec(raw)) !== null) {
      matches.push({ index: match.index, end: markerRe.lastIndex, field: FIELD_NAME_BY_RUSSIAN[match[1].toLowerCase()] });
    }
    if (!matches.length) return { main: raw.trim(), fields: {}, duplicates: [] };

    const fields = {};
    const duplicates = [];
    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      const next = matches[index + 1];
      const value = cleanInline(raw.slice(current.end, next ? next.index : raw.length));
      if (!value) continue;
      if (fields[current.field] == null) fields[current.field] = value;
      else duplicates.push({ field: current.field, value });
    }
    return { main: raw.slice(0, matches[0].index).trim(), fields, duplicates };
  }

  /**
   * Старый формат допускает служебные todo.txt-теги после блока ⟦исх.: …⟧.
   * stripLegacySource() называет весь этот фрагмент хвостом, поэтому здесь мы
   * забираем из него только известные даты, не теряя действительно неизвестный текст.
   */
  function extractKnownTailDates(rawTail) {
    let dueDate = null;
    let thresholdDate = null;
    const unparsedParts = [];
    const words = cleanInline(rawTail).split(/\s+/).filter(Boolean);

    for (const originalWord of words) {
      const token = originalWord.replace(/[.,;!?]+$/, '');
      const tagMatch = token.match(/^(due|t):(.+)$/);
      if (tagMatch && ISO_DATE_RE.test(tagMatch[2])) {
        if (tagMatch[1] === 'due') dueDate = tagMatch[2];
        else thresholdDate = tagMatch[2];
        continue;
      }
      unparsedParts.push(originalWord);
    }

    return {
      dueDate,
      thresholdDate,
      unparsed: cleanInline(unparsedParts.join(' ')) || null,
    };
  }

  function parseTaskLine(line) {
    const raw = String(line == null ? '' : line).trim();
    const legacy = stripLegacySource(raw);
    const structured = splitStructuredFields(legacy.text);
    let rest = structured.main;
    let completed = false;
    let priority = null;
    let completionDate = null;
    let creationDate = null;

    if (/^x\s+/i.test(rest)) {
      completed = true;
      rest = rest.replace(/^x\s+/i, '');
      const completionMatch = rest.match(/^(\d{4}-\d{2}-\d{2})(?:\s+|$)/);
      if (completionMatch) {
        completionDate = completionMatch[1];
        rest = rest.slice(completionMatch[0].length);
      }
    }

    const priorityMatch = rest.match(/^\(([A-Z])\)(?:\s+|$)/);
    if (priorityMatch) {
      priority = priorityMatch[1];
      rest = rest.slice(priorityMatch[0].length);
    }

    const creationMatch = rest.match(/^(\d{4}-\d{2}-\d{2})(?:\s+|$)/);
    if (creationMatch) {
      creationDate = creationMatch[1];
      rest = rest.slice(creationMatch[0].length);
    }

    const projects = [];
    const contexts = [];
    const hashtags = [];
    const tagList = [];
    const words = rest.trim() ? rest.trim().split(/\s+/) : [];
    const textParts = [];
    let dueDate = null;
    let thresholdDate = null;

    for (const originalWord of words) {
      const word = originalWord.trim();
      if (!word) continue;
      if (/^https?:\/\//i.test(word)) {
        textParts.push(word);
        continue;
      }
      const suffixMatch = word.match(/^(.*?)([.,;!?]*)$/);
      const token = suffixMatch ? suffixMatch[1] : word;
      if (/^\+\S+$/.test(token)) {
        projects.push(token.slice(1));
        continue;
      }
      if (/^@\S+$/.test(token)) {
        contexts.push(token.slice(1));
        continue;
      }
      if (/^#\S+$/.test(token)) {
        hashtags.push(token.slice(1));
        continue;
      }
      const tagMatch = token.match(/^([A-Za-z][A-Za-z0-9_-]*):(.+)$/);
      if (tagMatch) {
        const key = tagMatch[1];
        const value = tagMatch[2];
        if (key === 'due' && ISO_DATE_RE.test(value)) dueDate = value;
        else if (key === 't' && ISO_DATE_RE.test(value)) thresholdDate = value;
        else tagList.push({ key, value });
        continue;
      }
      textParts.push(originalWord);
    }

    const tags = {};
    for (const tag of tagList) tags[tag.key] = tag.value;
    const canonicalSource = structured.fields.source || null;
    const source = legacy.source || canonicalSource;
    const duplicateSources = structured.duplicates.filter(item => item.field === 'source').map(item => item.value);
    const sourceHistory = unique([legacy.source, canonicalSource, ...duplicateSources]).filter(value => value !== source);
    const tailDates = extractKnownTailDates(legacy.unparsed);
    if (tailDates.dueDate) dueDate = tailDates.dueDate;
    if (tailDates.thresholdDate) thresholdDate = tailDates.thresholdDate;

    return {
      raw,
      completed,
      priority,
      completionDate,
      creationDate,
      text: cleanInline(textParts.join(' ')),
      projects: unique(projects),
      contexts: unique(contexts),
      hashtags: unique(hashtags),
      tags,
      tagList,
      dueDate,
      thresholdDate,
      goal: structured.fields.goal || null,
      difficulty: structured.fields.difficulty || null,
      advice: structured.fields.advice || null,
      source,
      sourceHistory,
      duplicateFields: structured.duplicates,
      unparsed: tailDates.unparsed,
    };
  }

  function normalizeTagName(value, prefix) {
    return cleanInline(value).replace(new RegExp(`^${escapeRegExp(prefix)}`), '');
  }

  function serializeTaskLine(task) {
    const parts = [];
    if (task.completed) {
      parts.push('x');
      if (task.completionDate) parts.push(task.completionDate);
      if (task.priority) parts.push(`(${String(task.priority).toUpperCase()})`);
    } else if (task.priority) {
      parts.push(`(${String(task.priority).toUpperCase()})`);
    }
    if (task.creationDate) parts.push(task.creationDate);
    if (cleanInline(task.text)) parts.push(cleanInline(task.text));
    for (const context of unique(task.contexts).map(value => normalizeTagName(value, '@'))) parts.push(`@${context}`);
    for (const project of unique(task.projects).map(value => normalizeTagName(value, '+'))) parts.push(`+${project}`);
    for (const hashtag of unique(task.hashtags).map(value => normalizeTagName(value, '#'))) parts.push(`#${hashtag}`);
    if (task.dueDate) parts.push(`due:${task.dueDate}`);
    if (task.thresholdDate) parts.push(`t:${task.thresholdDate}`);

    const seenTagKeys = new Set(['due', 't']);
    const sourceTags = Array.isArray(task.tagList)
      ? task.tagList
      : Object.entries(task.tags || {}).map(([key, value]) => ({ key, value }));
    for (const tag of sourceTags) {
      if (!tag || !tag.key || tag.value == null || seenTagKeys.has(tag.key)) continue;
      seenTagKeys.add(tag.key);
      parts.push(`${tag.key}:${cleanInline(tag.value)}`);
    }
    if (task.unparsed) parts.push(cleanInline(task.unparsed));

    let result = parts.join(' ').trim();
    for (const field of ['goal', 'difficulty', 'advice', 'source']) {
      const value = cleanInline(task[field]);
      if (value) result += `${result ? ' ' : ''}${FIELD_MARKERS[field]}${value}`;
    }
    for (const duplicate of task.duplicateFields || []) {
      if (!duplicate || !FIELD_MARKERS[duplicate.field] || duplicate.field === 'source') continue;
      const value = cleanInline(duplicate.value);
      if (value) result += ` ${FIELD_MARKERS[duplicate.field]}${value}`;
    }
    for (const source of unique(task.sourceHistory)) {
      const value = cleanInline(source);
      if (value && value !== cleanInline(task.source)) result += ` ${FIELD_MARKERS.source}${value}`;
    }
    return result;
  }

  function extractUrls(value) {
    return String(value || '').match(URL_RE) || [];
  }

  function mergeOriginalTask(generatedLine, originalLine) {
    const generated = parseTaskLine(generatedLine);
    const original = parseTaskLine(originalLine);
    const missingUrls = extractUrls(original.raw).filter(url => !generated.raw.includes(url));
    if (missingUrls.length) generated.text = cleanInline([generated.text, ...missingUrls].join(' '));
    generated.contexts = unique([...generated.contexts, ...original.contexts]);
    generated.projects = unique([...generated.projects, ...original.projects]);
    generated.hashtags = unique([...generated.hashtags, ...original.hashtags]);

    const generatedTagKeys = new Set(generated.tagList.map(tag => tag.key));
    generated.tagList = [
      ...generated.tagList,
      ...original.tagList.filter(tag => !generatedTagKeys.has(tag.key)),
    ];
    if (!generated.dueDate) generated.dueDate = original.dueDate;
    if (!generated.thresholdDate) generated.thresholdDate = original.thresholdDate;

    if (original.source) generated.source = original.source;
    else if (cleanInline(generated.text) !== cleanInline(original.text)) generated.source = original.text || null;
    generated.unparsed = cleanInline([original.unparsed, generated.unparsed].filter(Boolean).join(' ')) || null;
    return serializeTaskLine(generated);
  }

  function parseIsoDateLocal(isoDate) {
    if (!ISO_DATE_RE.test(String(isoDate || ''))) return null;
    const [year, month, day] = isoDate.split('-').map(Number);
    const value = new Date(year, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(value.getTime()) ? null : value;
  }

  function startOfLocalDay(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function calendarDayDifference(target, base) {
    const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    const baseUtc = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
    return Math.round((targetUtc - baseUtc) / 86400000);
  }

  function getDateFns(options) {
    return options && options.dateFns ? options.dateFns : root && root.dateFns;
  }

  function getRussianLocale(dateFns) {
    return dateFns && dateFns.locale ? (dateFns.locale.ru || dateFns.locale.ruRU) : null;
  }

  function stripRelativeClock(value) {
    return String(value || '')
      .replace(/\s+в\s+\d{1,2}:\d{2}(?::\d{2})?$/i, '')
      .replace(/\s+at\s+\d{1,2}:\d{2}(?:\s*[AP]M)?$/i, '')
      .trim();
  }

  function formatAbsoluteDate(target, base, options) {
    const dateFns = getDateFns(options);
    const locale = getRussianLocale(dateFns);
    if (dateFns && typeof dateFns.format === 'function' && locale) {
      return dateFns.format(target, target.getFullYear() === base.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale });
    }
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: target.getFullYear() === base.getFullYear() ? undefined : 'numeric',
    }).format(target).replace(/\.$/, '');
  }

  function formatCalendarDate(isoDate, options = {}) {
    const target = parseIsoDateLocal(isoDate);
    if (!target) return String(isoDate || '');
    const base = startOfLocalDay(options.now || new Date());
    const diff = calendarDayDifference(target, base);
    const relativeTime = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto', style: 'long' });
    if (diff >= -2 && diff <= 2) return relativeTime.format(diff, 'day');

    const dateFns = getDateFns(options);
    const locale = getRussianLocale(dateFns);
    if (Math.abs(diff) <= 6 && dateFns && typeof dateFns.formatRelative === 'function' && locale) {
      return stripRelativeClock(dateFns.formatRelative(target, base, { locale, weekStartsOn: 1 }));
    }
    return formatAbsoluteDate(target, base, options);
  }

  function parseDateValue(value) {
    if (typeof value === 'string' && ISO_DATE_RE.test(value)) return parseIsoDateLocal(value);
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Human-readable age backed by date-fns in the browser. Date-only values use
   * calendar days, so today's section marker cannot become "12 hours ago".
   */
  function formatRelativeAge(value, options = {}) {
    const target = parseDateValue(value);
    if (!target) return '';
    const base = new Date(options.now || new Date());
    const dateOnly = typeof value === 'string' && ISO_DATE_RE.test(value);

    if (dateOnly) {
      const diff = calendarDayDifference(target, startOfLocalDay(base));
      if (Math.abs(diff) <= 6) {
        return new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto', style: 'long' }).format(diff, 'day');
      }
      target.setHours(0, 0, 0, 0);
      base.setHours(0, 0, 0, 0);
    }

    const dateFns = getDateFns(options);
    const locale = getRussianLocale(dateFns);
    if (dateFns && typeof dateFns.formatDistance === 'function' && locale) {
      return dateFns.formatDistance(target, base, { addSuffix: true, locale });
    }

    const deltaSeconds = (target.getTime() - base.getTime()) / 1000;
    const absoluteSeconds = Math.abs(deltaSeconds);
    let divisor = 1;
    let unit = 'second';
    if (absoluteSeconds >= 31557600) { divisor = 31557600; unit = 'year'; }
    else if (absoluteSeconds >= 2629800) { divisor = 2629800; unit = 'month'; }
    else if (absoluteSeconds >= 86400) { divisor = 86400; unit = 'day'; }
    else if (absoluteSeconds >= 3600) { divisor = 3600; unit = 'hour'; }
    else if (absoluteSeconds >= 60) { divisor = 60; unit = 'minute'; }
    const amount = Math.round(deltaSeconds / divisor);
    return new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto', style: 'long' }).format(amount, unit);
  }

  function formatVersionMoment(value, options = {}) {
    const target = parseDateValue(value);
    if (!target) return '';
    const absolute = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(target);
    const relative = formatRelativeAge(target, options);
    return relative ? `${absolute} · ${relative}` : absolute;
  }

  function formatTaskDate(isoDate, options = {}) {
    const kind = options.kind || 'date';
    const value = formatCalendarDate(isoDate, options);
    if (!value) return '';
    if (kind === 'due') return `Срок · ${value}`;
    if (kind === 'created') return `Создано · ${value}`;
    if (kind === 'completed') return `Готово · ${value}`;
    if (kind === 'threshold') return `Старт · ${value}`;
    return value;
  }

  function absoluteDateTitle(isoDate) {
    const date = parseIsoDateLocal(isoDate);
    if (!date) return String(isoDate || '');
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }

  function renderField(label, className, value, terms) {
    if (!value) return '';
    return `<span class="${className}"><strong>${label}:</strong> ${renderRichText(value, terms)}</span>`;
  }

  function renderSource(task, terms, compact) {
    const history = task.sourceHistory || [];
    if (!task.source && !task.unparsed && !history.length) return '';
    const chunks = [];
    if (task.source) chunks.push(renderRichText(task.source, terms));
    for (const item of history) chunks.push(renderRichText(item, terms));
    if (task.unparsed) chunks.push(`<span class="task-unparsed">Хвост строки: ${renderRichText(task.unparsed, terms)}</span>`);
    if (compact) return `<span class="task-source-line"><strong>Исходная задача:</strong> ${chunks.join('<br>')}</span>`;
    return `<details class="task-source"><summary>Исходная задача</summary><div>${chunks.join('<br>')}</div></details>`;
  }

  function renderTaskContentHtml(taskOrLine, options = {}) {
    const task = typeof taskOrLine === 'string' ? parseTaskLine(taskOrLine) : taskOrLine;
    const variant = options.variant || 'list';
    const terms = options.terms || [];
    const title = task.text || task.raw;
    let html = `<span class="task-text" data-task-title>${renderRichText(title, terms)}</span>`;
    html += renderField('Цель', 'task-goal', task.goal, terms);
    if (variant === 'choice') return html;

    if (variant === 'sort') {
      html += renderTaskBreakdownHtml(task, options);
      return html;
    }

    html += renderField('Сложность', 'task-difficulty', task.difficulty, terms);
    html += renderField('Совет', 'task-advice', task.advice, terms);
    html += renderSource(task, terms, false);
    return html;
  }

  function renderTaskBreakdownHtml(taskOrLine, options = {}) {
    const task = typeof taskOrLine === 'string' ? parseTaskLine(taskOrLine) : taskOrLine;
    const terms = options.terms || [];
    const body = [
      renderField('Сложность', 'task-difficulty', task.difficulty, terms),
      renderField('Совет', 'task-advice', task.advice, terms),
      renderSource(task, terms, true),
    ].filter(Boolean).join('');
    return body ? `<details class="task-breakdown"><summary>Разбор задачи</summary>${body}</details>` : '';
  }

  const META_KINDS = Object.freeze([
    'priority',
    'contexts',
    'projects',
    'hashtags',
    'tags',
    'due',
    'threshold',
    'created',
    'completed',
  ]);

  function shouldRenderMeta(kind, options) {
    const included = Array.isArray(options.includeMeta) ? new Set(options.includeMeta) : null;
    const excluded = new Set(Array.isArray(options.excludeMeta) ? options.excludeMeta : []);
    return (!included || included.has(kind)) && !excluded.has(kind);
  }

  function renderTaskMetaHtml(taskOrLine, options = {}) {
    const task = typeof taskOrLine === 'string' ? parseTaskLine(taskOrLine) : taskOrLine;
    const badges = [];
    if (shouldRenderMeta('priority', options) && task.priority) badges.push(`<span class="t t-pri t-pri-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>`);
    if (shouldRenderMeta('contexts', options)) {
      for (const context of task.contexts) badges.push(`<span class="t t-ctx">@${escapeHtml(context)}</span>`);
    }
    if (shouldRenderMeta('projects', options)) {
      for (const project of task.projects) badges.push(`<span class="t t-proj">+${escapeHtml(project)}</span>`);
    }
    if (shouldRenderMeta('hashtags', options)) {
      for (const hashtag of task.hashtags) badges.push(`<span class="t t-hash">#${escapeHtml(hashtag)}</span>`);
    }
    if (shouldRenderMeta('tags', options)) {
      for (const tag of task.tagList) badges.push(`<span class="t t-meta">${escapeHtml(tag.key)}:${escapeHtml(tag.value)}</span>`);
    }
    if (shouldRenderMeta('due', options) && task.dueDate) {
      const due = parseIsoDateLocal(task.dueDate);
      const today = startOfLocalDay(options.now || new Date());
      const diff = due ? calendarDayDifference(due, today) : null;
      const stateClass = diff == null ? '' : diff < 0 ? ' due-overdue' : diff === 0 ? ' due-today' : diff <= 3 ? ' due-soon' : ' due-ok';
      badges.push(`<span class="t t-due${stateClass}" title="${escapeHtml(absoluteDateTitle(task.dueDate))}">${escapeHtml(formatTaskDate(task.dueDate, { ...options, kind: 'due' }))}</span>`);
    }
    if (shouldRenderMeta('threshold', options) && task.thresholdDate) badges.push(`<span class="t t-threshold" title="${escapeHtml(absoluteDateTitle(task.thresholdDate))}">${escapeHtml(formatTaskDate(task.thresholdDate, { ...options, kind: 'threshold' }))}</span>`);
    if (shouldRenderMeta('created', options) && task.creationDate) badges.push(`<span class="t t-date" title="${escapeHtml(absoluteDateTitle(task.creationDate))}">${escapeHtml(formatTaskDate(task.creationDate, { ...options, kind: 'created' }))}</span>`);
    if (shouldRenderMeta('completed', options) && task.completed && task.completionDate) badges.push(`<span class="t t-date" title="${escapeHtml(absoluteDateTitle(task.completionDate))}">${escapeHtml(formatTaskDate(task.completionDate, { ...options, kind: 'completed' }))}</span>`);
    const positionClass = options.position === 'before' ? ' task-tags-leading' : '';
    return badges.length ? `<div class="task-tags${positionClass}">${badges.join('')}</div>` : '';
  }

  // Each screen can move selected metadata without changing the todo.txt line
  // or maintaining a second task renderer.
  function renderTaskHtml(taskOrLine, options = {}) {
    const task = typeof taskOrLine === 'string' ? parseTaskLine(taskOrLine) : taskOrLine;
    const leadingMeta = unique(options.leadingMeta).filter(kind => META_KINDS.includes(kind));
    const leading = leadingMeta.length
      ? renderTaskMetaHtml(task, { ...options, includeMeta: leadingMeta, position: 'before' })
      : '';
    const content = renderTaskContentHtml(task, options);
    const trailing = renderTaskMetaHtml(task, { ...options, excludeMeta: leadingMeta });
    return leading + content + trailing;
  }

  return Object.freeze({
    FIELD_MARKERS,
    parseTaskLine,
    serializeTaskLine,
    mergeOriginalTask,
    parseIsoDateLocal,
    formatCalendarDate,
    formatRelativeAge,
    formatVersionMoment,
    formatTaskDate,
    renderRichText,
    renderTaskHtml,
    renderTaskContentHtml,
    renderTaskBreakdownHtml,
    renderTaskMetaHtml,
    escapeHtml,
  });
});
