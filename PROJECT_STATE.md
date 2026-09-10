# Текущее состояние работы

## Цель

Вернуть сортировочный контур к последней рабочей реализации до неудачного
рефакторинга. Источник истины — коммит
`99cf74738ae5dae1efbde23411de8308babfcec5`, непосредственный родитель
`93fa2156d1cb01d8ece1f934a14013250db23a84`.

## Папка и ветка

- Папка: `C:\_Fork Projects\Sorter-pomogator`
- Ветка: `fix/sorting-pipeline`
- Production: `origin/master` (`a489827`)

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

Из `99cf747` дословно возвращены тела функций:

- `quickSort`, `mergeSort`, `merge`, `compareTasks`;
- `parseArrays`, `gallopRight`, `gallopLeft`, `mergeGalloping`,
  `mergeArraysUI`;
- `filterTasks`, `filterTasksUI`;
- `binaryInsert`, `insertUnsortedTasksUI`;
- `heapifyDown`, `partialSortTasks`, `parseAllSections`,
  `promoteTailCandidates`, `sortTasks`;
- неиспользуемая старая `sortTasksv1` также возвращена, чтобы восстановить весь
  существовавший сортировочный код до последующей пофункциональной адаптации.

Более поздние функции добавления задач, дат создания, Dropbox и страницы задач
не откатывались.

## Выполненные проверки

- Все 19 восстановленных тел функций программно сравнены с `99cf747` — каждое
  совпадает посимвольно.
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
- После удаления параллельного контура все 19 функций в `sorter 2025/app.js`
  повторно сравнены с `99cf747`; все тела по-прежнему совпадают посимвольно.
- Создан обязательный источник истины
  `docs/SORTING_BEHAVIOR_SOURCE_OF_TRUTH.md`: он описывает эталонный коммит,
  дерево вызовов, все 19 функций, точные контракты четырёх команд, исторические
  ограничения и порядок будущей пофункциональной адаптации.
- `AGENTS.md` направляет агента сначала в источник истины, затем в правила
  безопасного изменения.
- Из `Project Structure.md` и `docs/agent-rules/sorting.md` удалены утверждения
  сломанного рефакторинга, противоречившие восстановленному коду.

## Не выполнено

- Интерактивный прогон кнопок с ответами на диалоги сравнения.
- Переименование, рефакторинг или адаптация восстановленных функций.

## Следующий шаг

После публикации владелец может интерактивно проверить кнопки на копии списка.
Любую последующую адаптацию выполнять только для одной выбранной функции за раз:
сначала добавить characterization-тест её поведения из `99cf747`, затем менять
реализацию, не затрагивая остальные функции.
