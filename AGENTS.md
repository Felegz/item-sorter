# Project interaction rules

## Questions and decisions

- When the user needs to choose from a finite list of options, use the available structured question UI so the choices appear as clickable buttons and the selected answer is inserted into the chat input.
- Do not substitute letter-coded or numbered pseudo-buttons such as `1A, 2B, 3A` for an available structured question UI.
- When a decision genuinely needs explanation, context, or nuance, ask an open-ended question and let the user answer in free form.
- If the structured question UI is unavailable, do not pretend that a plain-text list is interactive. Ask for a free-form answer or defer the closed-choice question until the structured UI is available.

## Canonical task-list serialization

- `formatTaskList()` in `sorter 2025/markers.js` is the single source of truth for assembling the complete `todo.txt` task list.
- Any code that filters, sorts, merges, inserts, imports, or otherwise rebuilds the complete list must pass its result through `formatTaskList()`. Do not assemble a complete list with a direct `join('\n')` or `join('\n\n')`.
- The required layout is exactly one empty line between neighboring tasks and exactly one empty line before a new section marker. A section marker stays directly adjacent to the first task in that section.
- Line-level edits may preserve the existing array with `join('\n')` only when they do not discard or reconstruct its blank separator lines.
- Before finishing a change to list assembly, run `node tests/format-task-list.test.cjs` and the JavaScript syntax checks for every changed script.
- The owner's real task list is stored only at `private-test-data/default-tasks.txt`. The directory is ignored by Git. It is the default local fixture for realistic testing and must never be committed, uploaded, quoted, or included in screenshots.

Example of the canonical layout:

```text
SORTED (2026.09.05)
First task

Second task

PARTIALLY SORTED (2026.09.05)
Third task
```

## Комментарии в коде

- Объясняй комментариями функции, чьё назначение или влияние на данные нельзя
  сразу понять по имени и сигнатуре.
- Обязательно документируй бизнес-правила, неочевидные ограничения и причины,
  по которым код намеренно отключён, но сохранён для будущей переработки.
- Не пересказывай комментариями очевидный синтаксис: комментарий должен отвечать
  на вопросы «зачем?» и «что нельзя случайно сломать?», а не «что делает строка?».
