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

---

## UI / Design conventions

**Button system — Revolut design tokens.** All new buttons across all pages must use the established CSS classes and tokens. Never create ad-hoc inline styles or new button variants.

### CSS variables (defined in `style.css` and `tasks.css`)
```
--bg, --bg-card, --bg-elevated, --fg, --fg-muted
--primary: #4ade80  --primary-hover: #22c55e
--border, --border-hover
--radius: 0.375rem
```

### Button classes
| Class | Usage |
|---|---|
| `button` (default) | General action — `background: var(--bg-el); border: 1px solid var(--border)` |
| `.btn--accent` | Primary CTA — green fill `var(--primary)`, `color: #0d1117`, `font-weight: 700` |
| `.btn--ghost` | Secondary / subtle — transparent + border, `color: var(--fg)` |
| `.btn--sm` | Small variant — `font-size: 0.77rem; padding: 0.35rem 0.75rem` |

In `process.html` (inline styles): use `.btn`, `.btn-p` (primary), `.btn-g` (ghost) — same token values.

### Rules
- `border-radius` always `var(--radius)` (0.375rem) for rectangular buttons; `9999px` only for pill tabs
- `font-weight: 600` minimum; `700` for accent/primary
- `letter-spacing: -0.01em` on all buttons
- `line-height: 1` to ensure consistent height
- Hover: `translateY(-1px)` + increased box-shadow
- Focus: `outline: 2px solid var(--primary); outline-offset: 2px`
- Font: `'Inter', system-ui, sans-serif` (inherited from body)
