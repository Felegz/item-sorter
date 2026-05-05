# Copilot instructions — Sorter-pomogator

## context-mode (MANDATORY)

This workspace has context-mode MCP tools. Use them for ALL file reading and analysis.
Never dump raw file contents into context.

### Tool hierarchy

| Task | Tool |
|---|---|
| Explore / analyze files | `ctx_batch_execute` |
| Follow-up search | `ctx_search` |
| Fetch web pages | `ctx_fetch_and_index` |
| Process / analyze data | `ctx_execute` or `ctx_execute_file` |
| Edit a file | `read_file` → then edit tools |

### Forbidden
- `read_file` for exploration — use `ctx_execute_file`
- `fetch_webpage` — use `ctx_fetch_and_index`
- Raw output >20 lines in context — process in code, log only the answer

---

## Project overview

Vanilla JS + HTML todo.txt task manager. Files in `sorter 2025/`:
- `app.js` — main logic (sort, filter, merge, compare tasks via SweetAlert2)
- `process.html` — GTD processing flow (FLOWS object defines steps)
- `todotxt.js` — parser + syntax highlighter for todo.txt format
- `markers.js` — section marker constants (SORTED, PARTIALLY SORTED, ИГНОРИРУЕМЫЕ ЗАДАЧИ)
- `dropbox.js` — Dropbox OAuth integration
- `style.css` — dark theme styles
- `tasks.html` / `tasks-v1.html` — task tracker views

Tasks stored in `localStorage` key `"tasks"`.
