/* Browser-side AI delegation through immutable Dropbox TXT files. */
(function (root) {
  'use strict';

  const REQUESTS_PATH = '/ai/requests';
  const RESULTS_PATH = '/ai/results';
  const CACHE_KEY = 'sorter_ai_jobs_v1';
  const MAX_CACHED_JOBS = 250;
  const MAX_CACHE_CHARACTERS = 1_500_000;
  const Exchange = root.SorterAiExchange;
  let memoryCache = {};

  if (!Exchange) throw new Error('ai-exchange.js must be loaded before ai-dropbox.js');

  function readCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const stored = parsed && typeof parsed === 'object' ? parsed : {};
      return { ...stored, ...memoryCache };
    } catch (_) {
      return { ...memoryCache };
    }
  }

  function writeCache(cache) {
    const jobs = Object.values(cache)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, MAX_CACHED_JOBS);
    memoryCache = Object.fromEntries(jobs.map(job => [job.jobId, job]));
    let persistedJobs = [...jobs];
    while (persistedJobs.length) {
      const value = JSON.stringify(Object.fromEntries(persistedJobs.map(job => [job.jobId, job])));
      if (value.length > MAX_CACHE_CHARACTERS && persistedJobs.length > 1) {
        persistedJobs.pop();
        continue;
      }
      try {
        localStorage.setItem(CACHE_KEY, value);
        break;
      } catch (error) {
        if (error?.name !== 'QuotaExceededError' || persistedJobs.length === 1) {
          console.warn('AI cache remains in memory only', error);
          break;
        }
        persistedJobs.pop();
      }
    }
    root.dispatchEvent(new CustomEvent('sorter-ai-jobs-updated', { detail: { jobs } }));
    return memoryCache;
  }

  async function authorizedFetch(url, options, retry = true) {
    const token = typeof root.getToken === 'function' ? root.getToken() : null;
    if (!token) throw new Error('Dropbox не подключён');
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && retry && typeof root.tryRefreshToken === 'function') {
      const refreshed = await root.tryRefreshToken();
      if (refreshed?.ok) return authorizedFetch(url, options, false);
    }
    return response;
  }

  async function dropboxError(response, action) {
    const detail = await response.text();
    const error = new Error(`${action}: Dropbox вернул HTTP ${response.status}`);
    error.status = response.status;
    error.detail = detail;
    if (/missing_scope|insufficient_scope/i.test(detail)) error.code = 'missing_scope';
    throw error;
  }

  async function rpc(route, body) {
    const response = await authorizedFetch(`https://api.dropboxapi.com/2${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) await dropboxError(response, route);
    return response.json();
  }

  async function ensureFolder(path) {
    try {
      await rpc('/files/create_folder_v2', { path, autorename: false });
    } catch (error) {
      if (error.status === 409 && /conflict[\s\S]*folder/i.test(error.detail || '')) return;
      throw error;
    }
  }

  async function ensureAiFolders() {
    await ensureFolder('/ai');
    await ensureFolder(REQUESTS_PATH);
    await ensureFolder(RESULTS_PATH);
  }

  async function uploadTextAdd(path, text) {
    const response = await authorizedFetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: { '.tag': 'add' },
          autorename: false,
          mute: true,
          strict_conflict: true,
        }),
      },
      body: text,
    });
    if (!response.ok) await dropboxError(response, `Загрузка ${path}`);
    return response.json();
  }

  async function downloadText(path) {
    const response = await authorizedFetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': JSON.stringify({ path }) },
    });
    if (!response.ok) await dropboxError(response, `Чтение ${path}`);
    return response.text();
  }

  async function listFolder(path) {
    let page;
    try {
      page = await rpc('/files/list_folder', {
        path,
        recursive: false,
        include_deleted: false,
        include_media_info: false,
        include_non_downloadable_files: false,
      });
    } catch (error) {
      if (error.status === 409 && /not_found/i.test(error.detail || '')) return [];
      throw error;
    }
    const entries = [];
    while (true) {
      entries.push(...(page.entries || []));
      if (!page.has_more) return entries;
      page = await rpc('/files/list_folder/continue', { cursor: page.cursor });
    }
  }

  function jobIdFromEntry(entry) {
    if (entry['.tag'] !== 'file' || typeof entry.name !== 'string' || !entry.name.toLowerCase().endsWith('.txt')) return null;
    const jobId = entry.name.slice(0, -4).toLowerCase();
    return Exchange.validateJobId(jobId) ? jobId : null;
  }

  async function delegateTask(task, instruction) {
    const rawTask = String(task || '').trim();
    const userInstruction = String(instruction || '').trim();
    if (!rawTask) throw new Error('Не выбрана задача');
    if (!userInstruction) throw new Error('Напишите, что должен сделать ИИ');
    if (userInstruction.length > 20_000) throw new Error('Поручение слишком длинное');

    const cache = readCache();
    const retry = Object.values(cache).find(job =>
      (job.status === 'uploading' || job.status === 'upload-error')
      && job.task === rawTask
      && job.instruction === userInstruction
    );
    const jobId = retry?.jobId || Exchange.createJobId();
    const createdAt = retry?.createdAt || new Date().toISOString();
    const taskFingerprint = retry?.taskFingerprint || await Exchange.taskFingerprint(rawTask);
    const requestText = Exchange.serializeRequest({
      jobId,
      createdAt,
      taskFingerprint,
      task: rawTask,
      instruction: userInstruction,
    });
    cache[jobId] = {
      jobId,
      createdAt,
      taskFingerprint,
      task: rawTask,
      instruction: userInstruction,
      status: 'uploading',
      requestRev: null,
    };
    writeCache(cache);

    const requestPath = `${REQUESTS_PATH}/${jobId}.txt`;
    try {
      await ensureAiFolders();
      const metadata = await uploadTextAdd(requestPath, requestText);
      cache[jobId] = { ...cache[jobId], status: 'pending', requestRev: metadata.rev || null };
    } catch (error) {
      try {
        const existing = Exchange.parseRequest(await downloadText(requestPath));
        if (existing.jobId === jobId
          && existing.taskFingerprint === taskFingerprint
          && existing.task === rawTask
          && existing.instruction === userInstruction) {
          cache[jobId] = { ...cache[jobId], status: 'pending' };
          writeCache(cache);
          return cache[jobId];
        }
      } catch (_) {
        // The outcome is unknown; preserve this job ID for the next safe retry.
      }
      cache[jobId] = { ...cache[jobId], status: 'upload-error' };
      writeCache(cache);
      const uncertain = new Error('Dropbox не подтвердил доставку. Повторите это же поручение — будет использован тот же файл без дубля.');
      uncertain.code = 'upload_unknown';
      uncertain.cause = error;
      throw uncertain;
    }
    writeCache(cache);
    return cache[jobId];
  }

  async function refreshJobs({ silent = false } = {}) {
    if (typeof root.getToken !== 'function' || !root.getToken()) return [];
    try {
      const [requests, results] = await Promise.all([listFolder(REQUESTS_PATH), listFolder(RESULTS_PATH)]);
      const cache = readCache();
      for (const entry of requests) {
        const jobId = jobIdFromEntry(entry);
        if (!jobId || cache[jobId]?.requestRev === entry.rev) continue;
        try {
          const request = Exchange.parseRequest(await downloadText(`${REQUESTS_PATH}/${jobId}.txt`));
          cache[jobId] = {
            ...(cache[jobId] || {}),
            ...request,
            status: cache[jobId]?.status === 'ready' || cache[jobId]?.status === 'error' ? cache[jobId].status : 'pending',
            requestRev: entry.rev,
          };
        } catch (error) {
          console.warn(`Не удалось прочитать AI-поручение ${jobId}`, error);
        }
      }
      for (const entry of results) {
        const jobId = jobIdFromEntry(entry);
        if (!jobId || cache[jobId]?.resultRev === entry.rev) continue;
        try {
          const result = Exchange.parseResult(await downloadText(`${RESULTS_PATH}/${jobId}.txt`));
          cache[jobId] = {
            ...(cache[jobId] || {}),
            ...result,
            status: result.status === 'error' ? 'error' : 'ready',
            resultRev: entry.rev,
          };
        } catch (error) {
          console.warn(`Не удалось прочитать AI-результат ${jobId}`, error);
        }
      }
      writeCache(cache);
      return Object.values(cache);
    } catch (error) {
      if (!silent) throw error;
      console.warn('Не удалось обновить AI-поручения', error);
      return Object.values(readCache());
    }
  }

  function jobs() {
    return Object.values(readCache()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function latestJobForTask(rawTask) {
    return jobs().find(job => job.task === rawTask) || null;
  }

  function statusLabel(job) {
    if (!job) return '';
    if (job.status === 'ready') return 'ИИ · готово';
    if (job.status === 'error') return 'ИИ · ошибка';
    if (job.status === 'upload-error') return 'ИИ · отправка?';
    if (job.status === 'uploading') return 'ИИ · отправка';
    return 'ИИ · ожидает';
  }

  function friendlyError(error) {
    if (error?.code === 'missing_scope') return 'Dropbox не дал доступ к списку файлов. Нужно включить files.metadata.read и заново подключить Dropbox.';
    if (error?.status === 409) return 'Dropbox отклонил запись из-за конфликта. Поручение не было продублировано.';
    if (/Dropbox не подключён/.test(error?.message || '')) return 'Сначала подключите Dropbox.';
    return error?.message || 'Не удалось отправить поручение';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkifyText(value) {
    const text = String(value ?? '');
    const expression = /https?:\/\/[^\s<>()\[\]{}"']+/gi;
    let cursor = 0;
    let html = '';
    for (const match of text.matchAll(expression)) {
      const url = match[0].replace(/[.,;:!?]+$/, '');
      html += escapeHtml(text.slice(cursor, match.index));
      html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      cursor = match.index + url.length;
    }
    return html + escapeHtml(text.slice(cursor));
  }

  function resultHtml(job, value) {
    const sourceLinks = String(job.sources || '')
      .split('\n')
      .map(item => item.trim())
      .filter(item => /^https?:\/\//i.test(item))
      .map(item => `<li><a href="${escapeHtml(item)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item)}</a></li>`)
      .join('');
    return `<div style="text-align:left;white-space:pre-wrap;overflow-wrap:anywhere">${linkifyText(value)}</div>${sourceLinks ? `<hr><strong>Источники</strong><ul style="text-align:left;overflow-wrap:anywhere">${sourceLinks}</ul>` : ''}`;
  }

  async function showDelegateDialog(rawTask) {
    if (!root.Swal) throw new Error('SweetAlert2 is required');
    if (typeof root.getToken !== 'function' || !root.getToken()) {
      const decision = await root.Swal.fire({
        title: 'Нужен Dropbox',
        text: 'Поручение передаётся OpenClaw через отдельный файл в Dropbox.',
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Подключить Dropbox',
        cancelButtonText: 'Отмена',
      });
      if (decision.isConfirmed && typeof root.dropboxLogin === 'function') root.dropboxLogin();
      return null;
    }
    const answer = await root.Swal.fire({
      title: 'Поручить ИИ',
      text: rawTask,
      input: 'textarea',
      inputPlaceholder: 'Что найти, проверить или подготовить?',
      inputAttributes: { 'aria-label': 'Что должен сделать ИИ', maxlength: '20000' },
      showCancelButton: true,
      confirmButtonText: 'Отправить',
      cancelButtonText: 'Отмена',
      footer: 'ИИ подготовит результат, но ничего не отправит от вашего имени.',
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !root.Swal.isLoading(),
      inputValidator: value => value.trim() ? null : 'Напишите, что должен сделать ИИ',
      preConfirm: async value => {
        try { return await delegateTask(rawTask, value); }
        catch (error) { root.Swal.showValidationMessage(friendlyError(error)); return false; }
      },
    });
    if (!answer.isConfirmed) return null;
    await root.Swal.fire({
      title: 'Поручение отправлено',
      text: 'OpenClaw обработает его, когда локальный мост будет запущен.',
      icon: 'success',
      timer: 2200,
      showConfirmButton: false,
    });
    return answer.value;
  }

  async function showJob(job) {
    if (!job) return;
    const title = job.status === 'ready' ? 'Результат ИИ' : job.status === 'error' ? 'Ошибка обработки' : 'Поручение ожидает';
    const value = job.status === 'pending' || job.status === 'uploading' || job.status === 'upload-error'
      ? `${job.instruction || ''}\n\n${job.status === 'upload-error' ? 'Dropbox не подтвердил доставку. Повторная отправка этого же поручения использует тот же файл.' : 'OpenClaw ещё не сохранил результат.'}`
      : job.answer || 'Пустой ответ';
    await root.Swal.fire({
      title,
      html: resultHtml(job, value),
      icon: job.status === 'error' ? 'error' : undefined,
      confirmButtonText: 'Закрыть',
      width: 'min(760px, calc(100vw - 24px))',
    });
  }

  async function showJobsDialog() {
    await refreshJobs({ silent: true });
    const allJobs = jobs();
    if (!allJobs.length) {
      await root.Swal.fire({ title: 'Поручений пока нет', text: 'Откройте действия нужной задачи и выберите «Поручить ИИ».', icon: 'info' });
      return;
    }
    const inputOptions = Object.fromEntries(allJobs.map(job => {
      const task = (job.task || 'Неизвестная задача').replace(/\s+/g, ' ').slice(0, 90);
      return [job.jobId, `${statusLabel(job)} — ${task}`];
    }));
    const selection = await root.Swal.fire({
      title: 'Поручения ИИ',
      input: 'select',
      inputOptions,
      confirmButtonText: 'Открыть',
      showCancelButton: true,
      cancelButtonText: 'Закрыть',
    });
    if (selection.isConfirmed) await showJob(readCache()[selection.value]);
  }

  root.SorterAiDropbox = Object.freeze({
    delegateTask,
    refreshJobs,
    jobs,
    latestJobForTask,
    statusLabel,
    showDelegateDialog,
    showJob,
    showJobsDialog,
    friendlyError,
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof root.getToken === 'function' && root.getToken()) {
      setTimeout(() => refreshJobs({ silent: true }), 1200);
    }
  });
})(window);
