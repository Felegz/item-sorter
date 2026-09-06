import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function defaultStateDirectory() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (!base) throw new Error('LOCALAPPDATA or APPDATA is required');
  return path.join(base, 'ItemSorterAiBridge');
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
}

export async function writeJsonAtomic(filePath, value, { secret = false } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: secret ? 0o600 : 0o644,
  });
  await rename(temporary, filePath);
}

export async function acquireProcessLock(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await open(filePath, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    await handle.close();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existingPid = Number((await readFile(filePath, 'utf8')).trim());
    let running = Number.isInteger(existingPid) && existingPid > 0;
    if (running) {
      try { process.kill(existingPid, 0); }
      catch (probeError) { running = probeError.code !== 'ESRCH'; }
    }
    if (running) throw new Error(`AI bridge is already running (PID ${existingPid})`);
    await rm(filePath, { force: true });
    return acquireProcessLock(filePath);
  }
  return async () => rm(filePath, { force: true });
}
