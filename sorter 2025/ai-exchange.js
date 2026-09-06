/* Safe, dependency-free text protocol for one AI task exchanged through Dropbox. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SorterAiExchange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'SORTER-AI-EXCHANGE/1';
  const MAX_TASK_LENGTH = 200000;
  const MAX_INSTRUCTION_LENGTH = 200000;
  const MAX_ANSWER_LENGTH = 500000;
  const MAX_SOURCES_LENGTH = 200000;
  const MAX_DOCUMENT_LENGTH = 1200000;
  const JOB_ID_RE = /^ai-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let fallbackCounter = 0;

  function normaliseText(value, field, limit) {
    if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
    const text = value.replace(/\r\n?/g, '\n');
    if (text.length > limit) throw new RangeError(`${field} is too long`);
    return text;
  }

  function validateJobId(value) {
    return typeof value === 'string' && JOB_ID_RE.test(value);
  }

  function requireJobId(value) {
    if (!validateJobId(value)) throw new TypeError('Job-ID is invalid');
    return value.toLowerCase();
  }

  function uuidFromBytes(bytes) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function createJobId() {
    const cryptoApi = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `ai-${cryptoApi.randomUUID()}`;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return `ai-${uuidFromBytes(bytes)}`;
    }
    // Last-resort compatibility fallback for old browsers. It is unique enough for a local queue,
    // but callers needing cryptographic randomness should provide Web Crypto.
    fallbackCounter = (fallbackCounter + 1) >>> 0;
    const seed = `${Date.now()}-${fallbackCounter}-${Math.random()}`;
    const bytes = new Uint8Array(16);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (seed.charCodeAt(index % seed.length) + index * 31 + Math.floor(Math.random() * 256)) & 0xff;
    }
    return `ai-${uuidFromBytes(bytes)}`;
  }

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  async function taskFingerprint(rawTask) {
    const text = normaliseText(rawTask, 'Task', MAX_TASK_LENGTH);
    const bytes = new TextEncoder().encode(text);
    const cryptoApi = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (cryptoApi && cryptoApi.subtle) {
      return `sha256:${toHex(await cryptoApi.subtle.digest('SHA-256', bytes))}`;
    }
    if (typeof require === 'function') {
      const nodeCrypto = require('node:crypto'); // guarded: never evaluated by a browser
      return `sha256:${nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
    }
    throw new Error('SHA-256 is unavailable in this environment');
  }

  function dateValue(value) {
    const text = typeof value === 'string' ? value : new Date().toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || Number.isNaN(Date.parse(text))) {
      throw new TypeError('Created-At must be an ISO UTC timestamp');
    }
    return text;
  }

  function fingerprintValue(value) {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(value)) {
      throw new TypeError('Task-Fingerprint must be a SHA-256 fingerprint');
    }
    return value.toLowerCase();
  }

  function block(name, value) {
    return `[${name}] ${value.length}\n${value}\n`;
  }

  function requestValues(input) {
    if (!input || typeof input !== 'object') throw new TypeError('Request must be an object');
    return {
      jobId: requireJobId(input.jobId),
      createdAt: dateValue(input.createdAt),
      taskFingerprint: fingerprintValue(input.taskFingerprint),
      task: normaliseText(input.task, 'Task', MAX_TASK_LENGTH),
      instruction: normaliseText(input.instruction, 'Instruction', MAX_INSTRUCTION_LENGTH),
    };
  }

  function resultValues(input) {
    if (!input || typeof input !== 'object') throw new TypeError('Result must be an object');
    if (input.status !== 'ok' && input.status !== 'error') throw new TypeError('Status must be ok or error');
    return {
      jobId: requireJobId(input.jobId),
      createdAt: dateValue(input.createdAt),
      taskFingerprint: fingerprintValue(input.taskFingerprint),
      status: input.status,
      answer: normaliseText(input.answer, 'Answer', MAX_ANSWER_LENGTH),
      sources: normaliseText(input.sources || '', 'Sources', MAX_SOURCES_LENGTH),
    };
  }

  function serializeRequest(input) {
    const value = requestValues(input);
    return `${VERSION}\nJob-ID: ${value.jobId}\nCreated-At: ${value.createdAt}\nTask-Fingerprint: ${value.taskFingerprint}\n${block('TASK', value.task)}${block('INSTRUCTION', value.instruction)}`;
  }

  function serializeResult(input) {
    const value = resultValues(input);
    return `${VERSION}\nJob-ID: ${value.jobId}\nCreated-At: ${value.createdAt}\nTask-Fingerprint: ${value.taskFingerprint}\nStatus: ${value.status}\n${block('ANSWER', value.answer)}${block('SOURCES', value.sources)}`;
  }

  function parseDocument(text, blockNames, includesStatus) {
    const document = normaliseText(text, 'Document', MAX_DOCUMENT_LENGTH);
    const statusHeader = includesStatus ? 'Status: (ok|error)\\n' : '';
    const header = new RegExp(`^${VERSION.replace('/', '\\/')}\\nJob-ID: ([^\\n]+)\\nCreated-At: ([^\\n]+)\\nTask-Fingerprint: ([^\\n]+)\\n${statusHeader}`);
    const match = header.exec(document);
    if (!match) throw new TypeError('Protocol headers are invalid or unsupported');
    const result = {
      jobId: requireJobId(match[1]),
      createdAt: dateValue(match[2]),
      taskFingerprint: fingerprintValue(match[3]),
    };
    if (includesStatus) result.status = match[4];
    let cursor = match[0].length;
    const limits = { TASK: MAX_TASK_LENGTH, INSTRUCTION: MAX_INSTRUCTION_LENGTH, ANSWER: MAX_ANSWER_LENGTH, SOURCES: MAX_SOURCES_LENGTH };
    blockNames.forEach(function (name) {
      const blockHeader = new RegExp(`^\\[${name}\\] (\\d+)\\n`);
      const blockMatch = blockHeader.exec(document.slice(cursor));
      if (!blockMatch) throw new TypeError(`Missing ${name} block`);
      const length = Number(blockMatch[1]);
      if (!Number.isSafeInteger(length) || length > limits[name]) throw new RangeError(`${name} block is too long`);
      cursor += blockMatch[0].length;
      if (cursor + length >= document.length || document[cursor + length] !== '\n') {
        throw new TypeError(`${name} block is truncated`);
      }
      result[name.toLowerCase()] = document.slice(cursor, cursor + length);
      cursor += length + 1;
    });
    if (cursor !== document.length) throw new TypeError('Unexpected data after final block');
    return result;
  }

  function parseRequest(text) { return parseDocument(text, ['TASK', 'INSTRUCTION'], false); }
  function parseResult(text) { return parseDocument(text, ['ANSWER', 'SOURCES'], true); }

  return Object.freeze({
    VERSION, MAX_TASK_LENGTH, MAX_INSTRUCTION_LENGTH, MAX_ANSWER_LENGTH, MAX_SOURCES_LENGTH,
    createJobId, validateJobId, taskFingerprint, serializeRequest, parseRequest, serializeResult, parseResult,
  });
});
