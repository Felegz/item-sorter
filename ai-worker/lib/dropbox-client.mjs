const API_HOST = 'https://api.dropboxapi.com/2';
const CONTENT_HOST = 'https://content.dropboxapi.com/2';
const NOTIFY_HOST = 'https://notify.dropboxapi.com/2';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

export class DropboxApiError extends Error {
  constructor(message, { status = 0, body = '', retryAfter = null } = {}) {
    super(message);
    this.name = 'DropboxApiError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

function retryAfterSeconds(response) {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readError(response, operation) {
  const body = await response.text();
  throw new DropboxApiError(`${operation} failed with HTTP ${response.status}`, {
    status: response.status,
    body,
    retryAfter: retryAfterSeconds(response),
  });
}

export class DropboxClient {
  constructor({ appKey, refreshToken, accessToken = '', fetchImpl = globalThis.fetch }) {
    if (!appKey) throw new Error('Dropbox app key is required');
    if (!refreshToken && !accessToken) throw new Error('Dropbox refresh or access token is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.appKey = appKey;
    this.refreshToken = refreshToken;
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('Dropbox refresh token is not configured');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.appKey,
    });
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) await readError(response, 'Dropbox token refresh');
    const payload = await response.json();
    if (!payload.access_token) throw new Error('Dropbox token response has no access_token');
    this.accessToken = payload.access_token;
    return this.accessToken;
  }

  async withToken(operation) {
    if (!this.accessToken) await this.refreshAccessToken();
    try {
      return await operation(this.accessToken);
    } catch (error) {
      if (!(error instanceof DropboxApiError) || error.status !== 401 || !this.refreshToken) throw error;
      await this.refreshAccessToken();
      return operation(this.accessToken);
    }
  }

  async rpc(route, argument) {
    return this.withToken(async token => {
      const response = await this.fetch(`${API_HOST}${route}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(argument),
      });
      if (!response.ok) await readError(response, `Dropbox ${route}`);
      return response.json();
    });
  }

  listFolder(path) {
    return this.rpc('/files/list_folder', {
      path,
      recursive: false,
      include_deleted: true,
      include_media_info: false,
      include_non_downloadable_files: false,
    });
  }

  listFolderContinue(cursor) {
    return this.rpc('/files/list_folder/continue', { cursor });
  }

  getLatestCursor(path) {
    return this.rpc('/files/list_folder/get_latest_cursor', {
      path,
      recursive: false,
      include_deleted: true,
      include_media_info: false,
      include_non_downloadable_files: false,
    });
  }

  createFolder(path) {
    return this.rpc('/files/create_folder_v2', {
      path,
      autorename: false,
    });
  }

  async ensureFolder(path) {
    try {
      return await this.createFolder(path);
    } catch (error) {
      if (error instanceof DropboxApiError && error.status === 409 && /conflict[\s\S]*folder/i.test(error.body)) {
        return null;
      }
      throw error;
    }
  }

  async longpoll(cursor, timeout = 300) {
    // Dropbox deliberately authenticates this route with the opaque cursor,
    // not an Authorization header. Keeping tokens off the notify host is required.
    const response = await this.fetch(`${NOTIFY_HOST}/files/list_folder/longpoll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor, timeout }),
    });
    if (!response.ok) await readError(response, 'Dropbox longpoll');
    return response.json();
  }

  async downloadText(path) {
    return this.withToken(async token => {
      const response = await this.fetch(`${CONTENT_HOST}/files/download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({ path }),
        },
      });
      if (!response.ok) await readError(response, `Dropbox download ${path}`);
      return response.text();
    });
  }

  async uploadTextAdd(path, text) {
    return this.withToken(async token => {
      const response = await this.fetch(`${CONTENT_HOST}/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
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
      if (!response.ok) await readError(response, `Dropbox upload ${path}`);
      return response.json();
    });
  }

  deleteFile(path) {
    return this.rpc('/files/delete_v2', { path });
  }
}
