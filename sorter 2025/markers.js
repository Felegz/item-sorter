// markers.js — единый источник истины для маркеров секций todo.txt
//
// Маркеры (строгий формат):
//   SORTED (YYYY.MM.DD)          — начало полностью отсортированного блока
//   PARTIALLY SORTED (YYYY.MM.DD) — начало частично отсортированного блока
//   ИГНОРИРУЕМЫЕ ЗАДАЧИ YYYY.MM.DD — начало блока игнорируемых задач

const MARKERS = {
  // ── Проверка строки ─────────────────────────────────────────────────
  isSorted:          line => /^SORTED\s*\(/i.test(line.trim()),
  isPartiallySorted: line => /^PARTIALLY SORTED/i.test(line.trim()),
  isIgnored:         line => /^ИГНОРИРУЕМЫЕ\s+ЗАДАЧИ/i.test(line.trim()),
  isNewArray:        line => /^NEW ARRAY$/i.test(line.trim()),
  isUnordered:       line => /^НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ$/i.test(line.trim()),

  // Любой маркер секции (включая NEW ARRAY / НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ)
  isAnyMarker: line => /^(SORTED\s*\(|PARTIALLY SORTED|ИГНОРИРУЕМЫЕ\s+ЗАДАЧИ|NEW ARRAY|НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ)/i.test(line.trim()),

  // Маркеры, завершающие блок SORTED (всё, что идёт ниже — уже не SORTED)
  isSortedEnd: line => /^(PARTIALLY SORTED|ИГНОРИРУЕМЫЕ\s+ЗАДАЧИ)/i.test(line.trim()),

  // ── Генерация строк маркеров ────────────────────────────────────────
  makeSorted:  (year, month, day) => `SORTED (${year}.${month}.${day})`,
  makePartial: (year, month, day) => `PARTIALLY SORTED (${year}.${month}.${day})`,
  makeIgnored: (year, month, day) => `ИГНОРИРУЕМЫЕ ЗАДАЧИ ${year}.${month}.${day}`,
};
