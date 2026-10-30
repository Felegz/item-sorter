// runtime-mode.js — one shared application, with isolated storage for local development.
(function initSorterRuntime(root) {
  'use strict';

  const localHosts = new Set(['127.0.0.1', 'localhost']);
  const params = new URLSearchParams(root.location.search);
  const isLocal = localHosts.has(root.location.hostname);
  const isDeveloperMode = isLocal && params.get('mode') === 'developer';
  const developerPrefix = 'sorter_dev_';
  const defaultDeveloperTasks = Object.freeze([
    'Задача один @дом +быт #тест',
    'Задача три @телефон +связь #короткое',
    'Задача восемь @ноут +работа #важное',
    'Задача двадцать один @город +дела #вне-дома',
    'Задача пять @дом @телефон +быт #проверка',
    'Задача тринадцать @ноут +учёба #читать',
    'Задача тридцать четыре @город @телефон +покупки #покупки',
    'Задача два @дом +быт #два',
    'Задача пятьдесят пять @ноут +длинное-название-проекта #длинный-хештег-для-проверки-переноса',
    'Задача восемьдесят девять @телефон @дом +связь #review',
  ]);

  const storageKey = name => isDeveloperMode ? `${developerPrefix}${name}` : name;
  const getItem = name => root.localStorage.getItem(storageKey(name));
  const setItem = (name, value) => root.localStorage.setItem(storageKey(name), String(value));
  const removeItem = name => root.localStorage.removeItem(storageKey(name));

  // Owner-requested fixture update. Run once, only on isolated developer data,
  // and only after the shared parser has loaded. Never reseed an existing list.
  // A backup precedes the write; positions, duplicate occurrences and separators
  // are preserved by line-level edits. Normal/production getTasks stays read-only.
  function getTasks() {
    const text = getItem('tasks') || '';
    if (!isDeveloperMode || getItem('fixture_tags_v1') || !root.TaskFormat) return text;
    const markers = typeof MARKERS !== 'undefined' ? MARKERS : root.MARKERS;
    if (!markers) return text;
    const format = root.TaskFormat;
    const seeds = defaultDeveloperTasks.map(line => format.parseTaskLine(line));
    let taskIndex = 0;
    const next = text.split('\n').map(line => {
      if (!line.trim() || markers.isAnyMarker(line)) return line;
      const task = format.parseTaskLine(line);
      const seed = seeds.find(item => item.text === task.text) || seeds[taskIndex % seeds.length];
      taskIndex++;
      if (!task.text || (task.contexts.length && task.projects.length && task.hashtags.length)) return line;
      if (!task.contexts.length) task.contexts = [...seed.contexts];
      if (!task.projects.length) task.projects = [...seed.projects];
      if (!task.hashtags.length) task.hashtags = [...seed.hashtags];
      return format.serializeTaskLine(task) + (line.endsWith('\r') ? '\r' : '');
    }).join('\n');
    if (next !== text) {
      if (getItem('fixture_tags_backup_v1') === null) setItem('fixture_tags_backup_v1', text);
      setItem('tasks', next);
    }
    setItem('fixture_tags_v1', '1');
    return next;
  }

  /**
   * Keep developer mode on local navigation and normalize extensionless routes
   * for the simple local HTTP server. Production URLs can never enter it.
   */
  function withMode(input) {
    const url = new URL(input, root.location.href);
    if (url.origin !== root.location.origin) return url.toString();
    if (isDeveloperMode) url.searchParams.set('mode', 'developer');
    if (isLocal && /^\/tasks\/auto\/?$/.test(url.pathname)) {
      url.pathname = '/tasks.html';
      url.searchParams.set('auto', '1');
    }
    if (isLocal && url.pathname === '/tasks') url.pathname = '/tasks.html';
    if (isLocal && url.pathname === '/process') url.pathname = '/process.html';
    return `${url.pathname}${url.search}${url.hash}`;
  }

  const api = Object.freeze({
    isLocal,
    isDeveloperMode,
    defaultDeveloperTasks,
    storageKey,
    getItem,
    setItem,
    removeItem,
    getTasks,
    setTasks: value => setItem('tasks', value),
    withMode,
  });
  root.SorterRuntime = api;

  if (!isDeveloperMode) return;

  root.document.documentElement.dataset.runtimeMode = 'developer';
  if (getItem('tasks') === null) setItem('tasks', defaultDeveloperTasks.join('\n\n'));

  root.document.addEventListener('DOMContentLoaded', () => {
    root.document.querySelectorAll('a[href]').forEach(link => {
      link.setAttribute('href', withMode(link.getAttribute('href')));
    });

    const syncBadge = root.document.getElementById('sync-badge');
    if (syncBadge) {
      syncBadge.disabled = true;
      syncBadge.dataset.state = 'developer';
      syncBadge.removeAttribute('onclick');
      syncBadge.title = 'Developer-список изолирован; Dropbox полностью отключён';
      syncBadge.setAttribute('aria-label', syncBadge.title);
      const label = syncBadge.querySelector('.sync-status-text');
      if (label) label.textContent = 'DEV · Dropbox off';
    }
  });
})(window);
