/* Bounded sampling of SORTED. Reordering is a separate, explicit action after
 * the report; it only enforces answered pairs, not an unmeasured global rank. */
(function (root) {
  'use strict';
  const LIMIT = 8;
  const pairKey = pair => `${pair.left.position}:${pair.right.position}`;

  function plan(documentText, options = {}) {
    const parsed = root.parseTaskDocument(documentText);
    const markers = parsed.entries.filter(entry => entry.kind === 'marker' && entry.listName === 'sorted');
    if (markers.length !== 1) throw new Error('Для проверки нужен один основной блок SORTED. Остальные списки проверка не затрагивает.');
    const tasks = parsed.sorted.map((line, index) => ({ line, position: index + 1 }))
      .filter(task => !root.TaskFormat.parseTaskLine(task.line).completed);
    const random = options.random || Math.random;
    const excluded = options.exclude || new Set();
    const chosen = new Set();
    const pairs = [];
    const pools = { adjacent: [], nearby: [], distant: [] };
    const n = tasks.length;
    const far = Math.max(6, Math.ceil(n / 3));
    const randomIndex = length => Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
    const add = (kind, left, right) => {
      const pair = { kind, left: tasks[left], right: tasks[right] };
      if (!excluded.has(pairKey(pair))) pools[kind].push(pair);
    };
    // Bounded O(n) candidate pools, never an n² enumeration of all pairs.
    // Distances use active-task order; displayed positions retain completed slots.
    for (let left = 0; left < n - 1; left++) {
      add('adjacent', left, left + 1);
      for (let gap = 2; gap <= 5 && left + gap < n; gap++) add('nearby', left, left + gap);
      if (left + far < n) add('distant', left, left + far + randomIndex(n - left - far));
    }
    function take(pool, count) {
      const available = pool.filter(pair => !chosen.has(pairKey(pair)));
      const amount = Math.min(count, available.length, LIMIT - pairs.length);
      // Spread choices over the document rather than sampling only its top.
      for (let part = 0; part < amount; part++) {
        const start = Math.floor(part * available.length / amount);
        const end = Math.floor((part + 1) * available.length / amount);
        const pair = available[start + randomIndex(end - start)];
        chosen.add(pairKey(pair));
        pairs.push(pair);
      }
    }
    take(pools.adjacent, 4);
    take(pools.nearby, 2);
    take(pools.distant, 2);
    // Small lists or previously answered pairs may not fill a bucket.
    take([...pools.adjacent, ...pools.nearby, ...pools.distant], LIMIT - pairs.length);
    return { total: n, pairs };
  }

  async function run(sample, ask, isCurrent = () => true) {
    const answers = [];
    let stopped = false, stale = false;
    // Enforce the cap here too, even if a caller supplies a larger sample.
    for (const pair of sample.pairs.slice(0, LIMIT)) {
      if (!isCurrent()) { stale = true; break; }
      const choice = await ask(pair, answers.length + 1, Math.min(LIMIT, sample.pairs.length));
      if (!isCurrent()) { stale = true; break; }
      if (choice == null) { stopped = true; break; }
      if (!['left', 'right', 'uncertain'].includes(choice)) throw new Error('Неизвестный ответ проверки.');
      answers.push({ pair, choice });
    }
    return {
      answers, stopped, stale,
      conflicts: answers.filter(answer => answer.choice === 'right'),
      uncertain: answers.filter(answer => answer.choice === 'uncertain').length,
    };
  }

  /**
   * Find the order implied by definite votes, choosing the earliest available
   * original task each time. This keeps unvoted relationships as stable as the
   * answers allow. A cycle means the answers cannot all be true; never guess
   * which vote to discard. Positions identify duplicate task occurrences.
   *
   * Replace only active task lines in their original slots. Completed lines,
   * section markers, blank separators and line endings stay byte-for-byte;
   * this is a line-level edit, not a rebuild of the full task document.
   */
  function proposeReorder(documentText, answers) {
    if (!Array.isArray(answers)) throw new TypeError('Нужны ответы проверки.');
    const source = String(documentText);
    const parsed = root.parseTaskDocument(source);
    if (parsed.entries.filter(entry => entry.kind === 'marker' && entry.listName === 'sorted').length !== 1) {
      throw new Error('Для перестановки нужен один основной блок SORTED.');
    }

    const lines = source.split(/\r\n|\n|\r/);
    const separators = source.match(/\r\n|\n|\r/g) || [];
    const slots = [];
    let inSorted = false;
    for (let i = 0; i < lines.length; i++) {
      const marker = MARKERS.getListName(lines[i]);
      if (marker) { inSorted = marker === 'sorted'; continue; }
      if (inSorted && lines[i].trim()) slots.push({ index: i, raw: lines[i] });
    }
    if (slots.length !== parsed.sorted.length ||
        slots.some((slot, i) => slot.raw.trimEnd() !== parsed.sorted[i])) {
      throw new Error('Не удалось точно сопоставить строки SORTED. Список не изменён.');
    }

    const active = parsed.sorted.map((line, i) => ({ line, position: i + 1 }))
      .filter(task => !root.TaskFormat.parseTaskLine(task.line).completed);
    const byPosition = new Map(active.map((task, i) => [task.position, i]));
    const edges = active.map(() => new Set());
    const indegree = active.map(() => 0);
    for (const answer of answers) {
      if (answer?.choice === 'uncertain') continue;
      if (!['left', 'right'].includes(answer?.choice)) throw new Error('Неизвестный ответ проверки. Список не изменён.');
      const left = answer.pair?.left;
      const right = answer.pair?.right;
      if (!Number.isSafeInteger(left?.position) || !Number.isSafeInteger(right?.position) ||
          left.position >= right.position ||
          parsed.sorted[left.position - 1] !== left.line ||
          parsed.sorted[right.position - 1] !== right.line ||
          !byPosition.has(left.position) || !byPosition.has(right.position)) {
        throw new Error('Список изменился после голосования. Запустите проверку заново.');
      }
      const winner = byPosition.get(answer.choice === 'left' ? left.position : right.position);
      const loser = byPosition.get(answer.choice === 'left' ? right.position : left.position);
      if (!edges[winner].has(loser)) { edges[winner].add(loser); indegree[loser]++; }
    }

    const orderedIndexes = [];
    const placed = new Set();
    while (orderedIndexes.length < active.length) {
      const next = active.findIndex((_task, i) => !placed.has(i) && indegree[i] === 0);
      if (next < 0) throw new Error('Ответы противоречат друг другу. Перестановка не выполнена.');
      orderedIndexes.push(next);
      placed.add(next);
      for (const loser of edges[next]) indegree[loser]--;
    }

    const activeSlots = active.map(task => slots[task.position - 1]);
    const outputLines = lines.slice();
    orderedIndexes.forEach((from, to) => { outputLines[activeSlots[to].index] = activeSlots[from].raw; });
    const text = outputLines.map((line, i) => line + (separators[i] || '')).join('');
    const moves = orderedIndexes.filter((from, to) => from !== to).length;
    return {
      text, changed: text !== source, moves,
      ordered: orderedIndexes.map(i => active[i].line),
    };
  }

  root.TaskOrderAudit = Object.freeze({ LIMIT, pairKey, plan, run, proposeReorder });
})(globalThis);
