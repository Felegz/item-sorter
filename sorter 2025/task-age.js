// Presentation-only task age. Never writes task text, dates, sections or cloud files.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaskAge = api;
})(globalThis, function (root) {
  'use strict';
  const DEFAULT_MONTHS = 2;
  const STORAGE_KEY = 'old_task_months';

  function validMonths(value) {
    const months = Number(value);
    return Number.isSafeInteger(months) && months > 0;
  }

  // SorterRuntime isolates this preference in developer mode just like task storage.
  function getMonths(storage = root.SorterRuntime) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      return validMonths(value) ? Number(value) : DEFAULT_MONTHS;
    } catch (_) { return DEFAULT_MONTHS; }
  }

  function setMonths(value, storage = root.SorterRuntime) {
    if (!validMonths(value)) throw new Error('Укажите целое число месяцев больше нуля');
    const months = Number(value);
    storage.setItem(STORAGE_KEY, months);
    return months;
  }

  function isOldTask(task, options = {}) {
    const format = options.taskFormat || root.TaskFormat;
    const dateFns = options.dateFns || root.dateFns;
    // Unknown creation age is not inferred from due:, snz: or completion dates.
    // If the existing date-fns dependency is unavailable, do not guess the boundary.
    if (!task.creationDate || !dateFns?.addMonths || !dateFns?.startOfDay || !dateFns?.isMatch) return false;
    if (!dateFns.isMatch(task.creationDate, 'yyyy-MM-dd')) return false;
    const created = format.parseIsoDateLocal(task.creationDate);
    if (!created) return false;
    const months = validMonths(options.months) ? Number(options.months) : DEFAULT_MONTHS;
    const threshold = dateFns.startOfDay(dateFns.addMonths(created, months));
    const today = dateFns.startOfDay(new Date(options.now || new Date()));
    // Anniversary is inclusive. date-fns clamps Jan 31 + 1 month to Feb 28/29.
    return Number.isFinite(threshold.getTime()) && today >= threshold;
  }

  return Object.freeze({ DEFAULT_MONTHS, STORAGE_KEY, validMonths, getMonths, setMonths, isOldTask });
});
