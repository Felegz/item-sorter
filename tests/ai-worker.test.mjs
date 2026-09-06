import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DropboxClient } from '../ai-worker/lib/dropbox-client.mjs';
import { buildAssistantPrompt, runOpenClaw } from '../ai-worker/lib/openclaw-runner.mjs';
import { dueFailureIds, recordFailure } from '../ai-worker/lib/retry-state.mjs';

function jsonResponse(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

{
  const calls = [];
  const client = new DropboxClient({
    appKey: 'app-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { changes: false });
    },
  });
  await client.longpoll('opaque-cursor', 300);
  assert.equal(calls[0].url, 'https://notify.dropboxapi.com/2/files/list_folder/longpoll');
  assert.equal(calls[0].options.headers.Authorization, undefined, 'longpoll must not send a token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { cursor: 'opaque-cursor', timeout: 300 });
}

{
  const state = { failed: {} };
  const baseTime = Date.parse('2026-09-06T12:00:00.000Z');
  const failure = recordFailure(state, 'ai-job', 'temporary Dropbox error', baseTime);
  assert.equal(failure.attempts, 1);
  assert.deepEqual(dueFailureIds(state, baseTime + 1000), []);
  assert.deepEqual(dueFailureIds(state, baseTime + 2000), ['ai-job']);
  const second = recordFailure(state, 'ai-job', 'temporary Dropbox error', baseTime + 2000);
  assert.equal(second.attempts, 2);
  assert.equal(Date.parse(second.nextAttemptAt) - (baseTime + 2000), 4000);
}

{
  const calls = [];
  const client = new DropboxClient({
    appKey: 'app-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { metadata: { '.tag': 'folder' } });
    },
  });
  await client.ensureFolder('/ai/requests');
  assert.equal(calls[0].url, 'https://api.dropboxapi.com/2/files/create_folder_v2');
  assert.deepEqual(JSON.parse(calls[0].options.body), { path: '/ai/requests', autorename: false });
}

{
  const client = new DropboxClient({
    appKey: 'app-key',
    accessToken: 'access-token',
    fetchImpl: async () => jsonResponse(409, { error_summary: 'path/conflict/folder/' }),
  });
  assert.equal(await client.ensureFolder('/ai/requests'), null, 'existing folder is success');
}

{
  const client = new DropboxClient({
    appKey: 'app-key',
    accessToken: 'access-token',
    fetchImpl: async () => jsonResponse(409, { error_summary: 'path/conflict/file/' }),
  });
  await assert.rejects(client.ensureFolder('/ai/requests'), /HTTP 409/, 'a file at the folder path is not success');
}

{
  const calls = [];
  const client = new DropboxClient({
    appKey: 'app-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { rev: '1' });
    },
  });
  await client.uploadTextAdd('/ai/results/ai-id.txt', 'result');
  const apiArgument = JSON.parse(calls[0].options.headers['Dropbox-API-Arg']);
  assert.deepEqual(apiArgument.mode, { '.tag': 'add' });
  assert.equal(apiArgument.autorename, false);
  assert.equal(apiArgument.strict_conflict, true);
}

{
  const calls = [];
  const client = new DropboxClient({
    appKey: 'app-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { metadata: { name: 'test.txt' } });
    },
  });
  await client.deleteFile('/ai/test.txt');
  assert.equal(calls[0].url, 'https://api.dropboxapi.com/2/files/delete_v2');
  assert.deepEqual(JSON.parse(calls[0].options.body), { path: '/ai/test.txt' });
}

{
  const calls = [];
  const client = new DropboxClient({
    appKey: 'app-key',
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/oauth2/token')) return jsonResponse(200, { access_token: 'new-token' });
      return jsonResponse(200, { cursor: 'cursor-1' });
    },
  });
  assert.deepEqual(await client.getLatestCursor('/ai/requests'), { cursor: 'cursor-1' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer new-token');
}

{
  const prompt = buildAssistantPrompt({ jobId: 'ai-id', task: 'Task body', instruction: 'Research it' });
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /<TASK>\nTask body\n<\/TASK>/);
  assert.match(prompt, /<USER_INSTRUCTION>\nResearch it\n<\/USER_INSTRUCTION>/);
}

{
  let invocation;
  const spawnImpl = (executable, args, options) => {
    invocation = { executable, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.write(JSON.stringify({ ok: true, status: 'ok', final: 'Prepared answer' }));
      child.stdout.end();
      child.emit('close', 0);
    });
    return child;
  };
  const result = await runOpenClaw('Safe prompt', { executable: 'openclaw-test', agentId: 'task-assistant', timeoutSeconds: 1 }, { spawnImpl });
  assert.equal(result.answer, 'Prepared answer');
  assert.equal(invocation.executable, 'openclaw-test');
  assert.equal(invocation.options.shell, false);
  assert.ok(invocation.args.includes('Safe prompt'));
}

{
  let invocation;
  const spawnImpl = (executable, args) => {
    invocation = { executable, args };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify({ final: 'Done' }));
      child.emit('close', 0);
    });
    return child;
  };
  await runOpenClaw('Prompt', {
    executable: 'node',
    agentId: 'assistant',
    timeoutSeconds: 42,
    args: ['openclaw.mjs', '--agent', '{agentId}', '--message', '{prompt}', '--timeout', '{timeout}'],
  }, { spawnImpl });
  assert.deepEqual(invocation.args, ['openclaw.mjs', '--agent', 'assistant', '--message', 'Prompt', '--timeout', '42']);
}

console.log('AI worker adapters: passed');
