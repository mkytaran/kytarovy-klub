let accessToken = null;
const pendingRequests = new Map();
const CHANNEL = "kytarovy-klub";

function appsScriptParentOrigin() {
  if (window.parent === window || !document.referrer) {
    throw new Error("Otevři Kytarový klub přes odkaz nasazené aplikace.");
  }
  const origin = new URL(document.referrer).origin;
  if (origin !== "https://script.google.com" && !origin.endsWith(".googleusercontent.com")) {
    throw new Error("Aplikaci je potřeba otevřít přes zabezpečený odkaz Apps Scriptu.");
  }
  return origin;
}

function callServer(method, ...args) {
  const targetOrigin = appsScriptParentOrigin();
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Apps Script neodpovídá. Zkontroluj připojení a zkus to znovu."));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timer, targetOrigin });
    window.addEventListener("message", receiveResponse);
    window.parent.postMessage({ channel: CHANNEL, type: "request", id, method, args }, targetOrigin);
  });
}

function receiveResponse(event) {
  const response = event.data;
  if (event.source !== window.parent || !response || response.channel !== CHANNEL
    || response.type !== "response" || typeof response.id !== "string") return;
  const pending = pendingRequests.get(response.id);
  if (!pending || event.origin !== pending.targetOrigin) return;

  pendingRequests.delete(response.id);
  clearTimeout(pending.timer);
  if (pendingRequests.size === 0) window.removeEventListener("message", receiveResponse);

  if (!response.result || typeof response.result.ok !== "boolean") {
    pending.reject(new Error("Apps Script vrátil neplatnou odpověď."));
  } else if (!response.result.ok) {
    const error = new Error(response.result.error || "Požadavek se nepodařilo dokončit.");
    error.status = response.result.status;
    pending.reject(error);
  } else {
    pending.resolve(response.result.data);
  }
}

export async function login(name, code) {
  const result = await callServer("login", name, code);
  accessToken = result.token;
  return result.user;
}

export async function logout() {
  if (!accessToken) return;
  const token = accessToken;
  try {
    await callServer("logout", token);
  } finally {
    accessToken = null;
  }
}

export function clearSession() {
  accessToken = null;
}

export function getClassData() {
  return callServer("getClassData", accessToken);
}

export function addStudent(name, code) {
  return callServer("addStudent", accessToken, name, code);
}

export function deactivateStudent(studentId) {
  return callServer("deactivateStudent", accessToken, studentId);
}

export function resetStudentCode(studentId, code) {
  return callServer("resetStudentCode", accessToken, studentId, code);
}

export function recordScores(date, scores) {
  return callServer("recordScores", accessToken, date, scores);
}

export function selectAvatar(avatarId) {
  return callServer("selectAvatar", accessToken, avatarId);
}
