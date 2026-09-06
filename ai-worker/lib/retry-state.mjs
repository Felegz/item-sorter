export function recordFailure(state, jobId, detail, now = Date.now()) {
  const previousAttempts = Number(state.failed[jobId]?.attempts) || 0;
  const attempts = previousAttempts + 1;
  const retrySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
  state.failed[jobId] = {
    at: new Date(now).toISOString(),
    error: String(detail).slice(0, 1000),
    attempts,
    nextAttemptAt: new Date(now + retrySeconds * 1000).toISOString(),
  };
  return state.failed[jobId];
}

export function dueFailureIds(state, now = Date.now()) {
  return Object.entries(state.failed || {})
    .filter(([, failure]) => !failure.nextAttemptAt || Date.parse(failure.nextAttemptAt) <= now)
    .map(([jobId]) => jobId);
}
