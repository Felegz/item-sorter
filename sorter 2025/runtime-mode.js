// runtime-mode.js — one shared application, with isolated storage for local development.
(function initSorterRuntime(root) {
  'use strict';

  const localHosts = new Set(['127.0.0.1', 'localhost']);
  const params = new URLSearchParams(root.location.search);
  const isLocal = localHosts.has(root.location.hostname);
  const isDeveloperMode = isLocal && params.get('mode') === 'developer';
  const developerPrefix = 'sorter_dev_';
  const defaultDeveloperTasks = Object.freeze([
    'Задача один',
    'Задача три',
    'Задача восемь',
    'Задача двадцать один',
    'Задача пять',
    'Задача тринадцать',
    'Задача тридцать четыре',
    'Задача два',
    'Задача пятьдесят пять',
    'Задача восемьдесят девять',
  ]);

  const storageKey = name => isDeveloperMode ? `${developerPrefix}${name}` : name;
  const getItem = name => root.localStorage.getItem(storageKey(name));
  const setItem = (name, value) => root.localStorage.setItem(storageKey(name), String(value));
  const removeItem = name => root.localStorage.removeItem(storageKey(name));

  /**
   * Keep developer mode on local navigation and normalize extensionless routes
   * for the simple local HTTP server. Production URLs can never enter it.
   */
  function withMode(input) {
    const url = new URL(input, root.location.href);
    if (url.origin !== root.location.origin) return url.toString();
    if (isDeveloperMode) url.searchParams.set('mode', 'developer');
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
    getTasks: () => getItem('tasks') || '',
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
