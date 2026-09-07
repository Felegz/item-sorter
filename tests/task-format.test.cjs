const assert = require('node:assert/strict');
const TaskFormat = require('../sorter 2025/task-format.js');

const legacy = '(A) 2026-06-08 сфотать и Перевести что написано на направлении @дома @телефон #здоровье ➤цель:Я узнал, куда и как записаться ➤сложность:слишком сложно ➤совет:сначала отдохнуть ⟦исх.: Записаться на исследование храпа.⟧в';
const parsed = TaskFormat.parseTaskLine(legacy);

assert.equal(parsed.priority, 'A');
assert.equal(parsed.creationDate, '2026-06-08');
assert.equal(parsed.text, 'сфотать и Перевести что написано на направлении');
assert.deepEqual(parsed.contexts, ['дома', 'телефон']);
assert.deepEqual(parsed.hashtags, ['здоровье']);
assert.equal(parsed.advice, 'сначала отдохнуть');
assert.equal(parsed.source, 'Записаться на исследование храпа.');
assert.equal(parsed.unparsed, 'в');

const canonical = TaskFormat.serializeTaskLine(parsed);
assert.match(canonical, /➤цель:/);
assert.match(canonical, /➤сложность:/);
assert.match(canonical, /➤совет:/);
assert.match(canonical, /➤исходное:/);
assert.ok(!canonical.includes('⟦исх.'));

const reparsed = TaskFormat.parseTaskLine(canonical);
assert.equal(reparsed.source, parsed.source);
assert.equal(reparsed.goal, parsed.goal);
assert.equal(reparsed.advice, parsed.advice);

const completed = TaskFormat.parseTaskLine('x 2026-09-06 (B) 2026-09-01 Завершённая задача @дома #архив');
assert.equal(completed.completed, true);
assert.equal(completed.completionDate, '2026-09-06');
assert.equal(completed.creationDate, '2026-09-01');
assert.equal(completed.priority, 'B');
assert.equal(TaskFormat.serializeTaskLine(completed), 'x 2026-09-06 (B) 2026-09-01 Завершённая задача @дома #архив');

const refinedOnce = TaskFormat.mergeOriginalTask(
  '(B) 2026-09-06 Позвонить в клинику @телефон ➤цель:Узнать время',
  '2026-09-01 Записаться к врачу +здоровье #важно'
);
assert.match(refinedOnce, /➤исходное:Записаться к врачу/);
assert.match(refinedOnce, /\+здоровье/);
assert.match(refinedOnce, /#важно/);

const refinedTwice = TaskFormat.mergeOriginalTask(
  '(A) 2026-09-06 Позвонить в клинику утром ➤цель:Узнать время',
  refinedOnce
);
assert.equal(TaskFormat.parseTaskLine(refinedTwice).source, 'Записаться к врачу');

const fakeDateFns = {
  locale: { ru: {} },
  formatRelative() { return 'в следующую среду в 00:00'; },
  format() { return '18 сент.'; },
  formatDistance() { return '2 месяца назад'; },
};
const fixedNow = new Date(2026, 8, 6, 10, 0, 0);
assert.equal(TaskFormat.formatCalendarDate('2026-09-06', { now: fixedNow, dateFns: fakeDateFns }), 'сегодня');
assert.equal(TaskFormat.formatCalendarDate('2026-09-08', { now: fixedNow, dateFns: fakeDateFns }), 'послезавтра');
assert.equal(TaskFormat.formatCalendarDate('2026-09-09', { now: fixedNow, dateFns: fakeDateFns }), 'в следующую среду');
assert.equal(TaskFormat.formatTaskDate('2026-09-09', { now: fixedNow, dateFns: fakeDateFns, kind: 'due' }), 'Срок · в следующую среду');
assert.equal(TaskFormat.formatRelativeAge('2026-09-04', { now: fixedNow, dateFns: fakeDateFns }), 'позавчера');
assert.equal(TaskFormat.formatRelativeAge('2026-07-06', { now: fixedNow, dateFns: fakeDateFns }), '2 месяца назад');
assert.match(
  TaskFormat.formatVersionMoment('2026-07-06T12:30:00+02:00', { now: fixedNow, dateFns: fakeDateFns }),
  /6 июля 2026.*12:30.*2 месяца назад/
);

const unsafe = TaskFormat.parseTaskLine('<img src=x onerror=alert(1)> ➤цель:<script>alert(1)</script> ➤исходное:<b>старое</b>');
const rendered = TaskFormat.renderTaskContentHtml(unsafe, { variant: 'list' });
assert.ok(!rendered.includes('<script>'));
assert.ok(!rendered.includes('<img'));
assert.match(rendered, /Исходная задача/);
assert.match(rendered, /<details class="task-source">/);
assert.doesNotMatch(rendered, /Подробности/);

const meta = TaskFormat.renderTaskMetaHtml(parsed, { now: fixedNow, dateFns: fakeDateFns });
assert.match(meta, /@дома/);
assert.match(meta, /#здоровье/);
assert.match(meta, /Создано/);

const legacyTailDates = TaskFormat.parseTaskLine(
  '2026-09-07 Найти адрес ⟦исх.: Найти организацию.⟧ заметка due:2026-09-14 t:2026-09-10'
);
assert.equal(legacyTailDates.dueDate, '2026-09-14');
assert.equal(legacyTailDates.thresholdDate, '2026-09-10');
assert.equal(legacyTailDates.unparsed, 'заметка');
const tailMeta = TaskFormat.renderTaskMetaHtml(legacyTailDates, { now: fixedNow, dateFns: fakeDateFns });
assert.match(tailMeta, /Срок/);
assert.match(tailMeta, /Старт/);
const tailContent = TaskFormat.renderTaskContentHtml(legacyTailDates, { variant: 'list' });
assert.doesNotMatch(tailContent, /Хвост строки: due:/);

console.log('task-format tests passed');
