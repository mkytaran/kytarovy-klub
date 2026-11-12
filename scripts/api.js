const API_URL = "https://kytarovy-klub-api.kytara.workers.dev/api/v2";
const SESSION_STORAGE_KEY = "kytarovy-klub-supabase-session";
const LEGACY_SESSION_STORAGE_KEY = "kytarovy-klub-session";
const CAN_PERSIST_SESSION = window.parent === window;

let accessToken = null;

if (CAN_PERSIST_SESSION) window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);

async function request(path, { method = "GET", body, authenticated = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store"
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Server vrátil neplatnou odpověď.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "Požadavek se nepodařilo dokončit.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function saveSession(token) {
  accessToken = token;
  if (CAN_PERSIST_SESSION) window.localStorage.setItem(SESSION_STORAGE_KEY, token);
}

export async function login(name, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { name, password },
    authenticated: false
  });
  saveSession(result.token);
  return result.user;
}

export async function restoreSession() {
  if (!CAN_PERSIST_SESSION) return null;
  accessToken = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!accessToken) return null;
  try {
    return await getClassData();
  } catch (error) {
    if (error.status === 401) clearSession();
    throw error;
  }
}

export async function logout() {
  try {
    if (accessToken) await request("/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
}

export function clearSession() {
  accessToken = null;
  if (CAN_PERSIST_SESSION) window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function getClassData() {
  return request("/data");
}

export async function addStudent(name, password, lessonDay) {
  return request("/students", {
    method: "POST",
    body: { name, password, lessonDay }
  });
}

export async function updateStudentLessonDay(studentId, lessonDay) {
  return request(`/students/${encodeURIComponent(studentId)}/lesson-day`, {
    method: "PUT",
    body: { lessonDay }
  });
}

export async function updateStudentAvatar(studentId, avatarId) {
  return request(`/students/${encodeURIComponent(studentId)}/avatar`, {
    method: "PUT",
    body: { avatarId }
  });
}

export async function deactivateStudent(studentId) {
  return request(`/students/${encodeURIComponent(studentId)}`, { method: "DELETE" });
}

export async function resetStudentPassword(studentId, password) {
  return request(`/students/${encodeURIComponent(studentId)}/password`, {
    method: "PUT",
    body: { password }
  });
}

export async function recordScores(date, scores, type, reason) {
  return request("/scores", {
    method: "POST",
    body: { date, scores, type, reason }
  });
}

export async function selectAvatar(avatarId) {
  return request("/me/avatar", {
    method: "PATCH",
    body: { avatarId }
  });
}
