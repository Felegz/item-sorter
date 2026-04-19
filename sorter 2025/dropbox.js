// dropbox.js — Dropbox OAuth 2.0 PKCE + автоматическая синхронизация
//
// Стратегия синхронизации:
//   • visibilitychange: при возврате на вкладку → проверяем rev на сервере
//       - сервер новее, локально чисто  → тихо скачиваем
//       - оба изменились                → диалог конфликта
//       - сервер не изменился           → ничего
//   • Автосохранение: 20 с бездействия в textarea → загружаем на сервер
//       - используем mode:"update" + rev → Dropbox сам обнаружит конфликт (409)
//   • Ручные кнопки: fallback; «В Dropbox» — всегда перезапись, «Из Dropbox» — с подтверждением

const DROPBOX_APP_KEY      = 'd1t1dje9vyjotd7';
const DROPBOX_REDIRECT_URI = 'https://item-sorter.pages.dev/';
const DROPBOX_FILE_PATH    = '/tasks.txt';
const AUTOSAVE_DELAY_MS    = 20_000;

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
    scope:                 'files.content.write files.content.read',
  });

  window.location.href = 'https://www.dropbox.com/oauth2/authorize?' + params.toString();
}

async function handleOAuthCallback() {
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
  return localStorage.getItem('dbx_access_token');
}

async function tryRefreshToken() {
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
  localStorage.removeItem('dbx_access_token');
  localStorage.removeItem('dbx_refresh_token');
  localStorage.removeItem('dbx_verifier');
  updateDropboxUI();
}

// ─── Состояние синхронизации ─────────────────────────────────────────────────
//
// localStorage keys:
//   dbx_last_sync   — { type:'save'|'load', time:ms }   (для строки "5 мин назад")
//   dbx_last_rev    — rev-хэш Dropbox после последней синхронизации
//   dbx_last_tasks  — текст задач в момент последней синхронизации

function dbxTimestamp(type) {
  localStorage.setItem('dbx_last_sync', JSON.stringify({ type, time: Date.now() }));
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
    const { type, time } = JSON.parse(raw);
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
    const action = type === 'save' ? '☁ Сохранено' : '⬇ Загружено';
    return `${action} ${when}`;
  } catch (_) { return ''; }
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

// ─── Автоматическое скачивание (без диалога) ─────────────────────────────────

async function dbxAutoDownload() {
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

      const ta = document.getElementById('task-list');
      if (ta) ta.value = text;
      localStorage.setItem('tasks', text);
      _dbxSaveSyncState(text, apiResult.rev);
      dbxTimestamp('load');
      updateDropboxUI();

      if (typeof syncHighlight   === 'function') syncHighlight();
      if (typeof renderFilterBar === 'function') renderFilterBar();

      return true;
    } else if (resp.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dbxAutoDownload();
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
  if (!getToken()) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(dbxAutoUpload, AUTOSAVE_DELAY_MS);
}

async function dbxAutoUpload() {
  const token = getToken();
  if (!token) return;
  clearTimeout(_autosaveTimer);

  const ta      = document.getElementById('task-list');
  const content = ta ? ta.value : (localStorage.getItem('tasks') || '');
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
      dbxTimestamp('save');
      updateDropboxUI();

    } else if (resp.status === 409) {
      const meta   = await dbxGetMetadata();
      const modStr = meta ? new Date(meta.server_modified).toLocaleString('ru') : '?';
      const choice = await Swal.fire({
        title:             '⚠ Конфликт версий',
        html:              `Файл изменён на другом устройстве.<br><small style="color:#8888ab">Серверная версия: ${modStr}</small>`,
        icon:              'warning',
        showCancelButton:  true,
        showDenyButton:    true,
        confirmButtonText: '⬇ Взять из облака',
        denyButtonText:    '☁ Перезаписать моей',
        cancelButtonText:  'Отмена',
        confirmButtonColor:'#7c6fcd',
      });
      if (choice.isConfirmed) {
        await dbxAutoDownload();
      } else if (choice.isDenied) {
        localStorage.removeItem('dbx_last_rev');
        await dbxAutoUpload();
      } else {
        updateDropboxUI();
      }

    } else if (resp.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) return dbxAutoUpload();
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
  if (!getToken() || _syncInProgress) return;
  _syncInProgress = true;

  if (!silent) setDbxStatus('🔄 Проверка…');

  try {
    const meta = await dbxGetMetadata();
    if (!meta) { updateDropboxUI(); return; }

    const serverRev = meta.rev;
    const lastRev   = localStorage.getItem('dbx_last_rev');
    const lastTasks = localStorage.getItem('dbx_last_tasks');
    const currTasks = localStorage.getItem('tasks') || '';

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
    const modStr = new Date(meta.server_modified).toLocaleString('ru');
    const choice = await Swal.fire({
      title:             '⚠ Конфликт версий',
      html:              `Файл изменён на другом устройстве.<br><small style="color:#8888ab">Серверная версия: ${modStr}</small>`,
      icon:              'warning',
      showCancelButton:  true,
      showDenyButton:    true,
      confirmButtonText: '⬇ Взять из облака',
      denyButtonText:    '☁ Сохранить мою',
      cancelButtonText:  'Отмена',
      confirmButtonColor:'#7c6fcd',
    });
    if (choice.isConfirmed) {
      await dbxAutoDownload();
    } else if (choice.isDenied) {
      localStorage.removeItem('dbx_last_rev');
      await dbxAutoUpload();
    } else {
      updateDropboxUI();
    }
  } finally {
    _syncInProgress = false;
  }
}

// ─── Ручные кнопки (fallback) ─────────────────────────────────────────────────

async function dropboxSave() {
  if (!getToken()) { dropboxLogin(); return; }
  clearTimeout(_autosaveTimer);

  const token   = getToken();
  const content = document.getElementById('task-list').value;

  setDbxStatus('☁ Сохранение…');
  try {
    const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method:  'POST',
      headers: {
        'Authorization':   'Bearer ' + token,
        'Content-Type':    'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path:       DROPBOX_FILE_PATH,
          mode:       'overwrite',
          autorename: false,
          mute:       false,
        }),
      },
      body: content,
    });

    if (resp.ok) {
      const data = await resp.json();
      _dbxSaveSyncState(content, data.rev);
      dbxTimestamp('save');
      updateDropboxUI();
      Swal.fire({ title: 'Сохранено в Dropbox!', icon: 'success', timer: 1500, showConfirmButton: false });
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
  if (!getToken()) { dropboxLogin(); return; }

  const currentContent = document.getElementById('task-list').value;
  const result = await Swal.fire({
    title:             'Загрузить из Dropbox?',
    html:              'Текущий список будет заменён данными из облака.<br><small style="color:#8888ab">Резервная копия автоматически сохранится в браузере.</small>',
    icon:              'question',
    showCancelButton:  true,
    confirmButtonText: 'Загрузить',
    cancelButtonText:  'Отмена',
    confirmButtonColor:'#7c6fcd',
  });
  if (!result.isConfirmed) return;

  if (currentContent.trim()) {
    localStorage.setItem('tasks_backup',      currentContent);
    localStorage.setItem('tasks_backup_time', String(Date.now()));
  }

  localStorage.removeItem('dbx_last_rev');
  const ok = await dbxAutoDownload();
  if (ok) Swal.fire({ title: 'Загружено из Dropbox!', icon: 'success', timer: 1500, showConfirmButton: false });
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function setDbxStatus(text) {
  const el = document.getElementById('dbx-status');
  if (el) el.textContent = text;
}

function updateDropboxUI() {
  const loggedIn = !!getToken();
  document.getElementById('dbx-login-btn').hidden  = loggedIn;
  document.getElementById('dbx-save-btn').hidden   = !loggedIn;
  document.getElementById('dbx-load-btn').hidden   = !loggedIn;
  document.getElementById('dbx-logout-btn').hidden = !loggedIn;
  setDbxStatus(loggedIn ? getLastSyncText() : '');
}

// ─── Инициализация ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  handleOAuthCallback();
  updateDropboxUI();

  document.getElementById('dbx-login-btn').addEventListener('click', dropboxLogin);
  document.getElementById('dbx-save-btn').addEventListener('click', dropboxSave);
  document.getElementById('dbx-load-btn').addEventListener('click', dropboxLoad);
  document.getElementById('dbx-logout-btn').addEventListener('click', dropboxLogout);

  // Автосохранение при изменении textarea
  const ta = document.getElementById('task-list');
  if (ta) ta.addEventListener('input', scheduleAutosave);

  // Автопроверка при возврате на вкладку
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getToken()) autoSyncOnFocus();
  });

  // Обновлять строку "5 мин назад" каждую минуту
  setInterval(updateDropboxUI, 60_000);

  // Проверить при первой загрузке (тихо)
  if (getToken()) setTimeout(() => autoSyncOnFocus(true), 1000);
});
