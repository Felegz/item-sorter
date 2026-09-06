import { createHash, randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { defaultStateDirectory, readJson, writeJsonAtomic } from './lib/local-state.mjs';

const DEFAULT_APP_KEY = 'd1t1dje9vyjotd7';
const appKey = process.env.DROPBOX_APP_KEY || DEFAULT_APP_KEY;
const stateDirectory = process.env.ITEM_SORTER_AI_STATE_DIR || defaultStateDirectory();
const verifier = randomBytes(64).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const scope = 'files.content.read files.content.write files.metadata.read';
const params = new URLSearchParams({
  client_id: appKey,
  response_type: 'code',
  token_access_type: 'offline',
  code_challenge_method: 'S256',
  code_challenge: challenge,
  scope,
});

async function detectedOpenClawConfig() {
  const npmRoot = process.env.APPDATA;
  if (npmRoot) {
    const entrypoint = path.join(npmRoot, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
    try {
      await access(entrypoint);
      return {
        executable: process.execPath,
        args: [entrypoint, 'agent', '--agent', '{agentId}', '--message', '{prompt}', '--json', '--timeout', '{timeout}'],
        agentId: 'task-assistant',
        timeoutSeconds: 600,
      };
    } catch (_) {
      // Fall through to the PATH-based command.
    }
  }
  return { executable: 'openclaw', agentId: 'task-assistant', timeoutSeconds: 600 };
}

console.log('Откройте эту ссылку, разрешите доступ и вставьте показанный Dropbox код сюда:');
console.log(`https://www.dropbox.com/oauth2/authorize?${params}`);

const prompt = createInterface({ input, output });
const code = (await prompt.question('Dropbox code: ')).trim();
prompt.close();
if (!code) throw new Error('Dropbox code is empty');

const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: appKey,
    code_verifier: verifier,
  }),
});
if (!tokenResponse.ok) {
  const body = await tokenResponse.text();
  throw new Error(`Dropbox authorization failed (${tokenResponse.status}): ${body}`);
}
const token = await tokenResponse.json();
if (!token.refresh_token) throw new Error('Dropbox did not return a refresh token');

const credentialsPath = path.join(stateDirectory, 'credentials.json');
await writeJsonAtomic(credentialsPath, {
  dropboxAppKey: appKey,
  dropboxRefreshToken: token.refresh_token,
  accountId: token.account_id || null,
  createdAt: new Date().toISOString(),
}, { secret: true });
const configPath = path.join(stateDirectory, 'config.json');
if (!(await readJson(configPath))) {
  await writeJsonAtomic(configPath, {
    dropboxAppKey: appKey,
    requestsPath: '/ai/requests',
    resultsPath: '/ai/results',
    longpollSeconds: 300,
    openclaw: await detectedOpenClawConfig(),
  });
}
console.log(`Авторизация сохранена локально: ${credentialsPath}`);
console.log(`Настройки без секретов: ${configPath}`);
