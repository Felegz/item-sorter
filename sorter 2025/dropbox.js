// dropbox.js — Dropbox OAuth 2.0 PKCE + автоматическая синхронизация
//
// Стратегия синхронизации:
//   • visibilitychange: при возврате на вкладку → проверяем rev на сервере
//       - сервер новее, локально чисто  → тихо скачиваем
//       - оба изменились                → диалог конфликта
//       - сервер не изменился           → ничего
//   • Автосохранение: 20 с бездействия в textarea → загружаем на сервер
//       - используем mode:"update" + rev → Dropbox сам обнаружит конфликт (409)
//   • Ручные кнопки: сохранение с проверкой rev, загрузка с подтверждением.
//   • Конфликт: сравнение точных версий, архив как подсказка, выбор без merge.

const DROPBOX_APP_KEY       = 'd1t1dje9vyjotd7';
// Динамический redirect URI — работает и локально, и на продакшне
const DROPBOX_REDIRECT_URI  = window.location.origin + '/';
const DROPBOX_FILE_PATH     = '/tasks.txt';
const DROPBOX_ARCHIVE_PATH  = '/archive.txt';
const AUTOSAVE_DELAY_MS     = 20_000;
const SYNC_STALE_AFTER_MINUTES = 30;

// Both main screens use this result so the age threshold and wording cannot drift apart.
function getCompactSyncAge(syncTime, now = Date.now()) {
  const ageMinutes = Math.max(0, Math.floor((now - syncTime) / 60_000));
  let age;
  if (ageMinutes < 1) age = 'just now';
  else if (ageMinutes < 60) age = `${ageMinutes} min ago`;
  else if (ageMinutes < 1440) age = `${Math.floor(ageMinutes / 60)} h ago`;
  else age = `${Math.floor(ageMinutes / 1440)} d ago`;

  const stale = ageMinutes >= SYNC_STALE_AFTER_MINUTES;
  return {
    ageMinutes,
    age,
    state: stale ? 'stale' : 'ok',
    label: `${stale ? '!' : '✓'} Sync · ${age}`,
  };
}

const isRuntimeDeveloperMode = () => Boolean(window.SorterRuntime?.isDeveloperMode);

function showDropboxDisabledInDeveloperMode() {
  if (typeof Swal !== 'undefined') {
    Swal.fire('Dropbox отключён', 'Developer-список никогда не синхронизируется с облаком.', 'info');
  }
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

function base64urlEncode(array) {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ─── Авторизация ─────────────────────────────────────────────────────────────

async function dropboxLogin() {
  if (isRuntimeDeveloperMode()) { showDropboxDisabledInDeveloperMode(); return; }
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('dbx_verifier', verifier);

  const params = new URLSearchParams({
    client_id:             DROPBOX_APP_KEY,
    redirect_uri:          DROPBOX_REDIRECT_URI,
    response_type:         'code',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    token_access_type:     'offline',
    scope:                 'files.content.write files.content.read files.metadata.read',
  });

  window.location.href = 'https://www.dropbox.com/oauth2/authorize?' + params.toString();
}

async function handleOAuthCallback() {
  if (isRuntimeDeveloperMode()) return;
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (!code) return;

  window.history.replaceState({}, '', window.location.pathname);

  const verifier = localStorage.getItem('dbx_verifier');
  if (!verifier) {
    Swal.fire('Ошибка', 'Не найден code_verifier — попробуйте войти снова', 'error');
    return;
  }

  try {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        grant_type:    'authorization_code',
        client_id:     DROPBOX_APP_KEY,
        redirect_uri:  DROPBOX_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      localStorage.setItem('dbx_access_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('dbx_refresh_token', data.refresh_token);
      localStorage.removeItem('dbx_verifier');
      updateDropboxUI();
      Swal.fire({ title: 'Dropbox подключён!', text: 'Теперь синхронизация работает автоматически.', icon: 'success', timer: 2000, showConfirmButton: false });
      setTimeout(() => autoSyncOnFocus(true), 500);
    } else {
      console.error('Dropbox token error:', data);
      Swal.fire('Ошибка авторизации', data.error_description || 'Не удалось получить токен', 'error');
    }
  } catch (err) {
    console.error('OAuth callback error:', err);
    Swal.fire('Ошибка', 'Сетевая ошибка при получении токена', 'error');
  }
}

function getToken() {
  if (isRuntimeDeveloperMode()) return null;
  return localStorage.getItem('dbx_access_token');
}

async function tryRefreshToken() {
  if (isRuntimeDeveloperMode()) return { ok: false, reason: 'Dropbox отключён в developer mode' };
  const refresh = localStorage.getItem('dbx_refresh_token');
  if (!refresh) return { ok: false, reason: 'Нет сохранённого refresh-токена' };
  try {
    const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refresh,
        client_id:     DROPBOX_APP_KEY,
      }),
    });
    const data = await resp.json();
    if (data.access_token) {
      localStorage.setItem('dbx_access_token', data.access_token);
      return { ok: true };
    }
    return { ok: false, reason: data.error_description || data.error || 'Dropbox отклонил обновление токена' };
  } catch (err) {
    return { ok: false, reason: 'Сетевая ошибка: ' + String(err) };
  }
}

function dropboxLogout() {
  if (isRuntimeDeveloperMode()) { showDropboxDisabledInDeveloperMode(); return; }
  localStorage.removeItem('dbx_access_token');
  localStorage.removeItem('dbx_refresh_token');
  localStorage.removeItem('dbx_verifier');
  updateDropboxUI();
}

// ─── Состояние синхронизации ─────────────────────────────────────────────────
//
// localStorage keys:
//   dbx_last_sync   — { type:'save'|'load'|'check', time:ms, detail:str }   (для строки "5 мин назад · причина")
//   dbx_last_rev    — rev-хэш Dropbox после последней синхронизации
//   dbx_last_tasks  — текст задач в момент последней синхронизации
//   dbx_local_version_time — время последнего локального изменения списка

const DBX_LOCAL_VERSION_TIME_KEY = 'dbx_local_version_time';

function dbxSetLocalVersionTime(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isFinite(time)) localStorage.setItem(DBX_LOCAL_VERSION_TIME_KEY, String(time));
}

// All local task writers call this so conflict UI can date the local version.
function dbxRecordLocalTasksChange() {
  if (isRuntimeDeveloperMode()) return;
  dbxSetLocalVersionTime(Date.now());
}

function dbxConflictVersionsHtml(meta) {
  const localTime = Number(localStorage.getItem(DBX_LOCAL_VERSION_TIME_KEY));
  const remoteTime = meta && (meta.client_modified || meta.server_modified);
  const format = value => {
    const label = value ? TaskFormat.formatVersionMoment(value) : '';
    return label ? TaskFormat.escapeHtml(label) : '';
  };
  const localLabel = format(localTime || null);
  const remoteLabel = format(remoteTime);
  return `<p class="version-conflict-note">Файл изменён на другом устройстве.</p>
    <div class="version-compare">
      <div class="version-card"><strong>На этом устройстве</strong>${localLabel ? `<span>${localLabel}</span>` : ''}</div>
      <div class="version-card"><strong>В Dropbox</strong>${remoteLabel ? `<span>${remoteLabel}</span>` : ''}</div>
    </div>`;
}

let _conflictInProgress = false;

// Preview reads never alter tasks, sync state, or the archive. Missing archive
// is the only 409 that means an empty file; other failures mean "not checked".
async function dbxReadComparisonFile(path, allowRefresh = true) {
  const token = getToken();
  if (!token) throw new Error('Нет подключения к Dropbox.');
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({ path }) },
  });
  if (response.status === 401 && allowRefresh && (await tryRefreshToken()).ok) {
    return dbxReadComparisonFile(path, false);
  }
  if (response.status === 409 && path === DROPBOX_ARCHIVE_PATH) {
    const error = (await response.json()).error;
    if (error?.['.tag'] === 'path' && error.path?.['.tag'] === 'not_found') return { text: '', meta: {} };
  }
  if (!response.ok) throw new Error('Не удалось прочитать файл для сравнения. HTTP ' + response.status);
  const text = await response.text();
  const meta = JSON.parse(response.headers.get('dropbox-api-result') || '{}');
  if (path === DROPBOX_FILE_PATH && (typeof meta.rev !== 'string' || !meta.rev)) {
    throw new Error('Dropbox не вернул версию файла. Замена остановлена.');
  }
  return { text, meta };
}

function dbxConflictLocalState() {
  return JSON.stringify([document.getElementById('task-list')?.value ?? SorterRuntime.getTasks(),
    SorterRuntime.getTasks(), window.SorterUnsavedChanges?.state()]);
}

// Save BOTH exact alternatives, including an empty document, before applying a
// choice. Fail closed on storage/quota errors, rather than promising a backup.
function dbxBackupConflictVersions(local, cloud, merged) {
  const key = SorterRuntime.storageKey(SNAPSHOT_KEY);
  const previous = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(previous)) throw new Error('История версий повреждена. Замена остановлена.');
  const time = Date.now();
  const next = [{ time, reason: 'конфликт: на устройстве', text: local },
    { time, reason: 'конфликт: в Dropbox', text: cloud },
    ...(merged === undefined ? [] : [{ time, reason: 'конфликт: результат объединения', text: merged }]),
    ...previous].slice(0, SNAPSHOT_MAX);
  localStorage.setItem(key, JSON.stringify(next));
}

// One resolver for all four conflict entry points. An explicit choice applies
// only to the versions that were shown, never to a newer unseen cloud version.
async function dbxResolveConflict() {
  if (_conflictInProgress || !getToken()) return false;
  _conflictInProgress = true;
  clearTimeout(_autosaveTimer);
  let archiveWritten = false;
  try {
    setDbxStatus('Сравнение версий…');
    const local = document.getElementById('task-list')?.value ?? SorterRuntime.getTasks();
    const localState = dbxConflictLocalState();
    const approval = window.SorterUnsavedChanges?.state();
    const baseline = localStorage.getItem('dbx_last_tasks');
    const cloud = await dbxReadComparisonFile(DROPBOX_FILE_PATH);
    let archive = null;
    try { archive = (await dbxReadComparisonFile(DROPBOX_ARCHIVE_PATH)).text; } catch (_) { /* Explicitly show unavailable. */ }
    const diff = TaskVersionComparison.compare(local, cloud.text, baseline, archive);
    const choice = await TaskVersionComparison.show(diff, dbxConflictVersionsHtml(cloud.meta));
    if (!choice) return false;
    if (dbxConflictLocalState() !== localState) {
      await Swal.fire('Список изменился', 'Откройте сравнение заново. Ваши правки сохранены.', 'info');
      return false;
    }
    if (window.SorterUnsavedChanges?.hasDraft()) {
      await Swal.fire('Редактор ещё открыт', 'Сохраните или отмените правки в редакторе, затем повторите сравнение.', 'info');
      return false;
    }
    dbxBackupConflictVersions(local, cloud.text, choice.kind === 'merge' ? choice.text : undefined);
    if (choice.kind === 'cloud') {
      return await dbxAutoDownload('выбрана облачная версия', approval, { ...cloud, localState });
    }
    if (choice.kind === 'merge') {
      // Revalidate BEFORE touching the archive. The final task upload still
      // uses a revision precondition because the cloud can change after here.
      const fresh = await dbxReadComparisonFile(DROPBOX_FILE_PATH);
      if (fresh.meta.rev !== cloud.meta.rev || fresh.text !== cloud.text) {
        throw new Error('Облако изменилось после сравнения. Откройте сравнение заново.');
      }
      if (choice.archivedLines.length) {
        TaskVersionComparison.validateArchivedSelections(choice,
          (await dbxReadComparisonFile(DROPBOX_ARCHIVE_PATH)).text);
      }
      if (dbxConflictLocalState() !== localState || window.SorterUnsavedChanges?.hasDraft()) {
        throw new Error('Местные правки изменились. Откройте сравнение заново.');
      }
      if (choice.archiveLines.length) {
        if (!await dbxArchiveCompleted(choice.archiveLines)) {
          throw new Error('Запись архива не подтверждена. Список не менялся. Проверьте архив перед повтором: запись могла пройти без ответа.');
        }
        archiveWritten = true;
      }
      if (dbxConflictLocalState() !== localState || window.SorterUnsavedChanges?.hasDraft()) {
        throw new Error('Местные правки изменились. Они сохранены; откройте сравнение заново.');
      }
    }
    const uploadText = choice.kind === 'merge' ? choice.text : local;
    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + getToken(),
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_FILE_PATH,
          mode: { '.tag': 'update', update: cloud.meta.rev },
          strict_conflict: true, autorename: false, mute: true }) }, body: uploadText,
    });
    if (!response.ok) {
      await Swal.fire('Версия не заменена', (archiveWritten ? 'Архив уже записан, но общий список не сохранён. ' : '') + (response.status === 409
        ? 'Облако изменилось после сравнения. Откройте сравнение заново.'
        : 'Dropbox не подтвердил запись. Правки остаются на устройстве. Проверьте облако перед повтором.'), 'warning');
      return false;
    }
    const meta = await response.json();
    if (typeof meta.rev !== 'string' || !meta.rev) throw new Error('Dropbox не подтвердил версию записанного файла.');
    // The user may have edited during upload. Keep those newer local edits dirty.
    _dbxSaveSyncState(uploadText, meta.rev);
    if (choice.kind === 'merge') {
      if (dbxConflictLocalState() === localState && !window.SorterUnsavedChanges?.hasDraft()) {
        const textarea = document.getElementById('task-list');
        if (textarea) textarea.value = uploadText;
        SorterRuntime.setTasks(uploadText);
        localStorage.setItem('dbx_local_version_time', String(Date.now()));
        if (typeof window._onDbxLoad === 'function') window._onDbxLoad();
        if (typeof syncHighlight === 'function') syncHighlight();
        if (typeof renderFilterBar === 'function') renderFilterBar();
      } else {
        await Swal.fire('Облако сохранено', 'За время записи появились новые местные правки. Они не заменены и ещё не синхронизированы. Общий список доступен в истории браузера.', 'info');
      }
    }
    dbxTimestamp('save', choice.kind === 'merge' ? 'версии объединены' : 'выбрана местная версия');
    return true;
  } catch (error) {
    await Swal.fire('Не удалось завершить сравнение',
      (archiveWritten ? 'Архив уже записан. ' : '') + 'Список на устройстве не заменён. '
      + String(error.message || error), 'warning');
    return false;
  } finally {
    _conflictInProgress = false;
    updateDropboxUI();
  }
}

function dbxTimestamp(type, detail = '') {
  localStorage.setItem('dbx_last_sync', JSON.stringify({ type, time: Date.now(), detail }));
}

function _dbxSaveSyncState(content, rev) {
  if (rev) localStorage.setItem('dbx_last_rev', rev);
  localStorage.setItem('dbx_last_tasks', content);
}

// ─── Строка статуса ("☁ Сохранено 2 дн 4 ч назад") ─────────────────────────

function getLastSyncText() {
  const raw = localStorage.getItem('dbx_last_sync');
  if (!raw) return '';
  try {
    const { type, time, detail = '' } = JSON.parse(raw);
    const totalMins = Math.round((Date.now() - time) / 60000);
    let when;
    if (totalMins < 1) {
      when = 'только что';
    } else if (totalMins < 60) {
      when = `${totalMins}\u00a0мин назад`;
    } else {
      const totalHours = Math.floor(totalMins / 60);
      const days       = Math.floor(totalHours / 24);
      const remHours   = totalHours % 24;
      if (days > 0 && remHours > 0) when = `${days}\u00a0дн ${remHours}\u00a0ч назад`;
      else if (days > 0)            when = `${days}\u00a0дн назад`;
      else                          when = `${totalHours}\u00a0ч назад`;
    }
    let action;
    if (type === 'save')       action = '☁ Сохранено';
    else if (type === 'check') action = '✓ Синхронизировано';
    else                       action = '⬇ Загружено';
    return `${action} ${when}${detail ? ' · ' + detail : ''}`;
  } catch (_) { return ''; }
}

// ─── Снэпшоты (локальная история) ─────────────────────────────────────────────
//   tasks_snapshots — JSON array [{ time, reason, text }, …], newest first, max 10

const SNAPSHOT_MAX = 10;
const SNAPSHOT_KEY = 'tasks_snapshots';

function saveSnapshot(reason) {
  const text = SorterRuntime.getTasks();
  if (!text.trim()) return;
  const snapshotKey = SorterRuntime.storageKey(SNAPSHOT_KEY);
  let snaps = [];
  try { snaps = JSON.parse(localStorage.getItem(snapshotKey) || '[]'); } catch (_) {}
  if (snaps.length && snaps[0].text === text) return; // нет смысла дублировать
  snaps.unshift({ time: Date.now(), reason, text });
  if (snaps.length > SNAPSHOT_MAX) snaps = snaps.slice(0, SNAPSHOT_MAX);
  localStorage.setItem(snapshotKey, JSON.stringify(snaps));
}

async function showSnapshots() {
  const snapshotKey = SorterRuntime.storageKey(SNAPSHOT_KEY);
  let snaps = [];
  try { snaps = JSON.parse(localStorage.getItem(snapshotKey) || '[]'); } catch (_) {}
  if (!snaps.length) {
    Swal.fire('Нет снэпшотов', 'Снэпшоты создаются автоматически перед каждой загрузкой из Dropbox.', 'info');
    return;
  }
  const opts = snaps.map((s, i) => {
    const d     = new Date(s.time).toLocaleString('ru');
    const lines = s.text.trim().split('\n').length;
    return `<option value="${i}">${d} — ${s.reason} (${lines} строк)</option>`;
  }).join('');
  const { value: idx } = await Swal.fire({
    title:             '↩ История версий',
    html:              `<select id="snap-sel" style="width:100%;padding:0.5rem;background:#1e1e2e;color:#cdd6f4;border:1px solid #585b70;border-radius:6px;font-size:0.82rem">${opts}</select>`,
    confirmButtonText: 'Восстановить',
    showCancelButton:  true,
    cancelButtonText:  'Отмена',
    confirmButtonColor:'#7c6fcd',
    preConfirm: () => document.getElementById('snap-sel').value,
  });
  if (idx === undefined || idx === null || idx === '') return;
  const snap = snaps[parseInt(idx, 10)];
  if (window.SorterUnsavedChanges && !await SorterUnsavedChanges.allowReplace(snap.text)) return;
  SorterRuntime.setItem('tasks_backup', document.getElementById('task-list')?.value ?? SorterRuntime.getTasks());
  SorterRuntime.setItem('tasks_backup_time', String(Date.now()));
  saveSnapshot('перед восстановлением');
  const ta = document.getElementById('task-list');
  if (ta) ta.value = snap.text;
  SorterRuntime.setTasks(snap.text);
  dbxRecordLocalTasksChange();
  if (typeof window._onDbxLoad === 'function') window._onDbxLoad();
  if (typeof syncHighlight   === 'function') syncHighlight();
  if (typeof renderFilterBar === 'function') renderFilterBar();
  scheduleAutosave();
  Swal.fire({ title: 'Восстановлено!', icon: 'success', timer: 1500, showConfirmButton: false });
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function dbxGetMetadata() {
  const token = getToken();
  if (!token) return null;
  try {
    const resp = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ path: DROPBOX_FILE_PATH }),
    });
    if (resp.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dbxGetMetadata();
      return null;
    }
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
}

// ─── Архивирование в archive.txt ────────────────────────────────────────────

// Append a confirmed batch without replacing an unreadable or concurrently
// changed archive. Only Dropbox's explicit path/not_found means an empty file.
// false means the caller must retain the tasks; it never permits local removal.
async function dbxArchiveCompleted(lines, allowRefresh = true) {
  const token = getToken();
  if (!token || !Array.isArray(lines) || !lines.length
    || lines.some(line => typeof line !== 'string' || !line.trim())) return false;
  const batch = lines.slice();
  const fail = message => {
    updateDropboxUI();
    setDbxStatus(message);
    return false;
  };

  setDbxStatus('📦 Архивирование…');

  try {
    let existing = '';
    let mode;
    const dlResp = await fetch('https://content.dropboxapi.com/2/files/download', {
      method:  'POST',
      headers: {
        'Authorization':   'Bearer ' + token,
        'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_ARCHIVE_PATH }),
      },
    });
    if (dlResp.ok) {
      existing = await dlResp.text();
      const metadata = JSON.parse(dlResp.headers.get('dropbox-api-result') || '{}');
      if (typeof metadata.rev !== 'string' || !metadata.rev) {
        return fail('Архив не записан: не удалось определить его версию');
      }
      mode = { '.tag': 'update', update: metadata.rev };
    } else if (dlResp.status === 401) {
      if (!allowRefresh) return fail('Архив не записан: требуется подключение Dropbox');
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dbxArchiveCompleted(batch, false);
      return fail('Архив не записан: требуется подключение Dropbox');
    } else if (dlResp.status === 409) {
      const error = (await dlResp.json()).error;
      if (error?.['.tag'] !== 'path' || error.path?.['.tag'] !== 'not_found') {
        return fail('Архив не записан: не удалось прочитать файл');
      }
      // A different device may create the archive after this read. add + strict
      // conflict refuses to replace that new file, even with identical contents.
      mode = 'add';
    } else {
      return fail('Архив не записан: не удалось прочитать файл');
    }

    // Preserve the existing archive byte for byte. Only the appended batch is
    // formatted; duplicate task occurrences must never be collapsed or removed.
    const separator = !existing || /(?:\r?\n){2}$/.test(existing) ? ''
      : /\r?\n$/.test(existing) ? '\n' : '\n\n';
    const newContent = existing + separator + formatTaskList(batch) + '\n';

    const ulResp = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method:  'POST',
      headers: {
        'Authorization':   'Bearer ' + token,
        'Content-Type':    'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path:       DROPBOX_ARCHIVE_PATH,
          mode,
          autorename: false,
          strict_conflict: true,
          mute:       true,
        }),
      },
      body: newContent,
    });
    if (ulResp.ok) {
      updateDropboxUI();
      return true;
    }
    if (ulResp.status === 401) {
      if (!allowRefresh) return fail('Архив не записан: требуется подключение Dropbox');
      const refreshed = await tryRefreshToken();
      // A confirmed auth rejection did not commit. Re-read after refreshing;
      // never reuse a stale archive revision. Network failures are not retried.
      if (refreshed.ok) return dbxArchiveCompleted(batch, false);
    }
    if (ulResp.status === 409) {
      return fail('Архив изменён другим устройством. Задачи остались в списке');
    }
    return fail('Запись архива не подтверждена. Задачи остались в списке');
  } catch (_) {
    // A lost upload response is ambiguous: Dropbox may already have committed.
    // Retain the local batch; an automatic retry could add it a second time.
    return fail('Архивирование не подтверждено. Проверьте связь и архив перед повтором');
  }
}

// ─── Автоматическое скачивание (без диалога) ─────────────────────────────────

async function dbxAutoDownload(detail = '', approvedState, expected) {
  if (_conflictInProgress && !expected) return false;
  const token = getToken();
  if (!token) return false;
  setDbxStatus('⬇ Загрузка…');
  try {
    const resp = await fetch('https://content.dropboxapi.com/2/files/download', {
      method:  'POST',
      headers: {
        'Authorization':   'Bearer ' + token,
        'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_FILE_PATH }),
      },
    });

    if (resp.ok) {
      const text      = await resp.text();
      const apiResult = JSON.parse(resp.headers.get('dropbox-api-result') || '{}');

      if (expected && (apiResult.rev !== expected.meta.rev || text !== expected.text ||
          dbxConflictLocalState() !== expected.localState)) {
        await Swal.fire('Версия изменилась', 'Откройте сравнение заново. Список не заменён.', 'info');
        return false;
      }

      // Check immediately before replacement: the user may have typed while fetch waited.
      if (window.SorterUnsavedChanges && !await SorterUnsavedChanges.allowReplace(text, approvedState)) {
        setDbxStatus('Загрузка отменена · правки сохранены');
        return false;
      }
      if (expected && dbxConflictLocalState() !== expected.localState) return false;
      const previousContent = document.getElementById('task-list')?.value ?? SorterRuntime.getTasks();
      SorterRuntime.setItem('tasks_backup', previousContent);
      SorterRuntime.setItem('tasks_backup_time', String(Date.now()));

      saveSnapshot('автозагрузка из Dropbox');
      const ta = document.getElementById('task-list');
      if (ta) ta.value = text;
      SorterRuntime.setTasks(text);
      dbxSetLocalVersionTime(apiResult.client_modified || apiResult.server_modified || Date.now());
      if (typeof window._onDbxLoad === 'function') window._onDbxLoad();
      _dbxSaveSyncState(text, apiResult.rev);
      dbxTimestamp('load', detail);
      updateDropboxUI();

      if (typeof syncHighlight   === 'function') syncHighlight();
      if (typeof renderFilterBar === 'function') renderFilterBar();

      return true;
    } else if (resp.status === 401) {
      if (expected?.refreshed) return false;
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dbxAutoDownload(detail, approvedState,
        expected ? { ...expected, refreshed: true } : undefined);
    } else if (resp.status === 409) {
      // Файла нет на сервере — не ошибка
    } else {
      console.error('dbxAutoDownload HTTP', resp.status);
    }
    updateDropboxUI();
    return false;
  } catch (err) {
    console.error('dbxAutoDownload error:', err);
    updateDropboxUI();
    return false;
  }
}

// ─── Автосохранение ───────────────────────────────────────────────────────────

let _autosaveTimer  = null;
let _syncInProgress = false;

function scheduleAutosave() {
  if (_conflictInProgress) return;
  if (isRuntimeDeveloperMode()) return;
  if (!getToken()) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => dbxAutoUpload('автосохранение'), AUTOSAVE_DELAY_MS);
}

async function dbxAutoUpload(detail = '') {
  if (_conflictInProgress) return;
  const token = getToken();
  if (!token) return;
  clearTimeout(_autosaveTimer);

  const ta      = document.getElementById('task-list');
  const content = ta ? ta.value : SorterRuntime.getTasks();
  const lastRev = localStorage.getItem('dbx_last_rev');
  const mode    = lastRev ? { '.tag': 'update', 'update': lastRev } : 'overwrite';

  setDbxStatus('☁ Сохранение…');
  try {
    const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method:  'POST',
      headers: {
        'Authorization':   'Bearer ' + token,
        'Content-Type':    'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path:       DROPBOX_FILE_PATH,
          mode,
          autorename: false,
          mute:       true,
        }),
      },
      body: content,
    });

    if (resp.ok) {
      const data = await resp.json();
      _dbxSaveSyncState(content, data.rev);
      dbxSetLocalVersionTime(data.client_modified || data.server_modified || Date.now());
      dbxTimestamp('save', detail);
      updateDropboxUI();

    } else if (resp.status === 409) {
      await dbxResolveConflict();

    } else if (resp.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dbxAutoUpload(detail);
      dropboxLogout();
    } else {
      console.error('dbxAutoUpload HTTP', resp.status, await resp.text());
      updateDropboxUI();
    }
  } catch (err) {
    console.error('dbxAutoUpload error:', err);
    updateDropboxUI();
  }
}

// ─── Проверка при возврате на вкладку ────────────────────────────────────────

async function autoSyncOnFocus(silent = false) {
  if (!getToken() || _syncInProgress || _conflictInProgress) return;
  _syncInProgress = true;

  if (!silent) setDbxStatus('🔄 Проверка…');

  try {
    const meta = await dbxGetMetadata();
    if (!meta) { updateDropboxUI(); return; }

    const serverRev = meta.rev;
    const lastRev   = localStorage.getItem('dbx_last_rev');
    const lastTasks = localStorage.getItem('dbx_last_tasks');
    const currTasks = SorterRuntime.getTasks();

    const neverSynced   = !lastRev;
    const serverChanged = !neverSynced && serverRev !== lastRev;
    const localChanged  = lastTasks !== null && currTasks !== lastTasks;

    if (neverSynced || !serverChanged) {
      updateDropboxUI();
      return;
    }

    if (!localChanged) {
      // Сервер новее, локально чисто → тихо скачиваем
      await dbxAutoDownload();
      return;
    }

    // Оба изменились → конфликт
    await dbxResolveConflict();
  } finally {
    _syncInProgress = false;
  }
}

// ─── Умная синхронизация ──────────────────────────────────────────────────────
// Сама определяет направление:
//   • Сервер новее, локально чисто  → скачать
//   • Локально изменено, сервер тот же → сохранить
//   • Оба изменились                → диалог конфликта
//   • Первый раз (нет rev)          → диалог выбора направления
//   • Всё совпадает                 → «Уже синхронизировано»

async function dropboxSmartSync() {
  if (!getToken()) { dropboxLogin(); return; }
  if (_syncInProgress || _conflictInProgress) return;
  _syncInProgress = true;
  setDbxStatus('🔄 Проверка…');
  try {
    const meta      = await dbxGetMetadata();
    const currTasks = SorterRuntime.getTasks();
    const lastRev   = localStorage.getItem('dbx_last_rev');
    const lastTasks = localStorage.getItem('dbx_last_tasks');

    const neverSynced   = !lastRev;
    const serverChanged = meta && !neverSynced && meta.rev !== lastRev;
    const localChanged  = lastTasks !== null && currTasks !== lastTasks;

    // Первый запуск — спросить направление
    if (neverSynced) {
      const noServer = !meta;
      const choice = await Swal.fire({
        title:             '☁ Первая синхронизация',
        html:              noServer
          ? 'Файла в Dropbox нет. Загрузить текущий список?'
          : 'Что сделать с данными?',
        icon:              'question',
        showCancelButton:  true,
        showDenyButton:    !noServer,
        confirmButtonText: '☁ Сохранить мои задачи',
        denyButtonText:    '⬇ Скачать из Dropbox',
        cancelButtonText:  'Отмена',
        confirmButtonColor:'#4ade80',
      });
      if (choice.isConfirmed)       { _syncInProgress = false; await dbxAutoUpload('первая синхронизация'); }
      else if (choice.isDenied)     { _syncInProgress = false; await dbxAutoDownload('первая синхронизация'); }
      else updateDropboxUI();
      return;
    }

    // Всё совпадает
    if (!serverChanged && !localChanged) {
      dbxTimestamp('check');
      updateDropboxUI();
      Swal.fire({ title: '✓ Всё синхронизировано', icon: 'success', timer: 1500, showConfirmButton: false });
      return;
    }

    // Сервер новее, локально чисто → тихо скачать
    if (serverChanged && !localChanged) {
      _syncInProgress = false;
      await dbxAutoDownload('сервер был новее');
      return;
    }

    // Локально изменено, сервер тот же → сохранить
    if (!serverChanged && localChanged) {
      _syncInProgress = false;
      await dbxAutoUpload('ваши изменения');
      return;
    }

    // Оба изменились → конфликт
    await dbxResolveConflict();
  } catch (err) {
    console.error('dropboxSmartSync error:', err);
    updateDropboxUI();
  } finally {
    _syncInProgress = false;
    if (window.SorterAiDropbox) await window.SorterAiDropbox.refreshJobs({ silent: true });
  }
}

// ─── Ручные кнопки (fallback) ─────────────────────────────────────────────────

async function dropboxSave() {
  if (_conflictInProgress) return;
  if (!getToken()) { dropboxLogin(); return; }
  clearTimeout(_autosaveTimer);

  const token   = getToken();
  const content = document.getElementById('task-list')?.value ?? SorterRuntime.getTasks();
  const lastRev = localStorage.getItem('dbx_last_rev');
  const mode    = lastRev ? { '.tag': 'update', 'update': lastRev } : 'overwrite';

  setDbxStatus('☁ Сохранение…');
  try {
    const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method:  'POST',
      headers: {
        'Authorization':   'Bearer ' + token,
        'Content-Type':    'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path:       DROPBOX_FILE_PATH,
          mode,
          autorename: false,
          mute:       false,
        }),
      },
      body: content,
    });

    if (resp.ok) {
      const data = await resp.json();
      _dbxSaveSyncState(content, data.rev);
      dbxSetLocalVersionTime(data.client_modified || data.server_modified || Date.now());
      dbxTimestamp('save', 'вручную');
      updateDropboxUI();
      Swal.fire({ title: 'Сохранено в Dropbox!', icon: 'success', timer: 1500, showConfirmButton: false });
    } else if (resp.status === 409) {
      await dbxResolveConflict();
    } else if (resp.status === 401) {
      localStorage.removeItem('dbx_access_token');
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dropboxSave();
      dropboxLogout();
      await Swal.fire('Сессия истекла', 'Сейчас откроется страница авторизации.', 'warning');
      dropboxLogin();
    } else {
      const errText = await resp.text();
      let msg = errText;
      try { msg = JSON.parse(errText).error_summary || errText; } catch (_) {}
      Swal.fire('Ошибка сохранения (HTTP ' + resp.status + ')', msg, 'error');
      updateDropboxUI();
    }
  } catch (err) {
    console.error('dropboxSave error:', err);
    Swal.fire('Сетевая ошибка при сохранении', String(err), 'error');
    updateDropboxUI();
  }
}

async function dropboxLoad() {
  if (_conflictInProgress) return;
  if (!getToken()) { dropboxLogin(); return; }

  const approvedState = window.SorterUnsavedChanges?.state();
  const unsavedWarning = window.SorterUnsavedChanges && (SorterUnsavedChanges.hasDraft() || SorterUnsavedChanges.hasCloudChanges())
    ? 'Есть несохранённые изменения. Введённый текст будет заменён.<br>' : '';
  const result = await Swal.fire({
    title:             'Загрузить из Dropbox?',
    html:              unsavedWarning + 'Текущий список будет заменён данными из облака.<br><small style="color:#8888ab">Резервная копия списка автоматически сохранится в браузере.</small>',
    icon:              'question',
    showCancelButton:  true,
    confirmButtonText: 'Загрузить',
    cancelButtonText:  'Отмена',
    confirmButtonColor:'#7c6fcd',
  });
  if (!result.isConfirmed) return;

  // Do not clear the revision before a download: cancellation must leave sync state intact.
  const ok = await dbxAutoDownload('вручную', approvedState);
  if (ok) Swal.fire({ title: 'Загружено из Dropbox!', icon: 'success', timer: 1500, showConfirmButton: false });
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function setDbxStatus(text) {
  const el = document.getElementById('dbx-status');
  if (el) el.textContent = text;
}

function updateDropboxUI() {
  if (isRuntimeDeveloperMode()) {
    for (const id of ['dbx-login-btn', 'dbx-sync-btn', 'dbx-save-btn', 'dbx-load-btn', 'dbx-logout-btn', 'dbx-history-btn']) {
      const button = document.getElementById(id);
      if (button) button.hidden = true;
    }
    setDbxStatus('DEV · Dropbox off');
    return;
  }
  const loggedIn = !!getToken();
  const loginBtn  = document.getElementById('dbx-login-btn');
  const syncBtn   = document.getElementById('dbx-sync-btn');
  const saveBtn   = document.getElementById('dbx-save-btn');
  const loadBtn   = document.getElementById('dbx-load-btn');
  const logoutBtn = document.getElementById('dbx-logout-btn');
  const historyBtn = document.getElementById('dbx-history-btn');
  if (loginBtn)    loginBtn.hidden    = loggedIn;
  if (syncBtn)     syncBtn.hidden     = !loggedIn;
  if (saveBtn)     saveBtn.hidden     = !loggedIn;
  if (loadBtn)     loadBtn.hidden     = !loggedIn;
  if (logoutBtn)   logoutBtn.hidden   = !loggedIn;
  if (historyBtn)  historyBtn.hidden  = !loggedIn;
  setDbxStatus(loggedIn ? getLastSyncText() : '');
}

// ─── Инициализация ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  handleOAuthCallback();
  updateDropboxUI();

  document.getElementById('dbx-login-btn')?.addEventListener('click', dropboxLogin);
  document.getElementById('dbx-sync-btn')?.addEventListener('click', dropboxSmartSync);
  document.getElementById('dbx-save-btn')?.addEventListener('click', dropboxSave);
  document.getElementById('dbx-load-btn')?.addEventListener('click', dropboxLoad);
  document.getElementById('dbx-logout-btn')?.addEventListener('click', dropboxLogout);

  // Автосохранение при изменении textarea
  const ta = document.getElementById('task-list');
  if (ta) {
    ta.addEventListener('input', () => {
      dbxRecordLocalTasksChange();
      scheduleAutosave();
    });
  }

  // Автопроверка при возврате на вкладку
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getToken()) autoSyncOnFocus();
  });

  // Обновлять строку "5 мин назад" каждую минуту
  setInterval(updateDropboxUI, 60_000);

  // Проверить при первой загрузке (тихо)
  if (getToken()) setTimeout(() => autoSyncOnFocus(true), 1000);
});
