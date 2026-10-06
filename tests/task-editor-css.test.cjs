const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('sorter 2025/tasks.css', 'utf8');
// These four base selectors are deliberately unindented and outside @media.
// This source contract checks consolidation, not browser layout or CSS parsing.
function baseRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...css.matchAll(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^{}]*)\\}', 'g'))];
  assert.equal(rules.length, 1, selector + ' must have one base rule');
  return Object.fromEntries(rules[0][1].split(';').filter(value => value.trim()).map(value => {
    const colon = value.indexOf(':');
    return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
  }));
}

assert.deepEqual(baseRule('.task-row.editing'), {
  'align-items': 'flex-start',
  'grid-template-columns': '24px minmax(0, 1fr) auto auto',
  background: 'var(--bg-card)',
  'border-radius': '12px',
  border: '1px solid var(--border-h)',
  margin: '6px 0',
  padding: '12px',
});
assert.deepEqual(baseRule('.task-edit-input'), {
  width: '100%',
  'font-family': 'inherit',
  outline: 'none',
  resize: 'vertical',
  'box-sizing': 'border-box',
  'min-height': '90px',
  padding: '11px 12px',
  border: '1px solid var(--border)',
  'border-radius': '10px',
  background: 'var(--bg)',
  color: 'var(--fg)',
  'caret-color': 'var(--primary)',
  'font-size': '0.9rem',
  'line-height': '1.5',
});
assert.deepEqual(baseRule('.tag-picker'), {
  display: 'flex', 'flex-wrap': 'wrap', gap: '6px', 'margin-top': '9px',
});
assert.deepEqual(baseRule('.edit-hint'), {
  'font-size': '0.67rem', color: 'var(--fg-m)', 'margin-top': '0.3rem', opacity: '0.7',
});
assert.ok(css.indexOf('.task-edit-input {') < css.indexOf('body.mobile-editor-active'));
console.log('PASS consolidated editor base styles and preserved declaration values');
