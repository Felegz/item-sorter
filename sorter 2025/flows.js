// ==========================================================================
//  АЛГОРИТМ — редактируй этот объект, чтобы изменить вопросы и порядок.
//
//  Типы шагов:
//    choice   — кнопки выбора; choices: [{label, style?, next?, action?, back?, pri?, switch?}]
//    text     — ввод текста; field (куда сохранять), next ИЛИ action
//    date     — выбор даты; field, next ИЛИ action
//    contexts — выбор @контекстов чипами; chips[], next
//
//  В choices:
//    next    — id следующего шага (переход вперёд)
//    action  — завершить: trash/someday/ref/delegate/calendar/now/next_action/output
//    back    — перейти на конкретный шаг (для петлей: «вернуться к п.2»)
//    switch  — переключить флоу на другой ('mutny')
//    style   — класс кнопки (yes / no / warn / danger)
//    pri     — установить приоритет (red / green)
// ==========================================================================
const FLOWS = {

  korz: [
    { id: 'actionable',
      q: 'С этим надо что-то делать?',
      hint: '',
      type: 'choice',
      choices: [
        { label: '\u2714 Да \u2014 нужно делать',          style: 'yes', next: 'mine'     },
        { label: '\u2718 Нет \u2014 действий не нужно',    style: 'no',  next: 'noaction' },
        { label: '\uD83C\uDFB2 Не знаю \u2014 бросить монетку', style: '',    next: 'coinflip' },
      ],
    },
    { id: 'noaction',
      q: 'Что сделать с этим?',
      hint: '',
      type: 'choice',
      choices: [
        { label: '\uD83D\uDDD1 Удалить \u2014 это мусор',                      style: 'danger', action: 'trash'   },
        { label: '\uD83D\uDCA1 Когда-нибудь / Идея / Может быть',              style: 'warn',   action: 'someday' },
        { label: '\uD83D\uDCC2 Справочная информация',                           style: '',       action: 'ref'     },
      ],
    },
    { id: 'coinflip',
      q: '',
      type: 'coinflip',
      noactionId: 'noaction',
      yesId: 'mine',
    },
    { id: 'mine',
      q: 'Мне?',
      hint: 'Это должен делать именно ты, или можно кому-то передать?',
      type: 'choice',
      choices: [
        { label: '\u2714 Да, мне',              style: 'yes',  next: 'when'         },
        { label: '\uD83D\uDC46 Нет \u2014 делегировать', style: 'warn', next: 'delegate_who' },
      ],
    },
    { id: 'delegate_who',
      q: 'Кому делегируешь?',
      hint: 'Имя попадёт в тег @имя, задача уйдёт в лист ожидания',
      type: 'text',
      placeholder: 'Имя или никнейм',
      multiline: false,
      field: 'delegate',
      action: 'delegate',
    },
    { id: 'when',
      q: 'Сейчас / на этой неделе?',
      hint: '',
      type: 'choice',
      choices: [
        { label: '\u2714 Да \u2014 актуально сейчас',               style: 'yes',  next: 'mutny_check' },
        { label: '\uD83D\uDCC5 Конкретная дата \u2014 в календарь', style: 'warn', next: 'pick_date'   },
        { label: '\uD83D\uDD50 Когда-нибудь потом',                  style: 'no',   action: 'someday'   },
      ],
    },
    { id: 'pick_date',
      q: 'Выбери дату',
      hint: '',
      type: 'date',
      field: 'dueDate',
      action: 'calendar',
    },
    { id: 'mutny_check',
      q: 'Задача мутная?',
      hint: 'Мутная = непонятно следующее конкретное действие,\nили есть внутреннее сопротивление',
      type: 'choice',
      choices: [
        { label: '\u2714 Да, мутная \u2014 разобраться', style: 'warn', switch: 'mutny'      },
        { label: '\u2718 Нет \u2014 всё понятно',         style: 'yes',  next: 'twominutes' },
      ],
    },
    { id: 'twominutes',
      q: 'Займёт меньше 2 минут?',
      hint: 'Если да \u2014 просто сделай прямо сейчас, не записывай',
      type: 'choice',
      choices: [
        { label: '\u26A1 Да \u2014 сделаю сейчас', style: 'yes', action: 'now'         },
        { label: '\uD83D\uDCCB Нет \u2014 в список задач', style: 'no',  action: 'next_action' },
      ],
    },
  ],

  mutny: [
    { id: 'outcome',
      q: 'Какой результат должен быть?',
      hintHtmlFn: () => {
        const items = [
          'Отражает видимый желаемый результат.',
          'Формулируется как условие, которое можно проверить (истинно/ложно).',
          'При условии true — завершается. При условии false — завершаем или пересматриваем.',
          'Предпочтительно включает глагол для конкретности.',
          'Начинается с ключевого слова для удобной сортировки (например, «Отпуск – завершить»).',
          'Можно завершить за 12 месяцев.',
          'Effective project names motivate you toward the outcome you wish to achieve, and give you clear direction about what you are trying to accomplish.',
        ];
        return '<div class="step-hint">Как выглядит «сделано»? Запиши в виде условия, которое можно проверить.<br><br>'
          + '<ul style="margin:0 0 0 1.1em;line-height:1.8">'
          + items.map(i => '<li>' + i + '</li>').join('')
          + '</ul></div>';
      },
      type: 'text',
      placeholder: 'Результат выглядит как\u2026',
      multiline: true,
      field: 'outcome',
      next: 'action_step',
    },
    { id: 'action_step',
      q: 'Запиши ОДНО следующее действие',
      hint: 'Формулируй как для труслового льва или для глупого дворецкого. Или как для глупого ребёнка.\n\u2022 На один шаг приближает тебя к результату\n\u2022 Можно сделать за 20 минут без перерыва\n\u2022 Действие должно ощущаться маленьким и лёгким\n\u2022 Сформулировано понятно, что можно перепоручить соседскому ребёнку\n\u2022 Начинается с глагола в неопределённой форме',
      type: 'text',
      placeholder: 'Написать / Позвонить / Открыть / Найти\u2026',
      multiline: true,
      field: 'action',
      next: 'procgen',
    },
    { id: 'procgen',
      q: 'Ты замечаешь глагол-прокрастиноген',
      // hintFn called at render time with current S.action
      hintFn: () => {
        const m = S.action.match(/\b(подумать|придумать|проанализировать|выучить|изучить|сделать)\b/i);
        return m
          ? 'Нужно максимально снизить когнитивную нагрузку на будущего тебя.\n\nГлагол «' + m[0] + '» — прокрастиноген. Переформулируй задачу, не используя: подумать / придумать / проанализировать / выучить / изучить / сделать'
          : '';
      },
      // skipIf: no procgen verb found → go straight to priority
      skipIf: () => !/\b(\u043f\u043e\u0434\u0443\u043c\u0430\u0442\u044c|\u043f\u0440\u0438\u0434\u0443\u043c\u0430\u0442\u044c|\u043f\u0440\u043e\u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0432\u044b\u0443\u0447\u0438\u0442\u044c|\u0438\u0437\u0443\u0447\u0438\u0442\u044c|\u0441\u0434\u0435\u043b\u0430\u0442\u044c)\b/i.test(S.action),
      skipTo: 'priority',
      type: 'choice',
      choices: [
        { label: '↩ Переписать', style: 'warn', back: 'action_step' },
        { label: 'Не переписывать, идём дальше', style: 'no', next: 'priority' },
      ],
    },
    { id: 'priority',
      q: 'Какой приоритет?',
      hint: '',
      type: 'choice',
      choices: [
        { label: '❤️ Красный — если не выполнить, случится что-то плохое',    style: 'danger', pri: 'red',   next: 'context' },
        { label: '💚 Зелёный — если выполнить, стану ближе к своим целям',      style: 'yes',    pri: 'green', next: 'context' },
      ],
    },
    { id: 'context',
      q: 'В каком контексте выполнять?',
      hint: 'Выбери один или несколько (или пропусти)',
      type: 'contexts',
      groups: [
        { label: '\uD83D\uDCCD Место', chips: ['@\u0434\u043e\u043c\u0430','@\u0433\u043e\u0440\u043e\u0434','@\u043c\u0430\u0433\u0430\u0437\u0438\u043d','@\u043f\u043e\u0435\u0437\u0434\u043a\u0430'] },
        { label: '\uD83D\uDCBB \u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442', chips: ['@\u043d\u043e\u0443\u0442','@\u0442\u0435\u043b\u0435\u0444\u043e\u043d','@\u0437\u0432\u043e\u043d\u043e\u043a','@\u043c\u0435\u0441\u0441\u0435\u043d\u0434\u0436\u0435\u0440','@\u0431\u0435\u0437_\u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0430'] },
        { label: '\u23F1 \u0412\u0440\u0435\u043c\u044f / \u043e\u043a\u043d\u043e', chips: ['@10\u043c\u0438\u043d\u0443\u0442','@\u043d\u0430_\u0443\u043b\u0438\u0446\u0435','@\u0442\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442'] },
        { label: '\uD83D\uDC38 \u0422\u0438\u043f \u0437\u0430\u0434\u0430\u0447\u0438', chips: ['@\u043b\u044f\u0433\u0443\u0448\u043a\u0430'] },
      ],
      next: 'emotional',
    },
    { id: 'emotional',
      q: 'Задача эмоционально сложная?',
      hint: 'Есть сопротивление, тревога или нежелание делать?',
      type: 'choice',
      choices: [
        { label: '\u2714 Да \u2014 раскопать', style: 'warn', next: 'feelings'  },
        { label: '\u2718 Нет \u2014 всё ок',  style: 'yes',  next: 'parallel'  },
      ],
    },
    { id: 'feelings',
      q: 'Какие чувства у тебя вызывает эта задача?',
      hintFn: () => 'Когда думаю: «' + (S.action || S.task) + '»\nВозникают мысли…',
      type: 'text',
      placeholder: 'Возникают мысли…',
      multiline: true,
      field: 'feelings',
      next: 'friend_advice',
    },
    { id: 'friend_advice',
      q: 'Что скажешь другу?',
      hintHtmlFn: () => {
        const task     = esc(S.task || '\u2026');
        const feelings = esc(S.feelings || '\u2026');
        return '<div class="friend-quote"><span class="friend-label">Друг говорит:</span>Мне нужно <strong>' + task + '</strong>. Но ' + feelings + '. Что скажешь?</div>';
      },
      type: 'text',
      placeholder: 'Ты бы сказал…',
      multiline: true,
      field: 'advice',
      next: 'parallel',
    },
    { id: 'parallel',
      q: 'Есть параллельные задачи в проекте?',
      hint: 'Задачи, которые можно делать независимо от текущего действия',
      type: 'choice',
      choices: [
        { label: '\u2714 Да \u2014 добавить ещё одну задачу', style: 'warn', back: 'action_step' },
        { label: '\u2718 Нет, это всё',                        style: 'yes',  action: 'output'    },
      ],
    },
  ],

};
