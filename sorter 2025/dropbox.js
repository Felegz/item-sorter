// dropbox.js — Dropbox OAuth 2.0 PKCE + sync

const DROPBOX_APP_KEY = 'd1t1dje9vyjotd7';
const DROPBOX_REDIRECT_URI = 'https://item-sorter.pages.dev/';
const DROPBOX_FILE_PATH = '/tasks.txt';

// --- PKCE helpers ---

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

function base64urlEncode(array) {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// --- Авторизация ---

async function dropboxLogin() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('dbx_verifier', verifier);

  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    redirect_uri: DROPBOX_REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: 'files.content.write files.content.read',
  });

  window.location.href = 'https://www.dropbox.com/oauth2/authorize?' + params.toString();
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;

  // Убираем ?code=... из адресной строки
  window.history.replaceState({}, '', window.location.pathname);

  const verifier = localStorage.getItem('dbx_verifier');
  if (!verifier) {
    Swal.fire('Ошибка', 'Не найден code_verifier — попробуйте войти снова', 'error');
    return;
  }

  try {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: DROPBOX_APP_KEY,
        redirect_uri: DROPBOX_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      localStorage.setItem('dbx_access_token', data.access_token);
      if (data.refresh_token) {
        localStorage.setItem('dbx_refresh_token', data.refresh_token);
      }
      localStorage.removeItem('dbx_verifier');
      updateDropboxUI();
      Swal.fire({
        title: 'Dropbox подключён!',
        text: 'Теперь можно сохранять и загружать задачи.',
        icon: 'success',
        timer: 2000,
        showConfirmButton: false,
      });
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

// Try to silently refresh the access token using the stored refresh token.
// Returns true if a new access token was obtained.
async function tryRefreshToken() {
  const refresh = localStorage.getItem('dbx_refresh_token');
  if (!refresh) return { ok: false, reason: 'Нет сохранённого refresh-токена' };
  try {
    const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: DROPBOX_APP_KEY,
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

// --- Сохранить в Dropbox ---

function dbxTimestamp(type) {
  localStorage.setItem('dbx_last_sync', JSON.stringify({ type, time: Date.now() }));
}

function getLastSyncText() {
  const raw = localStorage.getItem('dbx_last_sync');
  if (!raw) return '';
  try {
    const { type, time } = JSON.parse(raw);
    const mins = Math.round((Date.now() - time) / 60000);
    const when = mins < 1 ? '\u0442\u043e\u043b\u044c\u043a\u043e \u0447\u0442\u043e' : mins < 60 ? `${mins}\u00a0\u043c\u0438\u043d \u043d\u0430\u0437\u0430\u0434` : `${Math.round(mins / 60)}\u00a0\u0447 \u043d\u0430\u0437\u0430\u0434`;
    const action = type === 'save' ? '\u2601 \u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e' : '\u2193 \u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u043e';
    return `${action} ${when}`;
  } catch(_) { return ''; }
}

async function dropboxSave() {
  const token = getToken();
  if (!token) {
    dropboxLogin();
    return;
  }

  const content = document.getElementById('task-list').value;

  try {
    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: DROPBOX_FILE_PATH,
          mode: 'overwrite',
          autorename: false,
          mute: false,
        }),
      },
      body: content,
    });

    const responseText = await response.text();
    if (response.ok) {
      dbxTimestamp('save');
      updateDropboxUI();
      Swal.fire({ title: 'Сохранено в Dropbox!', icon: 'success', timer: 1500, showConfirmButton: false });
    } else if (response.status === 401) {
      localStorage.removeItem('dbx_access_token');
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) {
        return dropboxSave();
      } else {
        dropboxLogout();
        await Swal.fire('Сессия Dropbox истекла', 'Не удалось обновить токен автоматически.\n\nПричина: ' + refreshed.reason + '\n\nСейчас откроется страница авторизации.', 'warning');
        dropboxLogin();
      }
    } else {
      console.error('Upload error HTTP', response.status, responseText);
      let errMsg = responseText;
      try { errMsg = JSON.parse(responseText).error_summary || responseText; } catch(_) {}
      Swal.fire('Ошибка сохранения (HTTP ' + response.status + ')', errMsg, 'error');
    }
  } catch (err) {
    console.error('dropboxSave exception:', err);
    Swal.fire('Сетевая ошибка при сохранении', String(err), 'error');
  }
}

// --- Загрузить из Dropbox ---

async function dropboxLoad() {
  const token = getToken();
  if (!token) {
    dropboxLogin();
    return;
  }

  // Confirmation + backup of current state
  const currentContent = document.getElementById('task-list').value;
  const result = await Swal.fire({
    title: '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0438\u0437 Dropbox?',
    html: '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0441\u043f\u0438\u0441\u043e\u043a \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u043c\u0435\u043d\u0451\u043d \u0434\u0430\u043d\u043d\u044b\u043c\u0438 \u0438\u0437 \u043e\u0431\u043b\u0430\u043a\u0430.<br><small style="color:#8888ab">\u0420\u0435\u0437\u0435\u0440\u0432\u043d\u0430\u044f \u043a\u043e\u043f\u0438\u044f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0441\u044f \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.</small>',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c',
    cancelButtonText: '\u041e\u0442\u043c\u0435\u043d\u0430',
    confirmButtonColor: '#7c6fcd',
  });
  if (!result.isConfirmed) return;

  // Backup current content before overwriting
  if (currentContent.trim()) {
    localStorage.setItem('tasks_backup', currentContent);
    localStorage.setItem('tasks_backup_time', String(Date.now()));
  }

  try {
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_FILE_PATH }),
      },
    });

    const responseText = await response.text();
    if (response.ok) {
      document.getElementById('task-list').value = responseText;
      localStorage.setItem('tasks', responseText);
      dbxTimestamp('load');
      updateDropboxUI();
      Swal.fire({ title: 'Загружено из Dropbox!', icon: 'success', timer: 1500, showConfirmButton: false });
    } else if (response.status === 401) {
      localStorage.removeItem('dbx_access_token');
      const refreshed = await tryRefreshToken();
      if (refreshed.ok) {
        return dropboxLoad();
      } else {
        dropboxLogout();
        await Swal.fire('Сессия Dropbox истекла', 'Не удалось обновить токен автоматически.\n\nПричина: ' + refreshed.reason + '\n\nСейчас откроется страница авторизации.', 'warning');
        dropboxLogin();
      }
    } else if (response.status === 409) {
      Swal.fire('Файл не найден', 'Сначала сохраните задачи в Dropbox с этого устройства', 'info');
    } else {
      console.error('Download error HTTP', response.status, responseText);
      let errMsg = responseText;
      try { errMsg = JSON.parse(responseText).error_summary || responseText; } catch(_) {}
      Swal.fire('Ошибка загрузки (HTTP ' + response.status + ')', errMsg, 'error');
    }
  } catch (err) {
    console.error('dropboxLoad exception:', err);
    Swal.fire('Сетевая ошибка при загрузке', String(err), 'error');
  }
}

// --- Обновить состояние кнопок ---

function updateDropboxUI() {
  const loggedIn = !!getToken();
  document.getElementById('dbx-login-btn').hidden = loggedIn;
  document.getElementById('dbx-save-btn').hidden = !loggedIn;
  document.getElementById('dbx-load-btn').hidden = !loggedIn;
  document.getElementById('dbx-logout-btn').hidden = !loggedIn;
  const statusEl = document.getElementById('dbx-status');
  if (statusEl) statusEl.textContent = loggedIn ? getLastSyncText() : '';
}

// --- Инициализация ---

document.addEventListener('DOMContentLoaded', () => {
  handleOAuthCallback();
  updateDropboxUI();

  document.getElementById('dbx-login-btn').addEventListener('click', dropboxLogin);
  document.getElementById('dbx-save-btn').addEventListener('click', dropboxSave);
  document.getElementById('dbx-load-btn').addEventListener('click', dropboxLoad);
  document.getElementById('dbx-logout-btn').addEventListener('click', dropboxLogout);
});
