// Fable Countdown — every new tab is a reminder.
// Deadline: midnight into June 22, 2026 (local time).

const DEADLINE = new Date(2026, 5, 22, 0, 0, 0);

const EPIGRAPHS = [
  "Она отвечает, пока ты спрашиваешь.",
  "Не считай дни. Наполняй их.",
  "Каждый новый таб — напоминание.",
  "Лучший токен — потраченный сегодня.",
  "Модели уходят. Сделанное остаётся.",
  "Время — это контекстное окно. И оно закрывается.",
  "Пока горит — пиши.",
  "Двадцать второго она станет историей. Сегодня она ещё собеседник.",
  "Спроси сегодня то, что откладывал на потом.",
  "Memento Fable.",
];

const NUDGES = [
  "отдай ей задачу, которую боишься начать",
  "большой рефакторинг — сегодня, не «потом»",
  "одна сессия — один выжатый до конца проект",
  "запусти воркфлоу на всю котлету",
  "сними скринкаст, пока она в подписке",
  "архивируй лучшие диалоги — это материал",
  "пусть сделает то, на что у тебя не доходят руки",
  "закрой этот таб и открой терминал",
];

const UNITS = ["days", "hours", "minutes", "seconds"];
const UNIT_WORDS = {
  days:    ["день", "дня", "дней"],
  hours:   ["час", "часа", "часов"],
  minutes: ["минута", "минуты", "минут"],
  seconds: ["секунда", "секунды", "секунд"],
};

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// — lifeline anchor: the moment this companion was first opened —
const SEEN_KEY = "fable-countdown:firstSeen";
let firstSeen = Number(localStorage.getItem(SEEN_KEY));
if (!firstSeen || firstSeen >= DEADLINE.getTime()) {
  firstSeen = Date.now();
  localStorage.setItem(SEEN_KEY, String(firstSeen));
}

let unitIndex = 0;

function remaining() {
  return Math.max(0, DEADLINE.getTime() - Date.now());
}

function counterNumber(ms) {
  const unit = UNITS[unitIndex];
  const s = Math.floor(ms / 1000);
  const value = {
    days:    Math.floor(s / 86400),
    hours:   Math.floor(s / 3600),
    minutes: Math.floor(s / 60),
    seconds: s,
  }[unit];
  return { value, word: plural(value, UNIT_WORDS[unit]) };
}

function renderCounter() {
  const ms = remaining();
  const { value, word } = counterNumber(ms);
  $("counterValue").textContent = value.toLocaleString("ru-RU");
  $("counterUnit").textContent = word;
}

function renderClock() {
  const ms = remaining();
  if (ms === 0) return;
  const s = Math.floor(ms / 1000);
  const h = pad(Math.floor((s % 86400) / 3600));
  const m = pad(Math.floor((s % 3600) / 60));
  const sec = pad(s % 60);
  $("clock").innerHTML =
    UNITS[unitIndex] === "days"
      ? `и ещё <b>${h}:${m}:${sec}</b>`
      : `до полуночи 22 июня`;
}

function renderLifeline() {
  const total = DEADLINE.getTime() - firstSeen;
  const spent = Date.now() - firstSeen;
  const pct = Math.min(100, Math.max(0, (spent / total) * 100));
  $("lifeline").style.width = pct.toFixed(3) + "%";
}

// — embers: one dot per hour, midnight today → deadline —
function renderEmbers() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const grid = $("embersGrid");
  grid.textContent = "";

  const totalHours = Math.round((DEADLINE - start) / 3600000);
  if (totalHours <= 0 || totalHours > 24 * 40) {
    grid.parentElement.style.display = "none";
    return;
  }

  const frag = document.createDocumentFragment();
  let left = 0;
  for (let i = 0; i < totalHours; i++) {
    const cellStart = start.getTime() + i * 3600000;
    const dot = document.createElement("span");
    dot.className = "ember";
    if (cellStart + 3600000 <= now.getTime()) dot.classList.add("gone");
    else if (cellStart <= now.getTime()) dot.classList.add("now");
    else left++;
    frag.appendChild(dot);
  }
  grid.appendChild(frag);

  const leftWithCurrent = left + 1;
  $("embersLeft").textContent =
    `${leftWithCurrent} ${plural(leftWithCurrent, UNIT_WORDS.hours)} впереди`;
}

function renderWords() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  $("epigraph").textContent = "«" + EPIGRAPHS[dayIndex % EPIGRAPHS.length] + "»";
  $("nudge").textContent = NUDGES[Math.floor(Math.random() * NUDGES.length)];
}

function renderAfter() {
  document.body.classList.add("after");
  $("overline").textContent = "время вышло";
  $("counterValue").textContent = "0";
  $("counterUnit").textContent = "дней";
  $("clock").textContent = "22 июня 2026 — она вышла из подписки";
  $("epigraph").textContent = "«Спасибо. Это было хорошо.»";
  $("nudge").textContent = "сделанное за эти дни — осталось с тобой";
  $("lifeline").style.width = "100%";
}

let timer = null;

function tick() {
  if (remaining() === 0) {
    renderAfter();
    if (timer) clearInterval(timer);
    return;
  }
  renderCounter();
  renderClock();
  renderLifeline();
}

$("counter").addEventListener("click", () => {
  if (remaining() === 0) return;
  const value = $("counterValue");
  const unit = $("counterUnit");
  value.classList.add("swap");
  unit.classList.add("swap");
  setTimeout(() => {
    unitIndex = (unitIndex + 1) % UNITS.length;
    renderCounter();
    renderClock();
    value.classList.remove("swap");
    unit.classList.remove("swap");
  }, 250);
});

renderWords();
renderEmbers();
tick();
if (remaining() > 0) {
  timer = setInterval(tick, 250);
  setInterval(renderEmbers, 60000);
}
