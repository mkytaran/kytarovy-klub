import {
  addStudent,
  clearSession,
  deactivateStudent,
  getClassData,
  login,
  logout,
  recordScores,
  resetStudentCode,
  selectAvatar,
  updateStudentLessonDay
} from "./api.js";
import { getCurrentDate, getStudentStats } from "./stats.js";
import {
  renderHistory,
  renderOverview,
  renderProfile,
  renderScoreForm,
  renderStudents,
  updateScoreAvailability
} from "./ui.js";

const notice = document.querySelector("#notice");
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const HIDDEN_TIMEOUT_MS = 5 * 60 * 1000;
let currentUser = null;
let classData = null;
let noticeTimer;
let idleTimer;
let hiddenTimer;

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("is-error", isError);
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function showLogin() {
  clearTimeout(idleTimer);
  clearTimeout(hiddenTimer);
  currentUser = null;
  classData = null;
  clearSession();
  document.querySelector("#app-content").hidden = true;
  document.querySelector("#main-nav").hidden = true;
  document.querySelector("#account-actions").hidden = true;
  document.querySelector("#login-panel").hidden = false;
  document.querySelector("#login-form").reset();
  document.querySelector("#overview-stats").replaceChildren();
  document.querySelector("#leaderboard").replaceChildren();
  document.querySelector("#score-students").replaceChildren();
  document.querySelector("#students-list").replaceChildren();
  document.querySelector("#history-list").replaceChildren();
  document.querySelector("#avatar-picker").replaceChildren();
  document.querySelector("#profile-name").textContent = "";
  document.querySelector("#profile-avatar").textContent = "";
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (currentUser) idleTimer = setTimeout(() => endSession("Kvůli nečinnosti jsi byl/a bezpečně odhlášen/a."), IDLE_TIMEOUT_MS);
}

async function endSession(message) {
  clearTimeout(idleTimer);
  clearTimeout(hiddenTimer);
  let revoked = true;
  try {
    await logout();
  } catch (error) {
    revoked = false;
    console.error("Serverové odhlášení selhalo:", error);
  }
  showLogin();
  showNotice(
    revoked ? message : `${message} Serverové přihlášení vyprší nejpozději za osm hodin.`,
    !revoked
  );
}

function showPage(name) {
  const studentPages = ["prehled", "profil", "historie"];
  const allowed = currentUser?.role === "teacher"
    ? ["prehled", "body", "zaci", "profil", "historie"]
    : studentPages;
  if (!allowed.includes(name)) return;

  document.querySelectorAll(".page").forEach((page) => {
    const active = page.id === `page-${name}`;
    page.hidden = !active;
    page.classList.toggle("is-visible", active);
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.page === name;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (name === "body") {
    document.querySelector("#lesson-date").value ||= getCurrentDate();
    syncScoreControls();
  }
  if (name === "historie") renderHistory(classData, undefined, currentUser.role);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  const stats = getStudentStats(classData);
  renderOverview(classData, currentUser);
  if (currentUser.role === "teacher") {
    renderScoreForm(
      classData.students,
      classData.entries,
      document.querySelector("#lesson-date").value,
      document.querySelector("#score-type").value
    );
    renderStudents(classData.students, stats);
    syncScoreControls();
  }
  renderProfile(currentUser);
  renderHistory(classData, undefined, currentUser.role);
}

function syncScoreControls() {
  const form = document.querySelector("#score-form");
  const isExtra = form.elements.type.value === "extra";
  const reasonField = document.querySelector("#extra-reason-field");
  reasonField.hidden = !isExtra;
  form.elements.reason.required = isExtra;
  if (!isExtra) form.elements.reason.value = "";
  updateScoreAvailability(
    classData?.entries ?? [],
    form.elements.date.value,
    form.elements.type.value
  );
}

async function refreshAfterMutation() {
  try {
    classData = await getClassData();
    render();
    return true;
  } catch (error) {
    handleError(error);
    return false;
  }
}

function showAuthenticatedApp() {
  const teacher = currentUser.role === "teacher";
  document.querySelector("#login-panel").hidden = true;
  document.querySelector("#app-content").hidden = false;
  document.querySelector("#main-nav").hidden = false;
  document.querySelector("#account-actions").hidden = false;
  document.querySelectorAll("[data-role]").forEach((element) => {
    element.hidden = element.dataset.role !== currentUser.role;
  });
  document.querySelector("#history-description").textContent = teacher
    ? "Zápisy celé třídy, které zadal učitel."
    : "Tvoje osobní cesta za hudebními body.";
  document.querySelector("#history-filter").hidden = !teacher;
  document.querySelector("#lesson-date").value = getCurrentDate();
  render();
  showPage(currentUser.avatarChosen ? "prehled" : "profil");
  if (!currentUser.avatarChosen) {
    showNotice("Nejdřív si vyber avatara. Později ho můžeš kdykoli změnit.");
  }
  resetIdleTimer();
}

function handleError(error) {
  console.error("Požadavek do soukromé aplikace selhal:", error);
  if (error.status === 401 && currentUser) {
    showLogin();
    showNotice("Přihlášení vypršelo. Přihlas se prosím znovu.", true);
    return;
  }
  showNotice(error.message || "Požadavek se nepodařilo dokončit.", true);
}

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});
document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.go));
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim().replace(/\s+/g, " ");
  const code = form.elements.code.value;
  if (!/^[0-9]{6}$/.test(code)) {
    showNotice("Zadej šestimístný číselný kód.", true);
    return;
  }
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    currentUser = await login(name, code);
    classData = await getClassData();
    if (classData.user.id !== currentUser.id) throw new Error("Server vrátil neplatný uživatelský profil.");
    currentUser = classData.user;
    showAuthenticatedApp();
    showNotice(`Ahoj, ${currentUser.name}! 🎸`);
  } catch (error) {
    showLogin();
    handleError(error);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#student-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim().replace(/\s+/g, " ");
  const code = form.elements.code.value;
  const lessonDay = form.elements.lessonDay.value;
  if (!name || !/^[0-9]{6}$/.test(code)) {
    showNotice("Vyplň jméno a šestimístný číselný kód.", true);
    return;
  }
  try {
    await addStudent(name, code, lessonDay);
    form.reset();
    if (await refreshAfterMutation()) {
      showNotice(`Účet pro ${name} je připravený. Kód předej žákovi bezpečně.`);
    } else if (currentUser) {
      showNotice(`Účet pro ${name} byl vytvořen, ale seznam se nepodařilo obnovit. Znovu načti aplikaci.`, true);
    }
  } catch (error) {
    handleError(error);
  }
});

document.querySelector("#score-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const date = form.elements.date.value;
  const type = form.elements.type.value;
  const reason = form.elements.reason.value.trim();
  const scores = classData.students.flatMap((student) => {
    const input = form.elements[`score-${student.id}`];
    if (!input || input.value === "") return [];
    return [{ studentId: student.id, score: input.valueAsNumber }];
  });
  if (!date) {
    showNotice("Vyber datum lekce.", true);
    return;
  }
  if (scores.length === 0) {
    showNotice("Zadej body alespoň jednomu žákovi.", true);
    return;
  }
  if (scores.some(({ score }) => !Number.isInteger(score) || score < 1 || score > 10)) {
    showNotice("Body musí být celé číslo od 1 do 10.", true);
    return;
  }
  if (type === "extra" && (reason.length < 2 || reason.length > 120)) {
    showNotice("U mimořádných bodů uveď důvod dlouhý 2 až 120 znaků.", true);
    return;
  }
  try {
    await recordScores(date, scores, type, reason);
    form.reset();
    document.querySelector("#lesson-date").value = getCurrentDate();
    syncScoreControls();
    if (await refreshAfterMutation()) {
      showPage("body");
      showNotice(type === "extra" ? "Mimořádné body zapsány. Jen tak dál! ⭐" : "Týdenní body zapsány. Jen tak dál! ⭐");
    } else if (currentUser) {
      showNotice("Body byly uloženy, ale přehled se nepodařilo obnovit. Znovu načti aplikaci a zápis neopakuj.", true);
    }
  } catch (error) {
    handleError(error);
  }
});

document.querySelector("#lesson-date").addEventListener("change", syncScoreControls);
document.querySelector("#score-type").addEventListener("change", syncScoreControls);

document.querySelector("#students-list").addEventListener("click", async (event) => {
  const saveLessonDayButton = event.target.closest("[data-save-lesson-day]");
  if (saveLessonDayButton) {
    const studentId = saveLessonDayButton.dataset.saveLessonDay;
    const select = document.querySelector(`[data-lesson-day="${CSS.escape(studentId)}"]`);
    const student = classData.students.find((item) => item.id === studentId);
    if (!student || !select || select.value === student.lessonDay) return;
    saveLessonDayButton.disabled = true;
    try {
      await updateStudentLessonDay(studentId, select.value);
      if (await refreshAfterMutation()) {
        showNotice(`Den hodiny pro ${student.name} byl uložen.`);
      } else if (currentUser) {
        saveLessonDayButton.disabled = false;
        showNotice(`Den hodiny pro ${student.name} byl uložen, ale seznam se nepodařilo obnovit. Znovu načti aplikaci.`, true);
      }
    } catch (error) {
      handleError(error);
      saveLessonDayButton.disabled = false;
    }
    return;
  }

  const resetButton = event.target.closest("[data-reset-student]");
  if (resetButton) {
    const code = window.prompt("Zadej nový šestimístný kód a předej ho žákovi osobně:");
    if (code === null) return;
    if (!/^[0-9]{6}$/.test(code)) {
      showNotice("Nový kód musí obsahovat přesně šest číslic.", true);
      return;
    }
    try {
      await resetStudentCode(resetButton.dataset.resetStudent, code);
      showNotice("Kód byl změněn. Žák se musí přihlásit novým kódem.");
    } catch (error) {
      handleError(error);
    }
    return;
  }

  const removeButton = event.target.closest("[data-remove-student]");
  if (!removeButton) return;
  const student = classData.students.find((item) => item.id === removeButton.dataset.removeStudent);
  if (!student) return;
  if (!window.confirm(`Odebrat účet ${student.name}? Dosavadní body zůstanou v historii.`)) return;
  try {
    await deactivateStudent(student.id);
    if (await refreshAfterMutation()) {
      showNotice(`${student.name} už se nemůže přihlásit.`);
    } else if (currentUser) {
      showNotice(`Účet žáka ${student.name} byl odebrán, ale seznam se nepodařilo obnovit. Znovu načti aplikaci.`, true);
    }
  } catch (error) {
    handleError(error);
  }
});

document.querySelector("#students-list").addEventListener("change", (event) => {
  const select = event.target.closest("[data-lesson-day]");
  if (!select) return;
  const student = classData.students.find((item) => item.id === select.dataset.lessonDay);
  const saveButton = document.querySelector(`[data-save-lesson-day="${CSS.escape(select.dataset.lessonDay)}"]`);
  if (student && saveButton) saveButton.disabled = select.value === student.lessonDay;
});

document.querySelector("#avatar-picker").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-avatar]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  document.querySelectorAll(".avatar-picker-button").forEach((item) => { item.disabled = true; });
  try {
    const result = await selectAvatar(button.dataset.avatar);
    currentUser = result.user;
    const student = classData.students.find((item) => item.id === currentUser.id);
    if (student) {
      student.avatar = currentUser.avatar;
      student.avatarChosen = currentUser.avatarChosen;
    }
    render();
    showNotice("Tvůj nový zvířecí parťák je vybraný! 🐾");
  } catch (error) {
    handleError(error);
  } finally {
    document.querySelectorAll(".avatar-picker-button").forEach((item) => { item.disabled = false; });
  }
});

document.querySelector("#history-filter").addEventListener("change", (event) => {
  renderHistory(classData, event.currentTarget.value, currentUser.role);
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await endSession("Bezpečně odhlášeno.");
});

for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
  document.addEventListener(eventName, resetIdleTimer, { passive: true });
}

document.addEventListener("visibilitychange", () => {
  if (!currentUser) return;
  if (document.hidden) {
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => endSession("Po opuštění aplikace jsi byl/a bezpečně odhlášen/a."), HIDDEN_TIMEOUT_MS);
  } else {
    clearTimeout(hiddenTimer);
    resetIdleTimer();
  }
});

if (window.parent === window) {
  const installButton = document.querySelector("#install-button");
  let installPrompt;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installButton.disabled = true;
    try {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButton.hidden = true;
    } catch (error) {
      console.error("Instalaci aplikace se nepodařilo spustit:", error);
      showNotice("Instalaci aplikace se nepodařilo spustit.", true);
    } finally {
      installButton.disabled = false;
    }
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Registrace offline shellu selhala:", error);
      showNotice("Aplikaci můžeš používat, ale její instalaci se nepodařilo připravit.", true);
    });
  }
}
