# Текущее состояние работы

## Цель

Сохранить восстановленный сортировочный контур и по одной команде адаптировать
его к пятисписочной модели. Текущий шаг: рабочий `Merge Arrays` для
`sorted + inboxSorted` и переименование текстового маркера `NEW ARRAY` в
`INBOX SORTED` с обратной совместимостью.

## Папка и ветка

- Папка: `C:\_Fork Projects\Sorter-pomogator`
- Ветка: `fix/sorting-pipeline`
- Production: `origin/master` (`4e1a6ae`)

## Файлы текущего набора

- восстановление и совместимость: `sorter 2025/app.js`,
  `sorter 2025/markers.js`, `sorter 2025/task-list-operations.js`;
- подключение актуальных версий скриптов: `sorter 2025/index.html`,
  `sorter 2025/tasks.html`;
- правила и документация: `AGENTS.md`, `BACKLOG.md`, `Project Structure.md`,
  `docs/SORTING_BEHAVIOR_SOURCE_OF_TRUTH.md`,
  `docs/agent-rules/sorting.md`, `PROJECT_STATE.md`;
- тесты: `tests/sorting-pipeline.test.cjs`,
  `tests/real-list-sorting-smoke.test.cjs`,
  `tests/task-list-model.test.cjs`.

Локальный `setup-context-mode.md` не относится к восстановлению сортировки и
намеренно не включается в набор для публикации.

## Восстановленные функции

Из `99cf747` дословно сохраняются тела 15 функций. `mergeArraysUI()` намеренно
адаптирована по решению владельца от 2026-09-11:

- `mergeSort`, `merge`, `compareTasks`;
- `parseArrays`, `gallopRight`, `gallopLeft`, `mergeGalloping`;
- `filterTasks`, `filterTasksUI`;
- `insertUnsortedTasksUI`;
- `heapifyDown`, `partialSortTasks`, `parseAllSections`,
  `promoteTailCandidates`, `sortTasks`.

`parseArrays()` больше не вызывается рабочей кнопкой и оставлена только как
историческая характеристика. `mergeArraysUI()` теперь читает пять списков через
`parseTaskDocument()`, сливает только `sorted + inboxSorted`, записывает через
`serializeTaskDocument()` и удаляет опустевший маркер.

Подтверждённо мёртвые и некорректные `quickSort`, `binaryInsert` и
`sortTasksv1` удалены с прямого разрешения владельца. Они не входили в дерево
вызовов даже в `99cf747` и самом первом коммите `09fa69b`.

Более поздние функции добавления задач, дат создания, Dropbox и страницы задач
не откатывались.

## Выполненные проверки

- До первой согласованной адаптации все 16 восстановленных тел были программно
  сравнены с `99cf747` и совпадали посимвольно.
- `node --check "sorter 2025/app.js"` — пройден.
- `node tests/format-task-list.test.cjs` — пройден.
- `node tests/task-list-model.test.cjs` — пройден.
- `node tests/sorting-pipeline.test.cjs` — пройден.
- `node tests/task-list-operations.test.cjs` — пройден.
- Все восемь файлов `tests/*.test.cjs` запущены одним прогоном — пройдены.
- `node tests/real-list-sorting-smoke.test.cjs` — пройден на всём приватном
  списке: 57 сортируемых задач, 30 строк ignored-tail, 322 сравнения и 86
  решений фильтра. Тексты задач тест не выводит.
- SHA-256 приватного файла до и после прогона совпал; файл не изменён, закрыт
  `.gitignore` и не отслеживается Git.
- `tests/sorting-pipeline.test.cjs` заменён на characterization-тесты поведения
  рабочего эталона `99cf747`: границы секций, последовательности сравнений,
  остановка частичной сортировки и итоговая сборка четырёх команд.
- Из `sorter 2025/task-list-operations.js` и его exports удалён ошибочный
  параллельный контур массовой сортировки: `stableMergeSort`,
  `mergeRankedLists`, локальный `heapifyDown`, `extractTopRanked`,
  `sortIncomingIntoMain`, `promotePartialIntoSorted`, `mergeInboxSorted`,
  `insertTasksIntoSorted`, `getFilterCandidates` и `rebuildAfterFilter`.
- После удаления параллельного контура и до адаптации Merge все 16 действующих
  функций были повторно сравнены с `99cf747`.
- Создан обязательный источник истины
  `docs/SORTING_BEHAVIOR_SOURCE_OF_TRUTH.md`: он описывает эталонный коммит,
  дерево вызовов, все 16 функций, точные контракты четырёх команд, исторические
  ограничения и порядок будущей пофункциональной адаптации.
- `AGENTS.md` направляет агента сначала в источник истины, затем в правила
  безопасного изменения.
- Из `Project Structure.md` и `docs/agent-rules/sorting.md` удалены утверждения
  сломанного рефакторинга, противоречившие восстановленному коду.
- Канонический маркер `inboxSorted` изменён на `INBOX SORTED`; точный legacy-
  маркер `NEW ARRAY` продолжает читаться и автоматически мигрирует при записи.
  Вхождения внутри текста задач не изменяются, перед миграцией создаётся снимок.
- `Merge Arrays` проверена на синтетическом документе со всеми пятью списками:
  последовательность сравнений сохранена, объединяются только два нужных
  массива, остальные списки и выполненные задачи сохраняются, пустой маркер
  удаляется.
- `node --check` для `markers.js` и `app.js`, а также
  `format-task-list.test.cjs`, `task-list-model.test.cjs` и
  `sorting-pipeline.test.cjs` пройдены после адаптации.
- `real-list-sorting-smoke.test.cjs` пройден на приватном списке в памяти:
  87 исходных строк, 320 сравнений, исходный файл не изменён.
- Репозиторий добавлен в глобальный `safe.directory` Git только по точному пути;
  обычный `git status` теперь работает без одноразового обхода.

## Не выполнено

- Интерактивный прогон кнопок с ответами на диалоги сравнения.
- Интерактивное ручное нажатие Merge Arrays с пользовательскими выборами.

## Следующий шаг

Зафиксировать текущий набор в рабочей ветке. Push/merge в production выполнять
только после отдельной команды владельца. Следующую адаптацию делать только для
одной выбранной функции с characterization-тестом.

## Видимость сортировочных команд

Четыре исходные пользовательские команды `Insert Unsorted Tasks`, `Sort Tasks`,
`Filter Tasks` и `Merge Arrays` находятся в постоянно видимом блоке
`.primary-actions`. На мобильном экране они образуют компактную сетку 2×2.
`Filter Tasks` и `Merge Arrays` нельзя снова переносить в закрытый блок «Ещё
инструменты» без прямого решения владельца. После адаптации пометка
`(не работает)` у Merge Arrays удалена.
