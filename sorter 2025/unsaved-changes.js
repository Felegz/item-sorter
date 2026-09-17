/* Guard drafts separately from locally persisted tasks. Never upload or alter data here. */
(function (root) {
  const drafts = new Map();
  let approvedNavigation = false;
  const content = () => document.getElementById('task-list')?.value ?? SorterRuntime.getTasks();
  function state() {
    return JSON.stringify([content(), [...drafts].map(([name, read]) => [name, read()])]);
  }
  function hasDraft() {
    return content() !== SorterRuntime.getTasks() || [...drafts.values()].some(read => Boolean(read()));
  }
  function hasCloudChanges() {
    if (SorterRuntime.isDeveloperMode || typeof getToken !== 'function' || !getToken()) return false;
    const baseline = localStorage.getItem('dbx_last_tasks');
    return baseline !== null && content() !== baseline;
  }
  async function ask(message, action) {
    if (!root.Swal) return root.confirm(message);
    const result = await root.Swal.fire({ title: 'Несохранённые изменения', text: message,
      icon: 'warning', showCancelButton: true, confirmButtonText: action,
      cancelButtonText: 'Остаться', focusCancel: true });
    return result.isConfirmed;
  }
  async function allowReplace(incoming, approvedState) {
    // Approval expires when any draft or document changes during the network request.
    if (approvedState === state()) return true;
    if (!hasDraft() && (!hasCloudChanges() || incoming === content())) return true;
    return ask('Загрузка заменит список и закроет редактор. Несохранённый текст будет потерян.', 'Заменить список');
  }
  root.addEventListener('beforeunload', event => {
    if (!approvedNavigation && (hasDraft() || hasCloudChanges())) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  // Internal navigation needs a draft warning too, but cloud-pending data is safely local.
  document.addEventListener('click', async event => {
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
    if (hasDraft()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!await ask('Уйти со страницы без сохранения введённого текста?', 'Уйти без сохранения')) return;
      approvedNavigation = true;
      location.href = url.href;
      return;
    }
    approvedNavigation = true;
    setTimeout(() => { approvedNavigation = false; }, 1000);
  }, true);
  const confirmDiscard = async (message, action) => !hasDraft() || await ask(message, action);
  root.SorterUnsavedChanges = { register: (name, read) => drafts.set(name, read), content, state, hasDraft, hasCloudChanges, allowReplace, confirmDiscard };
})(globalThis);
