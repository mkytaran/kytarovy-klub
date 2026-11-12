import { AVATARS, avatarEmoji } from "./avatars.js";
import { getLevel, getStudentStats } from "./stats.js";

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export function renderOverview(state, currentUser) {
  const rankedStudents = getStudentStats(state);
  const myStats = rankedStudents.find((student) => student.id === currentUser.id);
  const myRank = rankedStudents.findIndex((student) => student.id === currentUser.id) + 1;
  const points = rankedStudents.reduce((sum, student) => sum + student.totalPoints, 0);
  const cards = currentUser.role === "teacher"
    ? [
      statCard("Žáků ve třídě", state.students.length, "🎸"),
      statCard("Rozdaných bodů", points, "⭐"),
      statCard("Bodových zápisů", state.entries.length, "👏")
    ]
    : [
      statCard("Moje body", myStats?.totalPoints ?? 0, "⭐"),
      statCard("Moje lekce", myStats?.lessonCount ?? 0, "👏"),
      statCard("Moje místo", myRank || "–", "🎵")
    ];
  document.querySelector("#overview-stats").innerHTML = cards.join("");

  const leaderboard = document.querySelector("#leaderboard");
  if (rankedStudents.length === 0) {
    leaderboard.innerHTML = emptyState("Třída teprve začíná", "Až učitel přidá žáky, objeví se tu společná hudební výprava.");
    return;
  }
  leaderboard.innerHTML = rankedStudents.map((student, index) => {
    const level = getLevel(student.totalPoints);
    return `<article class="leader-row">
      <span class="rank-badge rank-${Math.min(index + 1, 3)}">${index + 1}</span>
      <span class="student-avatar" aria-hidden="true">${avatarEmoji(student.avatar)}</span>
      <div>
        <p class="leader-name">${escapeHtml(student.name)}</p>
        <p class="leader-level">${level.name} · ${student.lessonCount} ${plural(student.lessonCount, "zápis", "zápisy", "zápisů")}</p>
      </div>
      <span class="leader-points">${student.totalPoints} ${plural(student.totalPoints, "bod", "body", "bodů")}</span>
    </article>`;
  }).join("");
}

function statCard(label, value, icon) {
  return `<article class="stat-card">
    <p class="stat-label">${label}</p>
    <p class="stat-value"><span class="stat-icon" aria-hidden="true">${icon}</span>${value}</p>
  </article>`;
}

const LESSON_DAYS = [
  ["monday", "Pondělí"],
  ["tuesday", "Úterý"],
  ["wednesday", "Středa"],
  ["thursday", "Čtvrtek"],
  ["friday", "Pátek"],
  ["saturday", "Sobota"],
  ["sunday", "Neděle"]
];

export function renderScoreForm(students, entries, date, type) {
  const container = document.querySelector("#score-students");
  if (students.length === 0) {
    container.innerHTML = emptyState("Zatím tu nikdo není", "Nejdřív přidej žáky, kterým budeš body zapisovat.");
    document.querySelector("#score-form button[type=submit]").disabled = true;
    return;
  }
  document.querySelector("#score-form button[type=submit]").disabled = false;
  container.innerHTML = students.map((student) => `<label class="score-student">
    <span class="student-avatar" aria-hidden="true">${avatarEmoji(student.avatar)}</span>
    <span class="score-student-details">
      <span class="score-student-name">${escapeHtml(student.name)}</span>
      <span class="score-student-day">${student.lessonDay ? `Hodina: ${lessonDayName(student.lessonDay)}` : "Den hodiny nenastaven"}</span>
      <span class="score-student-status" data-score-status="${escapeHtml(student.id)}" hidden></span>
    </span>
    <span class="score-input-wrap">
      <input class="score-input" type="number" name="score-${escapeHtml(student.id)}" min="1" max="10" step="1" inputmode="numeric" placeholder="–" aria-label="Body pro ${escapeHtml(student.name)}">
      bodů
    </span>
  </label>`).join("");
  updateScoreAvailability(entries, date, type);
}

export function updateScoreAvailability(entries, date, type) {
  const week = date ? weekStart(date) : null;
  document.querySelectorAll(".score-student").forEach((row) => {
    const input = row.querySelector(".score-input");
    const status = row.querySelector(".score-student-status");
    const studentId = input.name.slice("score-".length);
    const existing = type === "lesson" && week
      ? entries.find((entry) => entry.studentId === studentId
        && (entry.type || "lesson") === "lesson" && weekStart(entry.date) === week)
      : null;
    input.disabled = Boolean(existing);
    status.hidden = !existing;
    status.textContent = existing
      ? `Běžné body už zapsány (${formatDate(existing.date)}). Pro další zvol mimořádné body.`
      : "";
  });
}

export function renderStudents(students, rankedStudents) {
  const container = document.querySelector("#students-list");
  if (students.length === 0) {
    container.innerHTML = emptyState("Přidej prvního kytaristu", "Žádné známky ani učivo – jen jména a radost z pokroku.");
    return;
  }
  const statsById = new Map(rankedStudents.map((student) => [student.id, student]));
  container.innerHTML = students
    .slice()
    .filter((student) => student.role === "student")
    .sort((a, b) => a.name.localeCompare(b.name, "cs"))
    .map((student) => {
      const stats = statsById.get(student.id);
      const level = getLevel(stats?.totalPoints ?? 0);
      return `<article class="student-card">
        <span class="student-avatar" aria-hidden="true">${avatarEmoji(student.avatar)}</span>
        <div class="student-info">
          <strong>${escapeHtml(student.name)}</strong>
          <span>${stats?.totalPoints ?? 0} bodů · ${level.name} · ${student.lessonDay ? lessonDayName(student.lessonDay) : "den hodiny nenastaven"}</span>
        </div>
        <div class="student-day-control">
          <label class="sr-only" for="lesson-day-${escapeHtml(student.id)}">Den hodiny – ${escapeHtml(student.name)}</label>
          <select id="lesson-day-${escapeHtml(student.id)}" data-lesson-day="${escapeHtml(student.id)}">
            <option value="">Den hodiny</option>
            ${LESSON_DAYS.map(([value, label]) => `<option value="${value}"${student.lessonDay === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="student-action" type="button" data-save-lesson-day="${escapeHtml(student.id)}"${student.lessonDay === "" ? " disabled" : ""}>Uložit den</button>
        </div>
        <button class="student-action" type="button" data-reset-student="${escapeHtml(student.id)}">Nový kód</button>
        <button class="remove-student" type="button" data-remove-student="${escapeHtml(student.id)}" aria-label="Odebrat žáka ${escapeHtml(student.name)}">Odebrat</button>
      </article>`;
    }).join("");
  if (!container.innerHTML) container.innerHTML = emptyState("Zatím tu nejsou žádní žáci", "Účty může do třídy přidávat jen učitel.");
}

export function renderHistory(state, filterId, role) {
  const filter = document.querySelector("#history-filter");
  const previousFilter = filter.value;
  filter.innerHTML = `<option value="all">Všichni žáci</option>${state.students
    .filter((student) => student.role === "student")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "cs"))
    .map((student) => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)}</option>`)
    .join("")}`;
  filter.value = role === "teacher"
    && state.students.some((student) => student.id === previousFilter)
    ? previousFilter
    : "all";

  const selectedFilter = role === "teacher" ? (filterId ?? filter.value) : "all";
  const entries = state.entries
    .filter((entry) => selectedFilter === "all" || entry.studentId === selectedFilter)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const container = document.querySelector("#history-list");
  if (entries.length === 0) {
    container.innerHTML = emptyState("Zatím žádné zápisy", "Po první lekci se tu objeví zapsané body.");
    return;
  }
  container.innerHTML = entries.map((entry) => `<article class="history-row">
    <span class="history-person">${escapeHtml(entry.studentName)}
      ${entry.type === "extra" ? `<small class="history-extra">Mimořádné body · ${escapeHtml(entry.reason)}</small>` : ""}
    </span>
    <time class="history-date" datetime="${escapeHtml(entry.date)}">${formatDate(entry.date)}</time>
    <span class="points-pill">＋${entry.score} ${plural(entry.score, "bod", "body", "bodů")}</span>
  </article>`).join("");
}

export function renderProfile(user) {
  document.querySelector("#profile-name").textContent = user.name;
  document.querySelector("#profile-avatar").textContent = avatarEmoji(user.avatar);
  document.querySelector("#avatar-picker").innerHTML = AVATARS.map((avatar) => {
    const selected = avatar.id === user.avatar;
    return `<button class="avatar-picker-button" type="button" data-avatar="${avatar.id}" aria-label="${avatar.name}" aria-pressed="${selected}" title="${avatar.name}">
      <span class="avatar-circle" aria-hidden="true">${avatar.emoji}</span>
    </button>`;
  }).join("");
}

function emptyState(title, message) {
  return `<div class="empty-state"><strong>${title}</strong>${message}</div>`;
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function weekStart(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function lessonDayName(value) {
  return LESSON_DAYS.find(([day]) => day === value)?.[1] ?? "";
}

function plural(value, one, few, many) {
  if (value === 1) return one;
  if (value >= 2 && value <= 4) return few;
  return many;
}
