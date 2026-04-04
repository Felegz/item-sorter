
console.log('app.js loaded');





var questionToAsk =
  "Of these two tasks, which will have bigger impact or will make my life easier or better?";

var counter = 0;


/**
 * Показывает окно с 4 вариантами и возвращает Promise с ключом выбранного варианта
 * @param {string} title — заголовок окна
 * @param {object} options — объект вида {opt1: 'Текст 1', opt2: 'Текст 2', opt3: 'Текст 3', opt4: 'Текст 4'}
 * @returns {Promise<string>} — ключ выбранного варианта ('opt1' / 'opt2' / ...)
 */

/*
function chooseFour(title, options) {
  return Swal.fire({
    title,
    input: 'radio',
    inputOptions: options,
    inputValidator: value => value ? null : 'Нужно выбрать вариант',
    confirmButtonText: 'OK',
    showCancelButton: true,
    cancelButtonText: 'Отмена'
  }).then(result => result.isConfirmed ? result.value : null);
}
*/

/**
 * Быстрый выбор из 4 вариантов одним кликом на радио
 * @param {string} title
 * @param {object} options — { key1: 'Текст1', key2: 'Текст2', ... }
 * @returns {Promise<string|null>}
 */
/**
 * Выбор из 3-х вариантов одним кликом.
 * @param {string} title — заголовок окна
 * @returns {Promise<'include'|'ignore'|'delete'>}
 */

/**
 * Открывает SweetAlert2 с собственным textarea и тремя кнопками.
 * Всегда возвращает { action, text } и никогда не ломает promise.
 */
/**
 * Показывает окно с textarea и тремя кнопками.
 * Использует returnInputValueOnDeny, чтобы при любом клике
 * (Confirm, Deny или Cancel) вернуть введённый текст.
 *
 * @param {string} task — исходный текст задачи
 * @returns {Promise<{ action: 'include'|'ignore'|'delete', text: string }>}
 */
 /**
 * Возвращает текущие части даты/времени, все в формате двух цифр.
 */
function getDateParts() {
  const now = new Date();
  const year    = now.getFullYear();
  const month   = String(now.getMonth() + 1).padStart(2, '0');
  const day     = String(now.getDate()).padStart(2, '0');
  const hours   = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return { year, month, day, hours, minutes, seconds };
}

 
 
 
 
function chooseWindow(task) {
  return Swal.fire({
    title: 'Задача:',
    input: 'textarea',
    inputValue: task,                 // подставляем старый текст
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: '\u2705 \u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C',
    denyButtonText:    '\u274C \u0418\u0433\u043D\u043E\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C',
    cancelButtonText:  '\uD83D\uDDD1 \u0423\u0434\u0430\u043B\u0438\u0442\u044C',
    returnInputValueOnDeny: true,     // вот она, магия!
    preConfirm: text => ({ action: 'include', text: text.trim() || task }),
    preDeny:    text => ({ action: 'ignore',  text: text.trim() || task }),
    preCancel:  text => ({ action: 'delete',  text: text.trim() || task })
  }).then(res => {
    // Если по какой-то причине res.value окажется undefined,
    // возвращаем default {delete, task}
    return res.value || { action: 'delete', text: task };
  });
}




// Get the task list element and its value from localStorage, if it exists
const taskList = document.getElementById("task-list");
const savedTasks = localStorage.getItem("tasks");
if (savedTasks) {
  taskList.value = savedTasks;
}

// Get the user question element and its value from localStorage, if it exists
const userQuestion = document.getElementById("user-question");
const savedQuestion = localStorage.getItem("question");
if (savedQuestion) {
  userQuestion.value = savedQuestion;
}

const defaultQuestion =
  "Which task would bring more value or impact if completed first?";
if (!userQuestion.value.trim()) {
  userQuestion.value = defaultQuestion;
}

// Add an event listener to the user question to save its value in localStorage when the user leaves the page
userQuestion.addEventListener("blur", function () {
  localStorage.setItem("question", userQuestion.value);
});

//questionToAsk = userQuestion

// Add an event listener to the task list to save its value in localStorage when the user leaves the page
taskList.addEventListener("blur", function () {
  localStorage.setItem("tasks", taskList.value);
});

// Function to save both the user's question and task list in local storage
function saveDataToLocalStorage() {
  localStorage.setItem("question", userQuestion.value);
  localStorage.setItem("tasks", taskList.value);
}

// Quicksort algorithm to sort tasks in ascending order:
function quickSort(tasks) {
  if (tasks.length <= 1) {
    return tasks;
  }

  const pivot = tasks[0];
  const left = [];
  const right = [];

  for (let i = 1; i < tasks.length; i++) {
    if (compareTasks(tasks[i], pivot) === -1) {
      left.push(tasks[i]);
    } else {
      right.push(tasks[i]);
    }
  }

  return [...quickSort(left), pivot, ...quickSort(right)];
}

// Асинхронная сортировка задач от наиболее важной к наименее важной
async function mergeSort(tasks) {
  if (tasks.length <= 1) return tasks;
  const mid   = Math.floor(tasks.length / 2);
  const left  = await mergeSort(tasks.slice(0, mid));
  const right = await mergeSort(tasks.slice(mid));
  return await merge(left, right);
}

// Асинхронное слияние: если compareTasks(left,right) === -1, значит left важнее → его добавляем первым
async function merge(left, right) {
  const merged = [];
  let i = 0, j = 0;
  
  while (i < left.length && j < right.length) {
    const cmp = await compareTasks(left[i], right[j]);
    if (cmp === -1) {
      // левая задача важнее
      merged.push(left[i++]);
    } else {
      // правая задача важнее или равна
      merged.push(right[j++]);
    }
  }
  
  // добиваем остаток
  return merged.concat(left.slice(i)).concat(right.slice(j));
}





/* Helper function to compare two tasks
function compareTasks(task1, task2) {
  counter += 1;
  const questionToAsk = userQuestion.value;
  const confirmMsg = `${counter}. ${questionToAsk}\n\n✔️ДА: ${task1}\n\n❌НЕТ: ${task2}`;
  const isTask1MoreImportant = confirm(confirmMsg);
  if (isTask1MoreImportant) {
    return -1;
  } else {
    return 1;
  }
}*/

/**
 * Заменяет старую compareTasks на SweetAlert2‑версию,
 * где task1 и task2 — это сами надписи на кнопках.
 *
 * @param {string} task1 — текст первой задачи (кнопка «ДА»)
 * @param {string} task2 — текст второй задачи (кнопка «НЕТ»)
 * @returns {Promise<-1|1>}   – -1 если выбрали task1, иначе 1
 */
async function compareTasks(task1, task2) {
  counter += 1;
  const question = userQuestion.value;

  return new Promise(resolve => {
    Swal.fire({
      title: `${counter}. ${question}`,
      html: `
        <div style="text-align:left; word-wrap:break-word; margin-bottom:1rem;">
          <p>Выберите более важную задачу:</p>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.5rem;">
          <button id="swal-btn1" class="swal2-confirm swal2-styled" style="white-space:normal; width:100%;">
            ${task1}
          </button>
          <button id="swal-btn2" class="swal2-deny swal2-styled" style="white-space:normal; width:100%;">
            ${task2}
          </button>
        </div>
      `,
      showConfirmButton: false,
      showDenyButton:    false,
      allowOutsideClick: false,
      allowEscapeKey:    false,
      didOpen: () => {
        const b1 = Swal.getHtmlContainer().querySelector('#swal-btn1');
        const b2 = Swal.getHtmlContainer().querySelector('#swal-btn2');

        b1.addEventListener('click', () => {
          resolve(-1);
          Swal.close();
        });
        b2.addEventListener('click', () => {
          resolve(1);
          Swal.close();
        });
      }
    });
  });
}


// НОВАЯ ХУЙНЯ С МЕРДЖЕМ СПИСКОВ::
/**
 * 1) Разбирает единый текст на три части:
 *    - first   — до строки "NEW ARRAY"
 *    - second  — между "NEW ARRAY" и "НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ"
 *    - tail    — всё, что идёт с маркером "НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ" и дальше
 */
function parseArrays(text) {
  const lines = text.split(/\r?\n/);
  const idxNew   = lines.indexOf('NEW ARRAY');
  const idxTail  = lines.indexOf('НЕУПОРЯДОЧЕННЫЕ ЗАДАЧИ');

  const first  = idxNew   > -1 ? lines.slice(0, idxNew)                    : lines.slice();
  const second = idxNew   > -1 && idxTail > -1
                 ? lines.slice(idxNew + 1, idxTail)
                 : idxNew > -1
                   ? lines.slice(idxNew + 1)
                   : [];
  const tail   = idxTail  > -1 ? lines.slice(idxTail)                    : [];

  return { first, second, tail };
}

// 2) Галоп-спуск вправо
async function gallopRight(value, arr, start) {
  let lo = start, hi = start + 1;
  const n = arr.length;

  while (hi < n && await compareTasks(arr[hi], value) <= 0) {
    lo = hi;
    hi = hi * 2 <= n ? hi * 2 : n;
  }
  hi = Math.min(hi, n);

  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (await compareTasks(arr[mid], value) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// 3) Галоп-спуск влево
async function gallopLeft(value, arr, start) {
  let lo = start, hi = start + 1;
  while (hi < arr.length && await compareTasks(value, arr[hi]) <= 0) {
    lo = hi;
    hi = hi * 2 <= arr.length ? hi * 2 : arr.length;
  }
  hi = Math.min(hi, arr.length);

  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (await compareTasks(value, arr[mid]) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// 4) Слияние с галопом
async function mergeGalloping(first, second) {
  const result = [];
  let i = 0, j = 0;
  const lenA = first.length, lenB = second.length;
  const MIN_GALLOP = 7;
  let countA = 0, countB = 0;

  while (i < lenA && j < lenB) {
    if (await compareTasks(first[i], second[j]) <= 0) {
      result.push(first[i++]);
      countA++; countB = 0;
    } else {
      result.push(second[j++]);
      countB++; countA = 0;
    }

    if (countA >= MIN_GALLOP) {
      const idx = await gallopRight(first[i - 1], second, j);
      result.push(...second.slice(j, idx));
      j = idx;
      countA = countB = 0;
    } else if (countB >= MIN_GALLOP) {
      const idx = await gallopLeft(second[j - 1], first, i);
      result.push(...first.slice(i, idx));
      i = idx;
      countA = countB = 0;
    }
  }

  if (i < lenA) result.push(...first.slice(i));
  if (j < lenB) result.push(...second.slice(j));
  return result;
}

// 5) UI функция
async function mergeArraysUI() {
  saveDataToLocalStorage();
  const text = taskList.value;
  const { first, second, tail } = parseArrays(text);
  const a = first.filter(l => l.trim());
  const b = second.filter(l => l.trim());
  const merged = await mergeGalloping(a, b);
  const newText = [
    ...merged,
    'NEW ARRAY',
    ...tail
  ].join('\n');
  taskList.value = newText;
  saveDataToLocalStorage();
}






// Function to filter tasks based on user confirmation
//изначальная версия с confirm
/*function filterTasks(tasks) {
  const tasksToSort = [];
  const ignoredTasks = [];

  tasks.forEach(task => {
    const includeTask = confirm(`Задача: ${task}\n\n❔Включать задачу в сортировку или не включать?`);
    if (includeTask) {
      tasksToSort.push(task);
    } else {
      ignoredTasks.push(task);
    }
  });

  return { tasksToSort, ignoredTasks };
}*/

/**
 * Проходит по списку tasks и для каждой задачи вызывает chooseWindow.
 * Цикл ни при каких условиях не прерывается.
 */
async function filterTasks(tasks) {
  const tasksToSort  = [];
  const ignoredTasks = [];

  for (const task of tasks) {
    const { action, text } = await chooseWindow(task);
    if (action === 'include')     tasksToSort.push(text);
    else if (action === 'ignore') ignoredTasks.push(text);
    // action === 'delete' — пропускаем
  }

  return { tasksToSort, ignoredTasks };
}

/*
// Function to save the content of task-list as a .txt file
function saveAsTxt() {
  const tasks = document.getElementById('task-list').value;

  // Get the current date and time
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  // Format the date and time
  const formattedDate = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;

  // Create the file name
  const fileName = `tasks_${formattedDate}.txt`;

  const blob = new Blob([tasks], { type: 'text/plain' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}*/

// Function to save the content of task-list as a .txt file,
// with filename: tasks_DATE_PREFIX.txt
function saveAsTxt() {
  const content = document.getElementById('task-list').value;

  // Получаем первую строку (первую таску)
  const firstLine = content.split('\n')[0].trim();

  // Разрешаем латиницу, кириллицу, цифры, дефис и подчёркивание
  const sanitizedFirstLine = firstLine
    .replace(/[^a-zA-Z0-9\u0430-\u044F\u0410-\u042F\u0451\u0401_-]/g, '_')
    .slice(0, 20);

// Дата и время для имени файла
const { year, month, day, hours, minutes, seconds } = getDateParts();
const formattedDate = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;


  // Собираем итоговое имя файла
  const fileName = `tasks_${formattedDate}_${sanitizedFirstLine || 'untitled'}.txt`;

  // Создаём и скачиваем файл
  const blob = new Blob([content], { type: 'text/plain' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}



/**
 * Выполняет бинарный поиск позиции вставки task в уже упорядоченный массив sorted,
 * используя compareTasks для минимизации сравнений.
 * @param {string[]} sorted — упорядоченный массив задач
 * @param {string} task — новая задача для вставки
 * @returns {Promise<number>} — индекс, куда вставить
 */
async function binaryInsert(sorted, task) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    // сравниваем новую задачу и элемент mid
    const cmp = compareTasks(task, sorted[mid]);
    if (cmp <= 0) {
      // task важнее или равен — ищем слева
      high = mid;
    } else {
      // task менее важен — ищем справа
      low = mid + 1;
    }
  }
  return low;
}

// Вставляет unsortedTasks в текущий отсортированный блок textarea (выше "ИГНОРИРУЕМЫЕ ЗАДАЧИ")
// Использует бинарный поиск (await compareTasks) для минимизации сравнений.
async function insertUnsortedTasksUI(unsortedTasks) {
  try {
    saveDataToLocalStorage();

    // Разбираем текущее содержимое textarea на сортируемую часть и хвост
    const lines = taskList.value.split(/[\r\n]+/);
    const splitIndex = lines.findIndex(l => l.startsWith("ИГНОРИРУЕМЫЕ ЗАДАЧИ"));

    const sorted = splitIndex > -1
      ? lines.slice(0, splitIndex).filter(l => l.trim() !== "")
      : lines.filter(l => l.trim() !== "");
    const tail = splitIndex > -1
      ? lines.slice(splitIndex)
      : [];

    console.log('insertUnsortedTasksUI: current sorted length =', sorted.length);
    console.log('insertUnsortedTasksUI: inserting', unsortedTasks.length, 'items');

    // Для каждой новой задачи делаем бинарную вставку (сравнения через await compareTasks)
    for (const newTask of unsortedTasks) {
      let lo = 0;
      let hi = sorted.length;

      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        // compareTasks(a,b) возвращает -1 если a важнее b
        const cmp = await compareTasks(newTask, sorted[mid]);
        if (cmp === -1) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }

      sorted.splice(lo, 0, newTask);
      console.log(`Inserted "${newTask}" at index`, lo);
    }

    // Собираем назад и записываем в textarea
    const resultLines = [
      ...sorted,
      "",
      ...tail
    ];
    taskList.value = resultLines.join("\n");
    saveDataToLocalStorage();
    console.log('insertUnsortedTasksUI: done');
  } catch (err) {
    console.error('insertUnsortedTasksUI error:', err);
    // показать пользователю простое окно ошибки, если хотите
    Swal.fire('Ошибка', 'Не удалось вставить задачи — смотрите консоль', 'error');
  }
}




//SORT TASKS
async function sortTasks001() {
  saveDataToLocalStorage();
  
  const input = taskList.value;
  //var tasks = input.split("\n");
  var tasks = input.split(/[\r\n\t]+/);
  
  // Define an array of regular expressions to ignore
  const ignoreRegexes = [
    /^\([A-Z]\)$/gm,
    /^added .* ago$/gm,
    /^added yesterday/gm,
    /^ИГНОРИРУЕМЫЕ ЗАДАЧИ:.*/,
    /^Due[\d\w\s]*$/gm
    // Add more regexes as needed
  ];
  
  // Filter out tasks that match any of the ignore regexes
  tasks = tasks.filter(task => {
    for (const regex of ignoreRegexes) {
      if (regex.test(task)) {
        return false; // Ignore task
      }
    }
    return true; // Include task
  });

  tasks = tasks.filter(task => task.trim() !== "");

  var uniqueTasks = Array.from(new Set(tasks));

  // Filter tasks based on user confirmation
  const { tasksToSort, ignoredTasks } = await filterTasks(uniqueTasks);
  
  // Sort the tasks to include
  const sortedTasks = await mergeSort(cleaned);

  // Combine sorted tasks and ignored tasks
  const { year, month, day } = getDateParts();
  const dateHeader = `ИГНОРИРУЕМЫЕ ЗАДАЧИ ${year}.${month}.${day}`;

  const result = [
  ...sortedTasks,
  "",
  dateHeader,
  ...ignoredTasks
];



  taskList.value = result.join("\n\n");
  
  saveDataToLocalStorage();
} 


/**
 * Асинхронная фильтрация:
 * 1) берёт весь текст,
 * 2) разбивает на строки,
 * 3) отфильтровывает по регуляркам,
 * 4) убирает пустые,
 * 5) удаляет дубликаты,
 * 6) вызывает filterTasks (с редактированием через chooseWindow),
 * 7) вставляет заголовок с датой и игнорируемые задачи,
 * 8) сохраняет в localStorage.
 */
async function filterTasksUI() {
  saveDataToLocalStorage();

  // 1) Берём содержимое
  const input = taskList.value;

  // 2) Разбиваем на строки (по переводу строки или табу)
  var tasks = input.split(/[\r\n\t]+/);

  // 3) Регулярки, которые надо игнорировать целиком
  const ignoreRegexes = [
    /^\([A-Z]\)$/gm,
    /^added .* ago$/gm,
    /^added yesterday/gm,
    /^ИГНОРИРУЕМЫЕ ЗАДАЧИ:.*/,
    /^Due[\d\w\s]*$/gm
    // Add more regexes as needed
  ];

  // 4) Игорируем строки, подходящие под любой regex
  tasks = tasks.filter(task => {
    for (const regex of ignoreRegexes) {
      if (regex.test(task)) {
        return false; // убираем
      }
    }
    return true; // оставляем
  });

  // 5) Убираем полностью пустые строки
  tasks = tasks.filter(task => task.trim() !== "");

  // 6) Уникализация
  var uniqueTasks = Array.from(new Set(tasks));

  // 7) Редактируем и разделяем include / ignore
  const { tasksToSort, ignoredTasks } = await filterTasks(uniqueTasks);

  // 8) Формируем заголовок с текущей датой
  const { year, month, day } = getDateParts();
  const dateHeader = `ИГНОРИРУЕМЫЕ ЗАДАЧИ ${year}.${month}.${day}`;

  // 9) Собираем итоговый массив строк
  const result = [
    ...tasksToSort,
    "",
    dateHeader,
    ...ignoredTasks
  ];

  // 10) Записываем его обратно в textarea
  taskList.value = result.join("\n\n");

  saveDataToLocalStorage();
}

/**
 * Асинхронная сортировка:
 * 1) сохраняет в localStorage,
 * 2) разбивает на строки,
 * 3) находит заголовок «ИГНОРИРУЕМЫЕ ЗАДАЧИ…»,
 * 4) сортирует всё ДО заголовка с помощью mergeSort,
 * 5) приклеивает заголовок и игнорируемые задачи,
 * 6) сохраняет обратно и в localStorage.
 */
async function sortTasks() {
  saveDataToLocalStorage();

  try {
    // 1) разбиваем текст на строки
    const lines = taskList.value.split(/[\r\n]+/);

    // 2) ищем индекс строки, где начинается заголовок
    const splitIndex = lines.findIndex(l => l.startsWith("ИГНОРИРУЕМЫЕ ЗАДАЧИ"));

    // 3) разделяем на то, что надо сортировать, и на остальное
    const toSort = splitIndex > -1 ? lines.slice(0, splitIndex) : lines;
    const rest   = splitIndex > -1 ? lines.slice(splitIndex) : [];

    // 4) убираем пустые строки
    const cleaned = toSort.filter(l => l.trim() !== "");

    // 5) сортируем массив (ВАЖНО: await)
    const sortedTasks = await mergeSort(cleaned);

    // 6) собираем вместе с остальными строками
    const result = [
      ...sortedTasks,
      ...rest
    ];

    // 7) обновляем textarea
    taskList.value = result.join("\n\n");

    saveDataToLocalStorage();
    console.log('sortTasks: done, sortedTasks count =', sortedTasks.length);
  } catch (err) {
    console.error('sortTasks error:', err);
    // аккуратно уведомим, чтобы не ломать UX
    if (typeof Swal !== 'undefined') {
      Swal.fire('Ошибка', 'Сортировка упала — см. консоль', 'error');
    } else {
      alert('Ошибка сортировки — см. консоль');
    }
  }
}






// ——— Тест копирования задач в буфер ———
console.log("🛠 copy-button exists?", !!document.getElementById("copy-button"));

// Функция копирует очищенный текст и логирует каждый шаг
function copyTasksToClipboard() {
  console.log("copyTasksToClipboard() called");

  const textarea = document.getElementById("task-list");
  if (!textarea) {
    console.error('task-list not found');
    return;
  }
  console.log("Found textarea, length:", textarea.value.length);

  // Разбиваем, убираем пустые
  const lines = textarea.value.split(/\r?\n/);
  console.log("Split into lines, count:", lines.length);

  const cleanedLines = lines
    .map(line => line.trim())
    .filter(line => line !== "");
  console.log("After trimming & filtering, count:", cleanedLines.length);

  const cleanedText = cleanedLines.join("\n");
  console.log("Cleaned text preview:\n", cleanedText.substring(0, 100) + (cleanedText.length>100?"…": ""));

  // Пробуем скопировать
  navigator.clipboard.writeText(cleanedText)
    .then(() => {
      console.log('Copied to clipboard');
    })
    .catch(err => {
      console.error('Copy to clipboard failed:', err);
    });
}


const copyBtn = document.getElementById("copy-button");
if (copyBtn) {
  copyBtn.addEventListener("click", () => {
    console.log("copy-button clicked");
    copyTasksToClipboard();
  });
} else {
  console.error('copy-button not found, cannot attach listener');
}


document.getElementById('filter-button')
  .addEventListener('click', filterTasksUI);

document.getElementById('sort-button')
  .addEventListener('click', sortTasks);
  
  
document.getElementById('merge-button').onclick = () => {
  console.log('>>> merge-button clicked!');
  mergeArraysUI();
};

/**
 * Показать окно для ввода неупорядоченных задач.
 * Возвращает Promise<string[]> — массив непустых строк.
 */
function promptUnsortedTasks() {
  return Swal.fire({
    title: 'Вставьте неупорядоченные задачи',
    input: 'textarea',
    inputAttributes: {
      placeholder: 'Напишите одну задачу на строку',
      style: 'width:100%;height:200px;'
    },
    showCancelButton: true,
    confirmButtonText: 'Вставить',
    cancelButtonText: 'Отмена',
    preConfirm: text => {
      // разбиваем на строки, тримим и фильтруем пустые
      const lines = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l !== '');
      if (lines.length === 0) {
        Swal.showValidationMessage('Нужно ввести хотя бы одну задачу');
        return;
      }
      return lines;
    }
  }).then(result => {
    if (result.isConfirmed && Array.isArray(result.value)) {
      return result.value;
    } else {
      return []; // отмена или пусто
    }
  });
}



const insertBtn = document.getElementById('insert-button');
if (insertBtn) {
  insertBtn.addEventListener('click', insertUnsortedClickHandler);
} else {
  console.error('insert-button not found');
}

async function insertUnsortedClickHandler() {
  console.log('insert-button clicked');
  const unsorted = await promptUnsortedTasks();
  if (!unsorted || unsorted.length === 0) {
    console.log('Вставка отменена или ввода нет');
    return;
  }
  console.log('Пользователь ввёл задачи:', unsorted);
  await insertUnsortedTasksUI(unsorted);
}



// Проверяем, нашёлся ли merge-button
console.log('merge-button exists?', !!document.getElementById('merge-button'));

// Навешиваем простой onclick без лишних чудес
document.getElementById('merge-button').onclick = () => {
  console.log('>>> merge-button clicked!');
  mergeArraysUI();
};





//==============================================================================================
//OLDER VERSION
function sortTasksv1() {
  saveDataToLocalStorage();
  // Get the input from the user and split it into an array
  const input = taskList.value;
  var tasks = input.split("\n");
  
  
  
  
  
  
  tasks = tasks.filter((task) => task.trim() !== "");

  // Use a Set to remove duplicates
  var uniqueTasks = Array.from(new Set(tasks));

  /*
  // Define the function to compare two tasks and ask the user to select the more important one
  function compareTasks(task1, task2) {
    const confirmMsg = `Which task should I do first?\n\nДА. ${task1}\n\nНЕТ. ${task2}`;
    const isTask1MoreImportant = confirm(confirmMsg);
    if (isTask1MoreImportant) {
      return -1;
    } else {
      return 1;
    }
  }
  */

  // Sort the tasks using the comparison function
  //tasks.sort(compareTasks);

  // Sort the tasks using the comparison function
  /*uniqueTasks.sort(compareTasks);*/

  //const sortedTasks = quickSort(uniqueTasks);

  const sortedTasks = mergeSort(uniqueTasks);

  // Display the sorted list of tasks in the text field
  taskList.value = sortedTasks.join("\n");

  //saving
  saveDataToLocalStorage();
  
  
  
  
}
