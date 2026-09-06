const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const exchange = require('../sorter 2025/ai-exchange.js');

(async function () {
  const jobId = exchange.createJobId();
  assert.match(jobId, /^ai-/);
  assert.equal(exchange.validateJobId(jobId), true);
  assert.equal(exchange.validateJobId('ai-not-a-uuid'), false);

  const browserContext = vm.createContext({ TextEncoder, Uint8Array, Date, Math });
  vm.runInContext(fs.readFileSync('sorter 2025/ai-exchange.js', 'utf8'), browserContext);
  assert.equal(typeof browserContext.SorterAiExchange.serializeRequest, 'function');

  const task = 'Позвонить в организацию\r\n\r\n[TASK] 999\nи уточнить условия';
  const fingerprint = await exchange.taskFingerprint(task);
  assert.equal(fingerprint, await exchange.taskFingerprint(task.replace(/\r\n/g, '\n')));

  const request = { jobId, createdAt: '2026-09-06T10:11:12.000Z', taskFingerprint: fingerprint, task, instruction: 'Подготовь ответ.\n[INSTRUCTION] 0' };
  const requestText = exchange.serializeRequest(request);
  const parsedRequest = exchange.parseRequest(requestText);
  assert.deepEqual(parsedRequest, { ...request, task: task.replace(/\r\n/g, '\n') });

  const result = { jobId, createdAt: '2026-09-06T10:12:12.000Z', taskFingerprint: fingerprint, status: 'ok', answer: 'Готово — ссылка:\n[ANSWER] 1', sources: 'https://example.test/документ\n[SOURCES] 2' };
  const resultText = exchange.serializeResult(result);
  assert.deepEqual(exchange.parseResult(resultText), result);
  const errorResult = { ...result, status: 'error', answer: 'Не удалось подключиться.' };
  assert.deepEqual(exchange.parseResult(exchange.serializeResult(errorResult)), errorResult);

  assert.throws(() => exchange.parseRequest(requestText.replace('[TASK] ', '[TASK] 9999999')), /too long|truncated/);
  assert.throws(() => exchange.parseRequest(requestText.slice(0, -2)), /truncated|Unexpected/);
  assert.throws(() => exchange.parseResult(resultText + 'junk'), /Unexpected/);
  assert.throws(() => exchange.serializeRequest({ ...request, task: 'x'.repeat(exchange.MAX_TASK_LENGTH + 1) }), /too long/);
  assert.throws(() => exchange.serializeResult({ ...result, jobId: 'bad' }), /invalid/);
  assert.throws(() => exchange.serializeResult({ ...result, status: 'pending' }), /Status/);
  assert.throws(() => exchange.parseResult(resultText.replace('Status: ok\n', '')), /headers/);

  console.log('ai exchange protocol: passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
