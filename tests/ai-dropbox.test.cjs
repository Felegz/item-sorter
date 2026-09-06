const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Exchange = require('../sorter 2025/ai-exchange.js');

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function loadBrowserAdapter(fetchImpl, { quotaFailure = false } = {}) {
  const values = new Map();
  const context = {
    SorterAiExchange: Exchange,
    crypto: webcrypto,
    TextEncoder,
    Response,
    URLSearchParams,
    fetch: fetchImpl,
    getToken: () => 'browser-token',
    tryRefreshToken: async () => ({ ok: false }),
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        if (quotaFailure) {
          const error = new Error('quota');
          error.name = 'QuotaExceededError';
          throw error;
        }
        values.set(key, value);
      },
    },
    document: { addEventListener: () => {} },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    dispatchEvent: () => {},
    setTimeout: () => 0,
    console: { warn: () => {}, error: () => {} },
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('sorter 2025/ai-dropbox.js', 'utf8'), context);
  return context.SorterAiDropbox;
}

(async function () {
  {
    let uploadCount = 0;
    let downloadCount = 0;
    let storedRequest = '';
    const uploadPaths = [];
    const adapter = loadBrowserAdapter(async (url, options) => {
      if (url.includes('/files/create_folder_v2')) return jsonResponse(200, { metadata: { '.tag': 'folder' } });
      if (url.includes('/files/upload')) {
        uploadCount += 1;
        storedRequest = options.body;
        uploadPaths.push(JSON.parse(options.headers['Dropbox-API-Arg']).path);
        if (uploadCount === 1) throw new TypeError('connection lost after send');
        return jsonResponse(409, { error_summary: 'path/conflict/file/' });
      }
      if (url.includes('/files/download')) {
        downloadCount += 1;
        if (downloadCount === 1) throw new TypeError('still offline');
        return new Response(storedRequest, { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await assert.rejects(
      adapter.delegateTask('Тестовая задача', 'Найди официальный источник'),
      /не подтвердил доставку/
    );
    const retried = await adapter.delegateTask('Тестовая задача', 'Найди официальный источник');
    assert.equal(retried.status, 'pending');
    assert.equal(uploadPaths.length, 2);
    assert.equal(uploadPaths[0], uploadPaths[1], 'unknown outcome must retry the same job path');
  }

  {
    const adapter = loadBrowserAdapter(async (url) => {
      if (url.includes('/files/create_folder_v2')) return jsonResponse(200, { metadata: { '.tag': 'folder' } });
      if (url.includes('/files/upload')) return jsonResponse(200, { rev: 'request-rev' });
      throw new Error(`Unexpected URL ${url}`);
    }, { quotaFailure: true });
    const job = await adapter.delegateTask('Тестовая задача', 'Подготовь черновик');
    assert.equal(job.status, 'pending', 'a full localStorage must not turn a successful upload into failure');
    assert.equal(adapter.jobs()[0].jobId, job.jobId, 'in-memory fallback keeps the current job visible');
  }

  console.log('AI browser Dropbox adapter: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
