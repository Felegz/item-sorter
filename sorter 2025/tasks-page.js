const PRI_CHIP_CLS = { A:'pri-a', B:'pri-b', C:'pri-c' };
    const PRI_TAG_CLS  = { A:'t-pri-A', B:'t-pri-B', C:'t-pri-C' };
    const priOrd = p => p ? (p.charCodeAt(0) - 64) : 27; // A=1..Z=26, none=27

    let items = [];
    let tab = 'active', priF = null, projF = null, hashtagF = null;
    const ctxF = new Set();
    const autoMode = SorterAutoContext.isAutoUrl(window.location);
    let contextOperator = SorterAutoContext.getContextOperator(localStorage);
    let autoContextState = null;
    let sortMode = 'order', searchQ = '';
    let showIgnored = false, showFuture = false, rightClickedIdx = -1;
    const collapsedSections = new Set(); // хранит _raw маркеров свёрнутых секций
    let editingIdx = -1;          // индекс задачи в режиме редактирования (-1 = нет)
    let editingTempValue = null;  // временный текст редактируемой задачи

    function toggleSection(raw) {
      if (collapsedSections.has(raw)) collapsedSections.delete(raw);
      else collapsedSections.add(raw);
      render();
    }

    // --- Boolean search ---

    function searchMatches(rawText, q) {
      if (!q.trim()) return true;
      const text = rawText.toLowerCase();
      const tokens = [];
      const re = /"([^"]+)"|(OR|\|\||AND|&&)|(-[\w\u0400-\u04FF]+)|([\w\u0400-\u04FF]+)/gi;
      let m;
      while ((m = re.exec(q)) !== null) {
        if (m[1] !== undefined) tokens.push({ type: 'phrase', val: m[1].toLowerCase() });
        else if (m[2] !== undefined) tokens.push({ type: /^(OR|\|\|)$/i.test(m[2]) ? 'OR' : 'AND' });
        else if (m[3] !== undefined) tokens.push({ type: 'NOT', val: m[3].slice(1).toLowerCase() });
        else tokens.push({ type: 'word', val: m[4].toLowerCase() });
      }
      // Split by OR into groups; each group is implicitly ANDed
      const orGroups = [[]];
      for (const tok of tokens) {
        if (tok.type === 'OR') orGroups.push([]);
        else if (tok.type !== 'AND') orGroups[orGroups.length - 1].push(tok);
      }
      return orGroups.some(group =>
        group.every(tok => tok.type === 'NOT' ? !text.includes(tok.val) : text.includes(tok.val))
      );
    }

    function queryTerms(q) {
      if (!q.trim()) return [];
      const terms = [];
      const re = /"([^"]+)"|(OR|\|\||AND|&&)|(-[\w\u0400-\u04FF]+)|([\w\u0400-\u04FF]+)/gi;
      let m;
      while ((m = re.exec(q)) !== null) {
        if (m[1] !== undefined) terms.push(m[1].toLowerCase());       // quoted phrase
        else if (m[4] !== undefined) terms.push(m[4].toLowerCase());  // plain word
        // operators (m[2]) and NOT (m[3]) are skipped
      }
      return terms;
    }

    // --- Parsing ---

    function parseLine(line) {
      const parsed = TaskFormat.parseTaskLine(line);
      const item = {
        ...parsed,
        complete: parsed.completed,
        date: TaskFormat.parseIsoDateLocal(parsed.creationDate),
        dateString: () => parsed.creationDate,
        _due: parsed.dueDate,
        _threshold: parsed.thresholdDate,
        _hashtags: parsed.hashtags,
        _goal: parsed.goal,
        _difficulty: parsed.difficulty,
        _advice: parsed.advice,
        _raw: line,
      };
      item._ignored = false;
      return item;
    }

    function loadItems() {
      const raw = SorterRuntime.getTasks().split('\n');
      items = [];
      let inIgnored = false;
      for (const line of raw) {
        if (!line.trim()) continue;
        const trimmed = line.trim();
        // Маркеры секций — рендерятся как заголовки, не как задачи
        const listName = MARKERS.getListName(trimmed);
        if (listName) {
          inIgnored = listName === 'ignored';
          items.push({
            _sectionHeader: true,
            _listName: listName,
            _raw: line,
            _label: trimmed.replace(/^#+\s*/, ''),
            _ignored: inIgnored,
            complete: false,
            priority: null,
            contexts: null,
            projects: null,
          });
          continue;
        }
        const item = parseLine(line);
        item._ignored = inIgnored;
        items.push(item);
      }
      render();
    }

    function saveItems() {
      const text = formatTaskList(items.map(t => t._raw));
      const previous = SorterRuntime.getTasks();
      SorterRuntime.setTasks(text);
      if (previous !== text && typeof dbxRecordLocalTasksChange === 'function') dbxRecordLocalTasksChange();
      if (typeof scheduleAutosave === 'function') scheduleAutosave();
    }

    // --- Quick add ---

    function replaceTaskDocument(text) {
      const previous = SorterRuntime.getTasks();
      SorterRuntime.setTasks(text);
      if (previous !== text && typeof dbxRecordLocalTasksChange === 'function') dbxRecordLocalTasksChange();
      if (typeof scheduleAutosave === 'function') scheduleAutosave();
      loadItems();
    }

    function addTask(text, options = {}) {
      const result = TaskListOperations.insertTaskIntoInbox(
        items.map(item => item._raw),
        text,
        options,
      );
      replaceTaskDocument(result.text);
      return result;
    }

    // --- Filter & sort ---

    function getFiltered() {
      if (sortMode === 'order') {
        // Естественный порядок: заголовки секций всегда включаем, задачи — фильтруем
        return items.filter(t => {
          if (t._sectionHeader) return true;
          if (t._ignored && !showIgnored) return false;
          if (tab === 'active' && t.complete) return false;
          if (tab === 'done'   && !t.complete) return false;
          if (tab === 'active' && !showFuture && t._threshold && t._threshold > new Date().toISOString().slice(0, 10)) return false;
          if (priF  && t.priority !== priF) return false;
          if (!SorterAutoContext.matchesSelectedContexts(t.contexts, ctxF, contextOperator)) return false;
          if (projF && !(t.projects && t.projects.includes(projF))) return false;
          if (hashtagF && !(t._hashtags && t._hashtags.includes(hashtagF))) return false;
          if (searchQ && !searchMatches(t._raw, searchQ)) return false;
          return true;
        });
      }
      let list = items.filter(t => !t._sectionHeader && (!t._ignored || showIgnored));
      if (tab === 'active') list = list.filter(t => !t.complete);
      if (tab === 'done')   list = list.filter(t =>  t.complete);
      if (tab === 'active' && !showFuture) {
        const today = new Date().toISOString().slice(0, 10);
        list = list.filter(t => !t._threshold || t._threshold <= today);
      }
      if (priF)  list = list.filter(t => t.priority === priF);
      if (ctxF.size) list = list.filter(t =>
        SorterAutoContext.matchesSelectedContexts(t.contexts, ctxF, contextOperator)
      );
      if (projF) list = list.filter(t => t.projects && t.projects.includes(projF));
      if (hashtagF) list = list.filter(t => t._hashtags && t._hashtags.includes(hashtagF));
      if (searchQ) list = list.filter(t => searchMatches(t._raw, searchQ));
      return list;
    }

    function getSorted(list) {
      if (sortMode === 'order') return list; // сохраняем естественный порядок

      if (sortMode === 'proj') {
        // Группируем по +проект с синтетическими заголовками секций
        const groups = {};
        const noProj = [];
        for (const t of list) {
          if (t._sectionHeader) continue;
          if (t.projects && t.projects.length) {
            for (const p of t.projects) {
              if (!groups[p]) groups[p] = [];
              if (!groups[p].includes(t)) groups[p].push(t);
            }
          } else {
            noProj.push(t);
          }
        }
        const result = [];
        for (const proj of Object.keys(groups).sort()) {
          result.push({ _sectionHeader: true, _synthetic: true, _raw: '\x00proj:' + proj,
            _label: '+' + proj, _ignored: false, complete: false, priority: null, contexts: null, projects: null });
          result.push(...groups[proj]);
        }
        if (noProj.length) {
          result.push({ _sectionHeader: true, _synthetic: true, _raw: '\x00proj:none',
            _label: 'Без проекта', _ignored: false, complete: false, priority: null, contexts: null, projects: null });
          result.push(...noProj);
        }
        return result;
      }

      return list.slice().sort((a, b) => {
        if (sortMode === 'pri') return priOrd(a.priority) - priOrd(b.priority);
        if (sortMode === 'due') {
          const da = a._due || '9999-99-99', db = b._due || '9999-99-99';
          return da < db ? -1 : da > db ? 1 : 0;
        }
        if (sortMode === 'date') {
          const da = a.date ? a.date.getTime() : 0;
          const db = b.date ? b.date.getTime() : 0;
          return db - da;
        }
        return (a.text || '').localeCompare(b.text || '', 'ru');
      });
    }

    // --- Text helpers ---

    const esc   = TaskFormat.escapeHtml;
    const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

    // --- Render ---

    function render() {
      // Сохраняем текст редактируемой задачи до перерисовки
      if (editingIdx >= 0) {
        const inp = document.getElementById('edit-inp-' + editingIdx);
        if (inp) editingTempValue = inp.value;
      }
      const terms = queryTerms(searchQ);
      const show  = getSorted(getFiltered());
      document.getElementById('count').textContent = show.filter(t => !t._sectionHeader && !t._ignored).length;

      // Ignored toggle button
      const ignoredCount = items.filter(t => t._ignored).length;
      const toggleBtn = document.getElementById('ignored-toggle');
      toggleBtn.style.display = ignoredCount ? '' : 'none';
      toggleBtn.textContent = showIgnored
        ? `🙈 Скрыть игнорируемые (${ignoredCount})`
        : `👁 Показать игнорируемые (${ignoredCount})`;

      // Chip source: base tab, excluding ignored unless shown, excluding section headers
      const base = items.filter(t =>
        !t._sectionHeader &&
        (tab === 'active' ? !t.complete : tab === 'done' ? t.complete : true) &&
        (!t._ignored || showIgnored)
      );
      const pris  = [...new Set(base.map(t => t.priority).filter(Boolean))].sort();
      const ctxs  = [...new Set(base.flatMap(t => t.contexts || []))].sort();
      const projs = [...new Set(base.flatMap(t => t.projects || []))].sort();

      // Priority chips
      const priSec = document.getElementById('pri-sec');
      if (pris.length) {
        priSec.style.display = '';
        if (priF) priSec.classList.remove('collapsed'); // auto-expand when filter active
        document.getElementById('pri-row').innerHTML = pris.map(p => {
          const cc = PRI_CHIP_CLS[p] || 'pri-d';
          return `<button class="chip ${cc}${priF===p?' on':''}" onclick="setPri('${esc(p)}')">(${esc(p)})</button>`;
        }).join('');
      } else { priSec.style.display = 'none'; }

      // Context chips
      const ctxSec = document.getElementById('ctx-sec');
      if (ctxs.length) {
        ctxSec.style.display = '';
        if (ctxF.size) ctxSec.classList.remove('collapsed');
        document.getElementById('ctx-row').innerHTML = ctxs.map(c => {
          const safe = c.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          return `<button class="chip${ctxF.has(c)?' on':''}" onclick="setCtx('${safe}')">@${esc(c)}</button>`;
        }).join('');
      } else { ctxSec.style.display = 'none'; }

      const contextMatchMode = document.getElementById('context-match-mode');
      if (contextMatchMode) contextMatchMode.value = contextOperator;

      // Project chips
      const projSec = document.getElementById('proj-sec');
      if (projs.length) {
        projSec.style.display = '';
        if (projF) projSec.classList.remove('collapsed');
        document.getElementById('proj-row').innerHTML = projs.map(p => {
          const safe = p.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          return `<button class="chip${projF===p?' on':''}" onclick="setProj('${safe}')">+${esc(p)}</button>`;
        }).join('');
      } else { projSec.style.display = 'none'; }

      // Hashtag chips
      const hts = [...new Set(base.flatMap(t => t._hashtags || []))].sort();
      const htSec = document.getElementById('ht-sec');
      if (hts.length) {
        htSec.style.display = '';
        if (hashtagF) htSec.classList.remove('collapsed');
        document.getElementById('ht-row').innerHTML = hts.map(h => {
          const safe = h.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          return `<button class="chip ht-chip${hashtagF===h?' on':''}" onclick="setHashtag('${safe}')">#${esc(h)}</button>`;
        }).join('');
      } else { htSec.style.display = 'none'; }

      // Clear-filters button
      const hasFilter = !!(priF || ctxF.size || projF || hashtagF || searchQ);
      document.getElementById('clear-filters').style.display = hasFilter ? '' : 'none';

      // Archive button — показываем когда есть выполненные задачи
      const archiveBtn = document.getElementById('archive-btn');
      if (archiveBtn) archiveBtn.style.display = items.some(t => !t._sectionHeader && t.complete) ? '' : 'none';

      // Future tasks button — задачи с t: в будущем
      const futureBtn = document.getElementById('future-btn');
      if (futureBtn) {
        const today = new Date().toISOString().slice(0, 10);
        const fc = items.filter(t => !t._sectionHeader && !t.complete && t._threshold && t._threshold > today).length;
        const fcEl = document.getElementById('future-count');
        if (fcEl) fcEl.textContent = fc;
        futureBtn.style.display = fc ? '' : 'none';
        futureBtn.classList.toggle('on', showFuture);
      }

      // Task rows
      const listEl = document.getElementById('list');
      if (!show.length) {
        listEl.innerHTML = '<div class="empty">Нет задач</div>';
        return;
      }

      // В режиме 'order' и 'proj' скрываем задачи свёрнутых секций
      const hiddenBySection = new Set();
      if (sortMode === 'order' || sortMode === 'proj') {
        let currentHeader = null;
        for (const t of show) {
          if (t._sectionHeader) { currentHeader = t; continue; }
          if (currentHeader && collapsedSections.has(currentHeader._raw)) hiddenBySection.add(t);
        }
      }

      listEl.innerHTML = show.filter(t => !hiddenBySection.has(t)).map(t => {
        if (t._sectionHeader) {
          // Считаем задачи этой секции в show (до фильтра по collapsed)
          let count = 0, found = false;
          for (const s of show) {
            if (s === t) { found = true; continue; }
            if (found) {
              if (s._sectionHeader) break;
              count++;
            }
          }
          const collapsed = collapsedSections.has(t._raw);
          const safeRaw = t._raw.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const markerDate = MARKERS.getDate(t._raw);
          const markerAge = markerDate ? TaskFormat.formatRelativeAge(markerDate) : '';
          return `<div class="section-header" onclick="toggleSection('${safeRaw}')">
  <span class="section-toggle${collapsed?' collapsed':''}" aria-hidden="true"></span>
  <span class="section-label">${esc(t._label)}</span>
  ${markerAge ? `<span class="section-age">${esc(markerAge)}</span>` : ''}
  <span class="section-count">${count}</span>
</div>`;
        }
        const idx = items.indexOf(t);
        // ── Edit mode ──
        if (editingIdx === idx) {
          const allCtxs  = [...new Set(items.filter(i => !i._sectionHeader).flatMap(i => i.contexts || []))].sort();
          const allProjs = [...new Set(items.filter(i => !i._sectionHeader).flatMap(i => i.projects || []))].sort();
          const editVal  = editingTempValue !== null ? editingTempValue : t._raw;
          const priChips = ['A','B','C','D','E','F'].map(p => {
            const on = new RegExp('^\\(' + p + '\\)').test(editVal);
            return `<button class="tag-pick-chip pri-pick${on?' active-tag':''}" data-tag="${p}" onclick="togglePriOnEdit(${idx},'${p}')">(${p})</button>`;
          }).join('');
          const ctxChips = allCtxs.map(c => {
            const on = new RegExp('(^|\\s)@' + escRe(c) + '(\\s|$)').test(editVal);
            const safe = c.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            return `<button class="tag-pick-chip ctx-tag${on?' active-tag':''}" data-tag="${esc('@'+c)}" onclick="toggleTagOnEdit('@${safe}')">@${esc(c)}</button>`;
          }).join('');
          const projChips = allProjs.map(p => {
            const on = new RegExp('(^|\\s)\\+' + escRe(p) + '(\\s|$)').test(editVal);
            const safe = p.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            return `<button class="tag-pick-chip proj-tag${on?' active-tag':''}" data-tag="${esc('+'+p)}" onclick="toggleTagOnEdit('+${safe}')">+${esc(p)}</button>`;
          }).join('');
          // A rerender must use the draft date, not restore the saved task's old date.
          const currentDue = TaskFormat.parseTaskLine(editVal).dueDate || '';
          const duePicker = `<label class="tag-pick-chip due-pick-lbl" title="Дата due:">Срок <input type="date" id="due-pick-${idx}" class="due-pick-inp" value="${currentDue}" oninput="setDueOnEdit(${idx},this.value)" onchange="setDueOnEdit(${idx},this.value)" onclick="event.stopPropagation()"></label>`;
          return `<div class="task-row editing" data-idx="${idx}" data-mobile-editor-shell>
  <input type="checkbox" ${t.complete ? 'checked' : ''} onchange="toggleDone(${idx})" style="margin-top:8px;flex-shrink:0">
  <div class="task-body" style="flex:1;min-width:0">
    <button type="button" class="mobile-editor-collapse" data-mobile-editor-collapse aria-label="Свернуть редактор" title="Свернуть редактор">${SorterIcons.render('minimize-2')}</button>
    <textarea id="edit-inp-${idx}" class="task-edit-input" data-mobile-editor data-mobile-editor-layout="task" data-task-text-input
      onkeydown="handleEditKey(event,${idx})" oninput="updateTagPicker(${idx})">${esc(editVal)}</textarea>
    <div class="tag-picker" id="tag-picker-${idx}">${priChips}${ctxChips}${projChips}${duePicker}</div>
    <div class="edit-hint">Enter — сохранить &nbsp;·&nbsp; Escape — отмена &nbsp;·&nbsp; клик по тегу — добавить/убрать</div>
  </div>
  <button class="edit-confirm-btn" onclick="saveEdit(${idx})">Сохранить</button>
  <button class="edit-cancel-btn" onclick="cancelEdit()">Отмена</button>
</div>`;
        }

        const aiJob = window.SorterAiDropbox?.latestJobForTask(t._raw);
        const aiStatus = aiJob
          ? `<button type="button" class="task-ai-status ${aiJob.status}" onclick="openTaskAiJob(event,${idx})">${esc(window.SorterAiDropbox.statusLabel(aiJob))}</button>`
          : '';
        return `<div class="task-row${t.complete ? ' done' : ''}${t._ignored ? ' ignored-row' : ''}" data-idx="${idx}">
  <input type="checkbox" ${t.complete ? 'checked' : ''} onchange="toggleDone(${idx})">
  <div class="task-body">
    ${TaskFormat.renderTaskHtml(t, {
      variant: 'list',
      terms,
      leadingMeta: ['contexts', 'hashtags'],
    })}
    ${aiStatus}
  </div>
  <details class="task-actions">
    <summary aria-label="Действия" title="Действия"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></summary>
    <div class="task-actions-menu">
      <button class="edit-btn" onclick="editTask(${idx})">${SorterIcons.render('pencil')}<span>Редактировать</span></button>
      <button class="proc-btn" onclick="openProcess(${idx})">${SorterIcons.render('list-filter')}<span>Обработать</span></button>
      ${!t.complete && !t._ignored ? `<button class="rank-btn" onclick="rankTask(${idx})">${SorterIcons.render('arrow-up-down')}<span>Отсортировать</span></button>` : ''}
      <label class="task-due-action">
        ${SorterIcons.render('calendar-days')}<span>${t._due ? 'Изменить срок' : 'Добавить срок'}</span>
        <input type="date" aria-label="${t._due ? 'Изменить срок' : 'Добавить срок'}" value="${esc(t._due || '')}" onchange="applyTaskDueDate(${idx},this.value)">
      </label>
      <button class="ai-btn" onclick="delegateTaskToAi(${idx})">${SorterIcons.render('bot')}<span>Поручить ИИ</span></button>
      <button onclick="toggleDone(${idx})">${SorterIcons.render(t.complete ? 'undo-2' : 'check')}<span>${t.complete ? 'Не сделано' : 'Сделано'}</span></button>
      <button onclick="${t._ignored ? 'restoreIgnored' : 'moveToIgnored'}(${idx})">${SorterIcons.render(t._ignored ? 'eye' : 'eye-off')}<span>${t._ignored ? 'Вернуть из игнорируемых' : 'В игнорируемые'}</span></button>
      <button onclick="navigator.clipboard?.writeText(items[${idx}]._raw)">${SorterIcons.render('copy')}<span>Копировать текст</span></button>
      <button class="del-btn" onclick="deleteTask(${idx})">${SorterIcons.render('trash')}<span>Удалить</span></button>
    </div>
  </details>
</div>`;
      }).join('');
      listEl.querySelectorAll('[data-task-title]').forEach(title => {
        title.tabIndex = 0;
        title.setAttribute('role', 'button');
        title.setAttribute('aria-label', 'Редактировать задачу');
      });
    }

    // --- Actions ---

    function toggleDone(idx) {
      const t = items[idx];
      const willComplete = !t.complete;
      let newRaw;
      if (willComplete) {
        // Reuse the common operation but preserve this page's existing UTC
        // date policy. Changing calendar-day semantics is a separate fix.
        const today = new Date().toISOString().slice(0, 10);
        newRaw = TaskListOperations.setTaskCompletion(t._raw, true, { completionDate: today });
      } else {
        // Keep the legacy undo until its noncanonical-prefix differences from
        // setTaskCompletion are agreed; a refactor must not silently rewrite them.
        newRaw = t._raw.replace(/^x\s+(?:\d{4}-\d{2}-\d{2}\s+)?/, '');
      }
      const updated = parseLine(newRaw);
      updated._ignored = t._ignored;
      items[idx] = updated;
      saveItems();
      render();
    }

    function openProcess(idx) {
      window.location.href = SorterRuntime.withMode(
        '/process?task=' + encodeURIComponent(items[idx]._raw) + '&from=tasks',
      );
    }

    function compareTaskRank(candidateRaw, existingRaw, progress) {
      const candidate = TaskFormat.parseTaskLine(candidateRaw);
      const existing = TaskFormat.parseTaskLine(existingRaw);
      const step = progress?.maxComparisons
        ? `Сравнение ${progress.comparison} из максимум ${progress.maxComparisons}`
        : 'Выберите, что нужно сделать раньше';
      let settled = false;

      return new Promise((resolve, reject) => {
        const choose = relation => {
          if (settled) return;
          settled = true;
          resolve(relation);
          Swal.close();
        };
        Swal.fire({
          title: 'Что делать раньше?',
          html: `<p class="rank-progress">${esc(step)}</p>
            <div class="rank-choices">
              <button type="button" id="rank-candidate" class="rank-choice">
                ${TaskFormat.renderTaskHtml(candidate, {
                  variant: 'choice',
                  leadingMeta: ['contexts', 'hashtags'],
                })}
              </button>
              <button type="button" id="rank-existing" class="rank-choice">
                ${TaskFormat.renderTaskHtml(existing, {
                  variant: 'choice',
                  leadingMeta: ['contexts', 'hashtags'],
                })}
              </button>
            </div>`,
          showConfirmButton: false,
          showCancelButton: true,
          cancelButtonText: 'Отмена',
          buttonsStyling: false,
          allowOutsideClick: false,
          customClass: { popup: 'rank-dialog', cancelButton: 'rank-cancel' },
          didOpen: () => {
            document.getElementById('rank-candidate')?.addEventListener('click', () => choose(-1));
            document.getElementById('rank-existing')?.addEventListener('click', () => choose(1));
          },
          willClose: () => {
            if (settled) return;
            settled = true;
            const error = new Error('Ranking cancelled');
            error.name = 'AbortError';
            reject(error);
          },
        });
      });
    }

    async function rankTask(idx) {
      const details = document.querySelector(`.task-row[data-idx="${idx}"] .task-actions`);
      if (details) details.open = false;
      const item = items[idx];
      if (!item || item._sectionHeader || item.complete || item._ignored) return;

      try {
        const result = await TaskListOperations.rankTaskAtIndex(
          items.map(entry => entry._raw),
          idx,
          compareTaskRank,
        );
        replaceTaskDocument(result.text);
        await Swal.fire({
          toast: true,
          position: 'bottom-end',
          icon: 'success',
          title: `Задача помещена в SORTED · позиция ${result.sortedPosition + 1}`,
          showConfirmButton: false,
          timer: 2400,
          timerProgressBar: true,
        });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('rankTask failed', error);
        await Swal.fire('Не удалось отсортировать задачу', error?.message || String(error), 'error');
      }
    }

    async function delegateTaskToAi(idx) {
      const details = document.querySelector(`.task-row[data-idx="${idx}"] .task-actions`);
      if (details) details.open = false;
      await window.SorterAiDropbox.showDelegateDialog(items[idx]._raw);
      render();
    }

    async function openTaskAiJob(event, idx) {
      event.stopPropagation();
      const job = window.SorterAiDropbox.latestJobForTask(items[idx]._raw);
      if (job) await window.SorterAiDropbox.showJob(job);
    }

    function moveToIgnored(idx) {
      const item = items[idx];
      item._ignored = true;
      // Физически перемещаем: вырезаем задачу из текущей позиции и вставляем сразу после заголовка ИГНОРИРУЕМЫЕ
      items.splice(idx, 1);
      const insertAfter = items.findIndex(t => t._sectionHeader && t._ignored);
      if (insertAfter > -1) {
        items.splice(insertAfter + 1, 0, item);
      } else {
        items.push(item);
      }
      saveItems();
      render();
    }

    function restoreIgnored(idx) {
      const item = items[idx];
      item._ignored = false;
      // Физически перемещаем: вырезаем задачу из ignored секции и вставляем перед заголовком ИГНОРИРУЕМЫЕ
      items.splice(idx, 1);
      const ignoredHeaderIdx = items.findIndex(t => t._sectionHeader && t._ignored);
      if (ignoredHeaderIdx > -1) {
        items.splice(ignoredHeaderIdx, 0, item);
      } else {
        items.push(item);
      }
      saveItems();
      render();
    }

    function setPri(p) { priF = priF === p ? null : p; render(); }
    function setCtx(c) {
      if (ctxF.has(c)) ctxF.delete(c);
      else ctxF.add(c);
      render();
    }
    function setProj(p) { projF = projF === p ? null : p; render(); }
    function setHashtag(h) { hashtagF = hashtagF === h ? null : h; render(); }

    function toggleChipSection(id) {
      document.getElementById(id)?.classList.toggle('collapsed');
    }

    function clearAllFilters() {
      priF = projF = hashtagF = null;
      ctxF.clear();
      if (autoMode && autoContextState) autoContextState.contexts.forEach(context => ctxF.add(context));
      searchQ = '';
      const si = document.getElementById('search');
      si.value = '';
      document.getElementById('search-clear').style.display = 'none';
      render();
    }

    // --- Context menu ---

    function initContextMenu() {
      // Disabled: the old list-wide context menu intercepted selecting/cutting text.
      // Keep actions on the explicit ⋮ control and leave native contextmenu untouched.
      SorterTaskMenu.install(document.getElementById('list'));
      return;
      const listEl = document.getElementById('list');
      if (!listEl || typeof VanillaContextMenu === 'undefined') return;
      // Capture the right-clicked row index before the menu opens
      listEl.addEventListener('contextmenu', e => {
        const row = e.target.closest('.task-row[data-idx]');
        rightClickedIdx = row ? parseInt(row.dataset.idx, 10) : -1;
      }, true);
      new VanillaContextMenu({
        scope: listEl,
        theme: 'black',
        transitionDuration: 100,
        normalizePosition: true,
        menuItems: [
          { label: '✏ Редактировать', callback: () => { if (rightClickedIdx >= 0) editTask(rightClickedIdx); } },
          { label: '✓ Отметить выполненной', callback: () => { if (rightClickedIdx >= 0) toggleDone(rightClickedIdx); } },
          { label: '⚙ Обработать (GTD)', callback: () => { if (rightClickedIdx >= 0) openProcess(rightClickedIdx); } },
          { label: '↕ Отсортировать', callback: () => { if (rightClickedIdx >= 0) rankTask(rightClickedIdx); } },
          { label: 'Поручить ИИ', callback: () => { if (rightClickedIdx >= 0) delegateTaskToAi(rightClickedIdx); } },
          'hr',
          { label: '🚫 В игнорируемые', callback: () => { if (rightClickedIdx >= 0 && !items[rightClickedIdx]._ignored) moveToIgnored(rightClickedIdx); } },
          { label: '↩ Вернуть из игнорируемых', callback: () => { if (rightClickedIdx >= 0 && items[rightClickedIdx]._ignored) restoreIgnored(rightClickedIdx); } },
          'hr',
          { label: '🗑 Удалить', callback: () => { if (rightClickedIdx >= 0) deleteTask(rightClickedIdx); } },
          { label: '📋 Копировать текст', callback: () => { if (rightClickedIdx >= 0) navigator.clipboard?.writeText(items[rightClickedIdx]._raw); } },
        ],
      });
    }

    // --- Event listeners ---

    // Tabs
    document.querySelectorAll('.tab').forEach(btn => {
      btn.onclick = () => {
        tab = btn.dataset.t;
        priF = projF = null;
        if (!autoMode) ctxF.clear();
        document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b === btn));
        render();
      };
    });

    // Sort
    document.getElementById('sort').onchange = e => { sortMode = e.target.value; render(); };

    // Clear filters
    document.getElementById('clear-filters').onclick = clearAllFilters;

    document.getElementById('context-match-mode').onchange = event => {
      contextOperator = SorterAutoContext.setContextOperator(localStorage, event.target.value);
      render();
    };

    // Ignored toggle
    document.getElementById('ignored-toggle').onclick = () => { showIgnored = !showIgnored; render(); };

    // Search
    const searchInput = document.getElementById('search');
    const searchClear = document.getElementById('search-clear');
    const searchHint  = document.querySelector('.search-hint');
    searchInput.oninput = () => {
      searchQ = searchInput.value;
      searchClear.style.display = searchQ ? '' : 'none';
      render();
    };
    searchInput.addEventListener('focus', () => searchHint?.classList.add('visible'));
    searchInput.addEventListener('blur',  () => { if (!searchQ) searchHint?.classList.remove('visible'); });
    searchClear.onclick = () => {
      searchInput.value = ''; searchQ = '';
      searchClear.style.display = 'none';
      searchHint?.classList.remove('visible');
      render();
    };

    // Mobile command bar
    const mobilePanelButtons = [...document.querySelectorAll('[data-mobile-panel]')];
    const mobileScrim = document.querySelector('.mobile-scrim');

    function setMobilePanel(name = '') {
      const current = document.body.dataset.mobilePanel || '';
      const next = current === name ? '' : name;

      // Search owns the keyboard-reduced viewport. Close its keyboard before
      // returning to the normal list or opening the non-text tools sheet.
      if (current === 'search' && next !== 'search') {
        searchInput.blur();
        document.activeElement?.blur();
      }
      if (next === 'tools') document.activeElement?.blur();

      document.body.dataset.mobilePanel = next;
      // Search keeps live results readable; only modal-like sheets dim the list.
      mobileScrim.hidden = !next || next === 'search';
      mobilePanelButtons.forEach(button => {
        button.setAttribute('aria-expanded', String(button.dataset.mobilePanel === next));
      });
      if (next === 'add') requestAnimationFrame(() => addInput.focus());
      if (next === 'search') requestAnimationFrame(() => searchInput.focus());
    }

    mobilePanelButtons.forEach(button => {
      button.addEventListener('click', () => setMobilePanel(button.dataset.mobilePanel));
    });
    document.querySelectorAll('[data-mobile-close]').forEach(button => {
      button.addEventListener('click', () => setMobilePanel(''));
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !document.body.dataset.mobilePanel) return;
      if (document.body.dataset.mobilePanel === 'add') closeQuickAdd();
      else setMobilePanel('');
    });

    // Quick-add: the list operation adds a todo.txt creation date and inserts into inbox.
    const addInput = document.getElementById('add-input');
    function closeQuickAdd() {
      setMobilePanel('');
      document.activeElement?.blur();
    }

    function submitQuickAdd() {
      if (!addInput.value.trim()) return;
      addTask(addInput.value);
      addInput.value = '';
      if (window.matchMedia('(max-width: 760px)').matches) {
        closeQuickAdd();
      }
    }
    document.getElementById('add-btn').onclick = submitQuickAdd;
    addInput.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitQuickAdd();
      }
    };
    document.getElementById('add-cancel').onclick = closeQuickAdd;

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const active = document.activeElement;
      const typing = active === searchInput || active === addInput || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT';
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !typing) {
        e.preventDefault();
        searchInput.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      if (e.key === 'Escape' && active === searchInput) {
        searchInput.blur();
        if (searchQ) { searchInput.value = ''; searchQ = ''; searchClear.style.display = 'none'; render(); }
      }
    });

    // ─── Edit / Delete / Archive functions ───────────────────────────────────

    const taskListElement = document.getElementById('list');
    taskListElement.addEventListener('click', event => {
      const title = event.target.closest('[data-task-title]');
      if (!title || event.target.closest('a')) return;
      // A drag selection is not a request to open the task editor.
      if (!window.getSelection().isCollapsed) return;
      const row = title.closest('.task-row');
      if (row) editTask(Number(row.dataset.idx));
    });
    taskListElement.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const title = event.target.closest('[data-task-title]');
      if (!title) return;
      event.preventDefault();
      const row = title.closest('.task-row');
      if (row) editTask(Number(row.dataset.idx));
    });

    function editTask(idx) {
      if (editingIdx >= 0 && editingIdx !== idx) {
        // Switching keeps the existing autosave behavior, but must read the
        // same calendar and text draft as the explicit Save button.
        if (!commitEditDraft(editingIdx)) return;
      }
      editingIdx = idx;
      editingTempValue = null;
      render();
      setTimeout(() => {
        const inp = document.getElementById('edit-inp-' + idx);
        if (inp) { inp.focus(); const l = inp.value.length; inp.setSelectionRange(l, l); }
      }, 0);
    }

    function handleEditKey(e, idx) {
      if (e.key === 'Enter')  { e.preventDefault(); saveEdit(idx); }
      if (e.key === 'Escape') { cancelEdit(); }
    }

    /**
     * A full render replaces every row. Find the edited instance again after
     * the keyboard layout collapses so Save/Cancel returns to the user's task,
     * not to the beginning of a long list.
     */
    function keepTaskVisibleAfterEdit(idx) {
      const reveal = () => {
        const row = document.querySelector(`.task-row[data-idx="${idx}"]`);
        if (!row) return;
        const rect = row.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        if (rect.top < 12 || rect.bottom > viewportHeight - 12) {
          row.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      };

      requestAnimationFrame(() => requestAnimationFrame(reveal));
      window.visualViewport?.addEventListener('resize', () => {
        requestAnimationFrame(reveal);
      }, { once: true });
    }

    /**
     * Persist the current editor draft for both Save and task switching.
     * Read the calendar directly: input/change can arrive after a mobile tap.
     * Replace only the indexed occurrence, keeping its ignored section; an
     * empty draft never means deletion. Callers own closing/redrawing the UI.
     * Explicit Save historically also writes unchanged text; switching doesn't.
     */
    function commitEditDraft(idx, { saveUnchanged = false } = {}) {
      const duePicker = document.getElementById('due-pick-' + idx);
      if (duePicker) {
        if (!duePicker.checkValidity()) { duePicker.reportValidity(); return false; }
      }
      const inp    = document.getElementById('edit-inp-' + idx);
      let newRaw = (inp ? inp.value : editingTempValue || '').trim();
      // Check empty text before assigning due:, which requires a real task.
      if (!newRaw) return true;
      if (duePicker) newRaw = TaskListOperations.setTaskDueDate(newRaw, duePicker.value);
      if (!saveUnchanged && newRaw === items[idx]._raw) return true;
      const origIgnored = items[idx]._ignored;
      const newItem = parseLine(newRaw);
      newItem._ignored = origIgnored;
      items[idx] = newItem;
      saveItems();
      return true;
    }

    function saveEdit(idx) {
      if (!commitEditDraft(idx, { saveUnchanged: true })) return;
      editingIdx = -1;
      editingTempValue = null;
      render();
      keepTaskVisibleAfterEdit(idx);
    }

    function cancelEdit() {
      const idx = editingIdx;
      editingIdx = -1;
      editingTempValue = null;
      render();
      if (idx >= 0) keepTaskVisibleAfterEdit(idx);
    }

    // Обновляет подсветку чипов тегов без полного перерендера
    function updateTagPicker(idx) {
      const inp = document.getElementById('edit-inp-' + idx);
      if (!inp) return;
      editingTempValue = inp.value;
      const picker = document.getElementById('tag-picker-' + idx);
      if (!picker) return;
      picker.querySelectorAll('.tag-pick-chip').forEach(chip => {
        const tag = chip.dataset.tag;
        if (!tag) return;
        let on;
        if (/^[A-F]$/.test(tag)) {
          on = new RegExp('^\\(' + tag + '\\)').test(inp.value);
        } else if (tag.startsWith('@')) {
          on = new RegExp('(^|\\s)' + escRe(tag) + '(\\s|$)').test(inp.value);
        } else {
          on = new RegExp('(^|\\s)\\+' + escRe(tag.slice(1)) + '(\\s|$)').test(inp.value);
        }
        chip.classList.toggle('active-tag', on);
      });
      // Sync due date picker with edit input
      const duePick = document.getElementById('due-pick-' + idx);
      if (duePick) {
        const m = inp.value.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/);
        duePick.value = m ? m[1] : '';
      }
    }

    // Переключает @context или +project в строке редактирования
    function toggleTagOnEdit(tag) {
      const inp = document.getElementById('edit-inp-' + editingIdx);
      if (!inp) return;
      let text = inp.value;
      const escaped = tag.startsWith('+') ? '\\+' + escRe(tag.slice(1)) : escRe(tag);
      if (new RegExp('(^|\\s)' + escaped + '(?=\\s|$)').test(text)) {
        text = text.replace(new RegExp('\\s*' + escaped + '(?=\\s|$)'), '').trim();
      } else {
        text = (text.trim() + ' ' + tag).trim();
      }
      inp.value = text;
      editingTempValue = text;
      updateTagPicker(editingIdx);
      inp.focus();
    }

    // Переключает приоритет (A–F) в начале строки
    function togglePriOnEdit(idx, pri) {
      const inp = document.getElementById('edit-inp-' + idx);
      if (!inp) return;
      let text = inp.value;
      const priRe = /^\([A-Z]\)\s*/;
      const m = priRe.exec(text);
      if (m) {
        text = text[1] === pri
          ? text.replace(priRe, '')           // убрать тот же приоритет
          : text.replace(priRe, `(${pri}) `); // заменить на новый
      } else {
        text = `(${pri}) ` + text;            // добавить
      }
      inp.value = text;
      editingTempValue = text;
      updateTagPicker(idx);
      inp.focus();
    }

    function deleteTask(idx) {
      if (!confirm('Удалить задачу?')) return;
      if (editingIdx === idx) { editingIdx = -1; editingTempValue = null; }
      items.splice(idx, 1);
      saveItems();
      render();
    }

    // Архивирует выполненные: скачивает как done.txt и удаляет из списка
    async function archiveCompleted() {
      const completed = items.filter(t => !t._sectionHeader && t.complete);
      if (!completed.length) return;

      const useDropbox = typeof getToken === 'function' && getToken();
      const dest = useDropbox ? 'archive.txt в Dropbox' : 'файл done.txt (Dropbox не подключён)';
      if (!confirm(`Архивировать ${completed.length} выполн. задач?\nОни будут перемещены в ${dest}.`)) return;

      if (useDropbox) {
        const lines = completed.map(t => t._raw);
        const ok = await dbxArchiveCompleted(lines);
        if (!ok) {
          alert('Не удалось записать archive.txt в Dropbox. Задачи остались в списке.');
          return;
        }
        items = items.filter(t => t._sectionHeader || !t.complete);
        saveItems();
        render();
        return;
      }

      // Fallback: скачать локально
      const blob = new Blob([completed.map(t => t._raw).join('\n') + '\n'], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'done.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      items = items.filter(t => t._sectionHeader || !t.complete);
      saveItems();
      render();
    }

    function toggleFuture() { showFuture = !showFuture; render(); }

    function setDueOnEdit(idx, dateVal) {
      const inp = document.getElementById('edit-inp-' + idx);
      if (!inp) return;
      const text = TaskListOperations.setTaskDueDate(inp.value, dateVal);
      inp.value = text;
      editingTempValue = text;
      updateTagPicker(idx);
      // Do not refocus the textarea: that can dismiss the native calendar or
      // reopen the mobile keyboard before its date selection has completed.
    }

    function applyTaskDueDate(idx, dateVal) {
      const task = items[idx];
      if (!task || task._sectionHeader) return;
      const raw = TaskListOperations.setTaskDueDate(task._raw, dateVal);
      const updated = parseLine(raw);
      updated._ignored = task._ignored;
      items[idx] = updated;
      saveItems();
      render();
      keepTaskVisibleAfterEdit(idx);
    }

    // ── Автокомплит @контекст / +проект в быстром добавлении ──────────────────
    let _acItems = [], _acIdx = -1;

    function initAutocomplete() {
      const inp  = document.getElementById('add-input');
      const drop = document.getElementById('ac-drop');
      if (!inp || !drop) return;
      inp.addEventListener('input', () => _acUpdate(inp, drop));
      inp.addEventListener('keydown', e => {
        if (drop.style.display === 'none') return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          _acIdx = Math.min(_acIdx + 1, _acItems.length - 1);
          _acRender(drop);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          _acIdx = Math.max(_acIdx - 1, 0);
          _acRender(drop);
        } else if ((e.key === 'Enter' || e.key === 'Tab') && _acIdx >= 0) {
          e.preventDefault();
          e.stopPropagation();
          _acApply(inp, drop, _acItems[_acIdx]);
        } else if (e.key === 'Escape') {
          _acClose(drop);
        }
      });
      document.addEventListener('click', e => {
        if (!inp.contains(e.target) && !drop.contains(e.target)) _acClose(drop);
      });
    }

    function _acCurrentWord(inp) {
      const before = inp.value.slice(0, inp.selectionStart);
      const m = before.match(/[@+][\w\u0400-\u04FF\-_]*$/);
      if (!m) return null;
      return { word: m[0], start: inp.selectionStart - m[0].length, end: inp.selectionStart };
    }

    function _acUpdate(inp, drop) {
      const cw = _acCurrentWord(inp);
      if (!cw) { _acClose(drop); return; }
      const prefix = cw.word[0];
      const query  = cw.word.slice(1).toLowerCase();
      const source = prefix === '@'
        ? [...new Set(items.filter(t => !t._sectionHeader).flatMap(t => t.contexts || []))].sort()
        : [...new Set(items.filter(t => !t._sectionHeader).flatMap(t => t.projects  || []))].sort();
      _acItems = source.filter(s => s.toLowerCase().startsWith(query) ||
                                    (query.length > 1 && s.toLowerCase().includes(query)));
      if (!_acItems.length) { _acClose(drop); return; }
      _acIdx = -1;
      _acRender(drop);
      drop.style.display = '';
    }

    function _acRender(drop) {
      drop.innerHTML = _acItems.map((v, i) =>
        `<div class="ac-item${i === _acIdx ? ' selected' : ''}" data-i="${i}">${esc(v)}</div>`
      ).join('');
      drop.querySelectorAll('.ac-item').forEach((el, i) => {
        el.onmousedown = e => {
          e.preventDefault(); // prevent blur
          const inp = document.getElementById('add-input');
          _acApply(inp, drop, _acItems[i]);
        };
      });
    }

    function _acApply(inp, drop, value) {
      const cw = _acCurrentWord(inp);
      if (!cw) return;
      const prefix = inp.value[cw.start];
      const newVal = inp.value.slice(0, cw.start) + prefix + value + ' ' + inp.value.slice(cw.end).trimStart();
      inp.value = newVal;
      const pos = cw.start + 1 + value.length + 1;
      inp.setSelectionRange(pos, pos);
      _acClose(drop);
      inp.focus();
    }

    function _acClose(drop) {
      if (drop) drop.style.display = 'none';
      _acItems = []; _acIdx = -1;
    }

    // На мобильных — сворачиваем фильтры по умолчанию
    if (window.matchMedia('(max-width: 600px)').matches) {
      ['pri-sec', 'ctx-sec', 'proj-sec'].forEach(id =>
        document.getElementById(id)?.classList.add('collapsed')
      );
    }

    function renderAutoContextBanner() {
      const banner = document.getElementById('auto-context-banner');
      const summary = document.getElementById('auto-context-summary');
      if (!banner || !summary || !autoMode) return;
      banner.hidden = false;
      const joiner = contextOperator === 'and' ? ' и ' : ' или ';
      const selected = [...ctxF].map(context => `@${context}`).join(joiner);
      let suffix = '';
      if (autoContextState?.location === 'loading') suffix = ' · определяю место';
      else if (autoContextState?.location === 'unset') suffix = ' · координаты дома не заданы';
      else if (autoContextState?.error) suffix = ` · ${autoContextState.error}`;
      summary.textContent = `${selected || 'контексты не выбраны'}${suffix}`;
    }

    async function initAutoContextMode() {
      if (!autoMode) return;
      const deviceContext = SorterAutoContext.detectDeviceContext(navigator, window.innerWidth);
      ctxF.add(deviceContext);
      autoContextState = { contexts: [deviceContext], location: 'loading', error: null };
      renderAutoContextBanner();
      render();

      autoContextState = await SorterAutoContext.resolveAutoContexts({
        storage: localStorage,
        geolocation: navigator.geolocation,
        navigatorLike: navigator,
        viewportWidth: window.innerWidth,
      });
      ctxF.clear();
      autoContextState.contexts.forEach(context => ctxF.add(context));
      renderAutoContextBanner();
      render();
    }

    const originalRender = render;
    render = function renderWithAutoContextStatus() {
      originalRender();
      renderAutoContextBanner();
    };

    loadItems();
    initAutoContextMode();
    SorterUnsavedChanges.register('task-editor', () => {
      if (editingIdx < 0) return '';
      const value = document.getElementById('edit-inp-' + editingIdx)?.value ?? editingTempValue;
      return value != null && value.trim() !== items[editingIdx]?._raw ? JSON.stringify([editingIdx, value]) : '';
    });
    SorterUnsavedChanges.register('new-task', () => addInput.value.trim());
    initContextMenu();
    initAutocomplete();
