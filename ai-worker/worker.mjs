import path from 'node:path';
import { createRequire } from 'node:module';
import { DropboxApiError, DropboxClient } from './lib/dropbox-client.mjs';
import { buildAssistantPrompt, runOpenClaw } from './lib/openclaw-runner.mjs';
import { acquireProcessLock, defaultStateDirectory, readJson, writeJsonAtomic } from './lib/local-state.mjs';
import { dueFailureIds, recordFailure } from './lib/retry-state.mjs';

const require = createRequire(import.meta.url);
const Exchange = require('../sorter 2025/ai-exchange.js');
const stateDirectory = process.env.ITEM_SORTER_AI_STATE_DIR || defaultStateDirectory();
const configPath = process.env.ITEM_SORTER_AI_CONFIG || path.join(stateDirectory, 'config.json');
const credentialsPath = process.env.ITEM_SORTER_AI_CREDENTIALS || path.join(stateDirectory, 'credentials.json');
const statePath = path.join(stateDirectory, 'worker-state.json');
const lockPath = path.join(stateDirectory, 'worker.lock');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const baseName = value => value.slice(value.lastIndexOf('/') + 1);

function redactSecrets(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [скрыто]')
    .replace(/(?:access|refresh)[_-]?token["'\s:=]+[A-Za-z0-9._~+/=-]+/gi, 'token=[скрыто]');
}

function errorDetail(error) {
  const detail = error instanceof DropboxApiError
    ? `${error.message}: ${error.body.slice(0, 500)}`
    : error instanceof Error ? error.message : String(error);
  return redactSecrets(detail);
}

function isNotFound(error) {
  return error instanceof DropboxApiError && error.status === 409 && /not_found/i.test(error.body);
}

function requiresCursorReset(error) {
  return error instanceof DropboxApiError
    && error.status === 409
    && /(reset|not_found)/i.test(error.body);
}

function extractSources(answer) {
  const urls = String(answer).match(/https?:\/\/[^\s<>()\[\]{}"']+/gi) || [];
  return [...new Set(urls.map(url => url.replace(/[.,;:!?]+$/, '')))].join('\n');
}

function pruneJobHistory(state, limit = 2000) {
  for (const key of ['completed', 'failed']) {
    const entries = Object.entries(state[key] || {});
    if (entries.length <= limit) continue;
    entries.sort((a, b) => String(b[1]?.at || b[1]).localeCompare(String(a[1]?.at || a[1])));
    state[key] = Object.fromEntries(entries.slice(0, limit));
  }
}

function jobIdFromEntry(entry, requestsPath) {
  if (entry['.tag'] !== 'file' || !entry.path_lower?.startsWith(`${requestsPath.toLowerCase()}/`)) return null;
  const filename = baseName(entry.path_lower);
  if (!filename.endsWith('.txt')) return null;
  const id = filename.slice(0, -4);
  return Exchange.validateJobId(id) ? id : null;
}

async function resultExists(dropbox, resultsPath, jobId) {
  try {
    const result = Exchange.parseResult(await dropbox.downloadText(`${resultsPath}/${jobId}.txt`));
    if (result.jobId !== jobId) throw new Error(`Job ID mismatch in result ${jobId}.txt`);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function processRequest({ dropbox, config, state, entry }) {
  const jobId = jobIdFromEntry(entry, config.requestsPath);
  if (!jobId) return;
  if (state.completed[jobId]) {
    delete state.failed[jobId];
    return;
  }
  if (await resultExists(dropbox, config.resultsPath, jobId)) {
    state.completed[jobId] = new Date().toISOString();
    delete state.failed[jobId];
    return;
  }

  console.log(`[${jobId}] поручение получено`);
  const requestText = await dropbox.downloadText(`${config.requestsPath}/${jobId}.txt`);
  const request = Exchange.parseRequest(requestText);
  if (request.jobId !== jobId) throw new Error(`Job ID mismatch in ${jobId}.txt`);

  const prompt = buildAssistantPrompt({
    jobId,
    task: request.task,
    instruction: request.instruction,
  });
  let status = 'ok';
  let answer;
  try {
    const execution = await runOpenClaw(prompt, config.openclaw);
    answer = execution.answer;
  } catch (error) {
    status = 'error';
    answer = `OpenClaw не смог обработать поручение.\n\n${errorDetail(error)}`;
  }
  const resultText = Exchange.serializeResult({
    jobId,
    createdAt: new Date().toISOString(),
    taskFingerprint: request.taskFingerprint,
    status,
    answer,
    sources: extractSources(answer),
  });
  await dropbox.uploadTextAdd(`${config.resultsPath}/${jobId}.txt`, resultText);
  state.completed[jobId] = new Date().toISOString();
  delete state.failed[jobId];
  console.log(`[${jobId}] ${status === 'ok' ? 'результат сохранён' : 'ошибка сохранена для показа в трекере'}`);
}

async function processEntries(context, entries) {
  for (const entry of entries) {
    const jobId = jobIdFromEntry(entry, context.config.requestsPath);
    if (!jobId) continue;
    try {
      await processRequest({ ...context, entry });
      await writeJsonAtomic(statePath, context.state);
    } catch (error) {
      // Keep the job in an explicit retry queue while the cursor advances so
      // unrelated queue traffic can continue.
      console.error(`[${jobId}] ошибка: ${errorDetail(error)}`);
      recordFailure(context.state, jobId, errorDetail(error));
      pruneJobHistory(context.state);
      await writeJsonAtomic(statePath, context.state);
    }
  }
}

async function retryFailed(context) {
  const retryIds = dueFailureIds(context.state);
  for (const jobId of retryIds) {
    const entry = {
      '.tag': 'file',
      path_lower: `${context.config.requestsPath}/${jobId}.txt`.toLowerCase(),
    };
    try {
      await processRequest({ ...context, entry });
    } catch (error) {
      if (isNotFound(error)) {
        console.warn(`[${jobId}] request удалён; повтор отменён`);
        delete context.state.failed[jobId];
        await writeJsonAtomic(statePath, context.state);
        continue;
      }
      console.error(`[${jobId}] повтор не удался: ${errorDetail(error)}`);
      recordFailure(context.state, jobId, errorDetail(error));
    }
    pruneJobHistory(context.state);
    await writeJsonAtomic(statePath, context.state);
  }
}

async function scanAll(context) {
  let page = await context.dropbox.listFolder(context.config.requestsPath);
  while (true) {
    await processEntries(context, page.entries || []);
    context.state.cursor = page.cursor;
    await writeJsonAtomic(statePath, context.state);
    if (!page.has_more) return;
    page = await context.dropbox.listFolderContinue(page.cursor);
  }
}

async function ensureExchangeFolders(context) {
  const paths = new Set();
  for (const configuredPath of [context.config.requestsPath, context.config.resultsPath]) {
    const parts = configuredPath.split('/').filter(Boolean);
    for (let length = 1; length <= parts.length; length += 1) {
      paths.add(`/${parts.slice(0, length).join('/')}`);
    }
  }
  for (const folderPath of paths) await context.dropbox.ensureFolder(folderPath);
}

async function drainChanges(context) {
  let page = await context.dropbox.listFolderContinue(context.state.cursor);
  while (true) {
    await processEntries(context, page.entries || []);
    context.state.cursor = page.cursor;
    await writeJsonAtomic(statePath, context.state);
    if (!page.has_more) return;
    page = await context.dropbox.listFolderContinue(page.cursor);
  }
}

async function main() {
  const releaseLock = await acquireProcessLock(lockPath);
  const stop = async code => {
    await releaseLock();
    process.exit(code);
  };
  process.once('SIGINT', () => { void stop(130); });
  process.once('SIGTERM', () => { void stop(143); });

  try {
    const [rawConfig, credentials] = await Promise.all([
      readJson(configPath),
      readJson(credentialsPath),
    ]);
    if (!rawConfig) throw new Error(`Create ${configPath} from ai-worker/config.example.json`);
    if (!credentials?.dropboxRefreshToken) throw new Error('Run node ai-worker/auth.mjs first');
    const config = {
      requestsPath: rawConfig.requestsPath || '/ai/requests',
      resultsPath: rawConfig.resultsPath || '/ai/results',
      longpollSeconds: Math.min(480, Math.max(30, rawConfig.longpollSeconds || 300)),
      openclaw: rawConfig.openclaw || {},
    };
    const dropbox = new DropboxClient({
      appKey: credentials.dropboxAppKey || rawConfig.dropboxAppKey,
      refreshToken: credentials.dropboxRefreshToken,
    });
    const state = await readJson(statePath, { cursor: null, completed: {}, failed: {} });
    state.completed ||= {};
    state.failed ||= {};
    const context = { config, dropbox, state };

    console.log('AI bridge запущен; частого опроса нет, ожидаю события Dropbox.');
    await ensureExchangeFolders(context);
    if (!state.cursor) await scanAll(context);
    else {
      try { await drainChanges(context); }
      catch (error) {
        if (!requiresCursorReset(error)) throw error;
        state.cursor = null;
        await scanAll(context);
      }
    }
    await retryFailed(context);

    let retrySeconds = 2;
    while (true) {
      try {
        const notification = await dropbox.longpoll(state.cursor, config.longpollSeconds);
        if (notification.backoff) await delay(notification.backoff * 1000);
        if (notification.changes) await drainChanges(context);
        await retryFailed(context);
        retrySeconds = 2;
      } catch (error) {
        console.error(`Dropbox ожидание прервано: ${errorDetail(error)}`);
        if (requiresCursorReset(error)) {
          state.cursor = null;
          await ensureExchangeFolders(context);
          await scanAll(context);
          retrySeconds = 2;
          continue;
        }
        const serverDelay = error instanceof DropboxApiError ? error.retryAfter : null;
        await delay((serverDelay ?? retrySeconds) * 1000);
        retrySeconds = Math.min(300, retrySeconds * 2);
      }
    }
  } finally {
    await releaseLock();
  }
}

main().catch(error => {
  console.error(errorDetail(error));
  process.exitCode = 1;
});
