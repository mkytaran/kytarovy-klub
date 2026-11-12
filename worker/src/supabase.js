const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_ATTEMPT_LIMIT = 5;
const IP_ATTEMPT_LIMIT = 60;
const AVATAR_IDS = new Set([
  "cat", "dog", "rabbit", "bear", "lion", "tiger", "fox", "wolf", "mouse", "hamster",
  "squirrel", "hedgehog", "raccoon", "panda", "koala", "monkey", "gorilla", "elephant",
  "giraffe", "zebra", "horse", "unicorn", "cow", "pig", "sheep", "goat", "deer", "bison",
  "camel", "llama", "kangaroo", "sloth", "otter", "beaver", "seal", "dolphin", "whale",
  "orca", "shark", "octopus", "guitar"
]);

class SupabaseError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SupabaseError";
    this.status = status;
  }
}

export async function handleSupabaseRequest(request, env) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/v2/")) return null;
  requireSupabaseConfig(env);

  if (pathname === "/api/v2/auth/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/v2/auth/bootstrap" && request.method === "POST") return bootstrapTeacher(request, env);
  if (pathname === "/api/v2/auth/teacher-password" && request.method === "POST") {
    await requireBootstrapSecret(request, env);
    return resetTeacherPassword(request, env);
  }
  if (pathname === "/api/v2/auth/logout" && request.method === "POST") return logout(request, env);
  const account = await authenticatedAccount(request, env);
  if (pathname === "/api/v2/data" && request.method === "GET") {
    return json(await getClassData(env, account));
  }
  if (pathname === "/api/v2/students" && request.method === "POST") {
    requireTeacher(account);
    return createStudent(request, env);
  }
  if (pathname === "/api/v2/scores" && request.method === "POST") {
    requireTeacher(account);
    return createScores(request, env);
  }
  if (pathname === "/api/v2/me/avatar" && request.method === "PATCH") {
    const { avatarId } = await readJson(request);
    return updateAvatar(env, account.id, avatarId, account.role);
  }

  const studentMatch = pathname.match(/^\/api\/v2\/students\/([0-9a-f-]{36})(?:\/(avatar|lesson-day|password))?$/i);
  if (studentMatch) {
    requireTeacher(account);
    const [, studentId, action] = studentMatch;
    if (request.method === "DELETE" && !action) return deactivateStudent(env, studentId);
    if (request.method === "PUT" && action === "avatar") {
      const { avatarId } = await readJson(request);
      return updateAvatar(env, studentId, avatarId);
    }
    if (request.method === "PUT" && action === "lesson-day") {
      const { lessonDay } = await readJson(request);
      if (!isLessonDay(lessonDay)) throw new SupabaseError(400, "Vybraný den hodiny není platný.");
      const [student] = await updateRows(env, "profiles", { lesson_day: lessonDay }, {
        id: `eq.${studentId}`, role: "eq.student", active: "eq.true"
      });
      if (!student) throw new SupabaseError(404, "Aktivního žáka se nepodařilo najít.");
      return json({ student: publicProfile(student) });
    }
    if (request.method === "PUT" && action === "password") {
      const { password } = await readJson(request);
      return updateStudentPassword(env, studentId, password);
    }
  }
  throw new SupabaseError(404, "Požadovaná stránka neexistuje.");
}

async function login(request, env) {
  const { name, password } = await readJson(request);
  const clean = cleanName(name);
  if (typeof password !== "string" || password.length < 1 || password.length > 128) {
    throw new SupabaseError(400, "Přihlašovací údaje nejsou platné.");
  }
  const normalizedName = normalizeName(clean);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const accountKey = `account:${await sha256(normalizedName)}`;
  const ipKey = `ip:${await sha256(ip)}`;
  await checkLimit(env, accountKey, ACCOUNT_ATTEMPT_LIMIT);
  await checkLimit(env, ipKey, IP_ATTEMPT_LIMIT);

  const profiles = await selectRows(env, "profiles", {
    select: "id,name,normalized_name,role,avatar,avatar_chosen,active,lesson_day,auth_version",
    normalized_name: `eq.${normalizedName}`,
    active: "eq.true",
    limit: "1"
  });
  const profile = profiles[0];
  const email = loginEmail(profile?.id || crypto.randomUUID());
  let validPassword = false;
  try {
    await authRequest(env, "/auth/v1/token?grant_type=password", {
      method: "POST",
      key: env.SUPABASE_PUBLISHABLE_KEY,
      headers: { Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}` },
      bearer: env.SUPABASE_PUBLISHABLE_KEY,
      body: { email, password }
    });
    validPassword = true;
  } catch (error) {
    if (!(error instanceof SupabaseError) || ![400, 401].includes(error.status)) throw error;
  }
  if (!validPassword || !profile) {
    await Promise.all([
      failLimit(env, accountKey, ACCOUNT_ATTEMPT_LIMIT),
      failLimit(env, ipKey, IP_ATTEMPT_LIMIT)
    ]);
    throw new SupabaseError(401, "Neplatné jméno nebo heslo.");
  }
  await clearLimit(env, accountKey);

  const token = randomToken();
  await sessionStub(env, await sha256(token)).fetch("https://session/create", {
    method: "POST",
    body: JSON.stringify({
      userId: profile.id,
      role: profile.role,
      authVersion: profile.auth_version,
      expiresAt: Date.now() + SESSION_LIFETIME_MS
    })
  });
  return json({ token, user: publicProfile(profile) });
}

async function bootstrapTeacher(request, env) {
  await requireBootstrapSecret(request, env);
  const { name, password } = await readJson(request);
  const clean = cleanName(name);
  validateNewPassword(password);
  const existing = await selectRows(env, "profiles", { select: "id", role: "eq.teacher", limit: "1" });
  if (existing.length) throw new SupabaseError(409, "Účet učitele už existuje.");

  const profile = await createAuthProfile(env, clean, "teacher", password, "guitar", "");
  return json({ user: publicProfile(profile) }, 201);
}

async function resetTeacherPassword(request, env) {
  const { password } = await readJson(request);
  validateNewPassword(password);
  const teachers = await selectRows(env, "profiles", {
    select: "id,auth_version",
    role: "eq.teacher",
    active: "eq.true",
    limit: "2"
  });
  if (teachers.length !== 1) {
    throw new SupabaseError(409, "Musí existovat právě jeden aktivní účet učitele.");
  }
  const teacher = teachers[0];
  await authRequest(env, `/auth/v1/admin/users/${encodeURIComponent(teacher.id)}`, {
    method: "PUT",
    body: { password }
  });
  const updated = await updateRows(env, "profiles", {
    auth_version: teacher.auth_version + 1
  }, {
    id: `eq.${teacher.id}`,
    role: "eq.teacher",
    active: "eq.true"
  });
  if (!updated.length) throw new SupabaseError(503, "Heslo se změnilo, ale relaci se nepodařilo obnovit; přihlas se novým heslem.");
  return json({ ok: true }, 200, { "Cache-Control": "no-store" });
}

async function requireBootstrapSecret(request, env) {
  if (!env.SUPABASE_BOOTSTRAP_SECRET || env.SUPABASE_BOOTSTRAP_SECRET.length < 24) {
    throw new SupabaseError(503, "Tajný klíč pro jednorázovou správu není nakonfigurovaný.");
  }
  const supplied = bearerToken(request);
  if (!constantTimeEqual(await sha256(supplied), await sha256(env.SUPABASE_BOOTSTRAP_SECRET))) {
    throw new SupabaseError(403, "Požadavek na správu nebyl ověřen.");
  }
}

async function logout(request, env) {
  const token = bearerToken(request);
  if (token) await sessionStub(env, await sha256(token)).fetch("https://session/revoke", { method: "DELETE" });
  return json({ ok: true });
}

async function authenticatedAccount(request, env) {
  const token = bearerToken(request);
  if (!token || token.length > 256) throw new SupabaseError(401, "Přihlášení je neplatné nebo vypršelo.");
  const sessionResponse = await sessionStub(env, await sha256(token)).fetch("https://session/check");
  if (!sessionResponse.ok) throw new SupabaseError(401, "Přihlášení je neplatné nebo vypršelo.");
  const session = await sessionResponse.json();
  const profiles = await selectRows(env, "profiles", {
    select: "id,name,normalized_name,role,avatar,avatar_chosen,active,lesson_day,auth_version",
    id: `eq.${session.userId}`,
    active: "eq.true",
    limit: "1"
  });
  const profile = profiles[0];
  if (!profile || profile.role !== session.role || profile.auth_version !== session.authVersion) {
    await sessionStub(env, await sha256(token)).fetch("https://session/revoke", { method: "DELETE" });
    throw new SupabaseError(401, "Přihlášení je neplatné nebo vypršelo.");
  }
  session.expiresAt = Date.now() + SESSION_LIFETIME_MS;
  await sessionStub(env, await sha256(token)).fetch("https://session/create", {
    method: "POST",
    body: JSON.stringify(session)
  });
  return profile;
}

async function createStudent(request, env) {
  const { name, password, lessonDay = "" } = await readJson(request);
  const clean = cleanName(name);
  validateNewPassword(password);
  if (!isLessonDay(lessonDay)) throw new SupabaseError(400, "Vybraný den hodiny není platný.");
  const existing = await selectRows(env, "profiles", {
    select: "id",
    normalized_name: `eq.${normalizeName(clean)}`,
    active: "eq.true",
    limit: "1"
  });
  if (existing.length) throw new SupabaseError(409, "Účet s tímto jménem už existuje.");
  const profile = await createAuthProfile(env, clean, "student", password, "cat", lessonDay);
  return json({ student: publicProfile(profile) }, 201);
}

async function createAuthProfile(env, name, role, password, avatar, lessonDay) {
  const normalizedName = normalizeName(name);
  let createdUser;
  try {
    createdUser = await authRequest(env, "/auth/v1/admin/users", {
      method: "POST",
      body: {
        email: loginEmail(crypto.randomUUID()),
        password,
        email_confirm: true,
        user_metadata: { name }
      }
    });
    await authRequest(env, `/auth/v1/admin/users/${encodeURIComponent(createdUser.id)}`, {
      method: "PUT",
      body: { email: loginEmail(createdUser.id), email_confirm: true }
    });
    const [profile] = await insertRows(env, "profiles", {
      id: createdUser.id,
      name,
      normalized_name: normalizedName,
      role,
      avatar,
      avatar_chosen: false,
      active: true,
      lesson_day: lessonDay,
      auth_version: 1
    });
    return profile;
  } catch (error) {
    if (createdUser?.id) {
      try {
        await authRequest(env, `/auth/v1/admin/users/${encodeURIComponent(createdUser.id)}`, { method: "DELETE" });
      } catch (cleanupError) {
        console.error("supabase_auth_rollback_failed", cleanupError instanceof Error ? cleanupError.name : "UnknownError");
      }
    }
    if (error instanceof SupabaseError && error.status === 409) {
      throw new SupabaseError(409, "Účet s tímto jménem už existuje.");
    }
    throw error;
  }
}

async function updateStudentPassword(env, studentId, password) {
  validateNewPassword(password);
  const [student] = await selectRows(env, "profiles", {
    select: "id,auth_version",
    id: `eq.${studentId}`,
    role: "eq.student",
    active: "eq.true",
    limit: "1"
  });
  if (!student) throw new SupabaseError(404, "Aktivního žáka se nepodařilo najít.");
  await authRequest(env, `/auth/v1/admin/users/${encodeURIComponent(student.id)}`, {
    method: "PUT",
    body: { password }
  });
  await updateRows(env, "profiles", { auth_version: student.auth_version + 1 }, {
    id: `eq.${studentId}`,
    role: "eq.student",
    active: "eq.true"
  });
  return json({ ok: true });
}

async function deactivateStudent(env, studentId) {
  const [student] = await updateRows(env, "profiles", { active: false }, {
    id: `eq.${studentId}`,
    role: "eq.student",
    active: "eq.true"
  });
  if (!student) throw new SupabaseError(404, "Aktivního žáka se nepodařilo najít.");
  return json({ ok: true, studentId });
}

async function updateAvatar(env, studentId, avatarId, role = "student") {
  if (typeof avatarId !== "string" || !AVATAR_IDS.has(avatarId)) {
    throw new SupabaseError(400, "Vybraný avatar není dostupný.");
  }
  const [profile] = await updateRows(env, "profiles", {
    avatar: avatarId,
    avatar_chosen: true
  }, {
    id: `eq.${studentId}`,
    role: `eq.${role}`,
    active: "eq.true"
  });
  if (!profile) throw new SupabaseError(404, "Aktivní účet se nepodařilo najít.");
  return json({ user: publicProfile(profile) });
}

async function createScores(request, env) {
  const { date, scores, type = "lesson", reason = "" } = await readJson(request);
  if (!isValidDate(date)) throw new SupabaseError(400, "Datum lekce není platné.");
  if (type !== "lesson" && type !== "extra") throw new SupabaseError(400, "Vyber běžné nebo mimořádné body.");
  if (type === "extra" && (typeof reason !== "string" || reason.trim().length < 2 || reason.trim().length > 120)) {
    throw new SupabaseError(400, "U mimořádných bodů uveď důvod dlouhý 2 až 120 znaků.");
  }
  if (!Array.isArray(scores) || scores.length < 1 || scores.length > 100) {
    throw new SupabaseError(400, "Zadej body alespoň jednomu a nejvýše stu žákům.");
  }
  const profiles = await selectRows(env, "profiles", {
    select: "id,name",
    role: "eq.student",
    active: "eq.true"
  });
  const students = new Map(profiles.map((profile) => [profile.id, profile]));
  const selectedIds = new Set();
  const rows = scores.map((entry) => {
    const student = entry && students.get(entry.studentId);
    if (!student) throw new SupabaseError(400, "Některý vybraný žák není aktivní.");
    if (selectedIds.has(student.id)) throw new SupabaseError(400, "Žák může být v jednom zápisu uveden jen jednou.");
    if (!Number.isInteger(entry.score) || entry.score < 1 || entry.score > 10) {
      throw new SupabaseError(400, "Body musí být celé číslo od 1 do 10.");
    }
    selectedIds.add(student.id);
    return {
      student_id: student.id,
      student_name: student.name,
      score: entry.score,
      point_date: date,
      entry_type: type,
      reason: type === "extra" ? reason.trim().replace(/\s+/g, " ") : ""
    };
  });
  try {
    await insertRows(env, "point_entries", rows);
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 409) {
      throw new SupabaseError(409, "Běžné body pro některého žáka už jsou zapsané v tomto týdnu.");
    }
    throw error;
  }
  return json({ saved: rows.length }, 201);
}

async function getClassData(env, account) {
  const [profiles, entries] = await Promise.all([
    selectRows(env, "profiles", {
      select: "id,name,role,avatar,avatar_chosen,active,lesson_day",
      role: "eq.student",
      active: "eq.true",
      order: "name.asc"
    }),
    selectRows(env, "point_entries", {
      select: "id,student_id,student_name,score,point_date,created_at,entry_type,reason",
      order: "point_date.desc,created_at.desc"
    })
  ]);
  const visibleEntries = account.role === "teacher"
    ? entries
    : entries.filter((entry) => entry.student_id === account.id);
  const totals = new Map(profiles.map((profile) => [profile.id, { totalPoints: 0, lessonCount: 0 }]));
  for (const entry of entries) {
    const total = totals.get(entry.student_id);
    if (!total) continue;
    total.totalPoints += entry.score;
    if (entry.entry_type === "lesson") total.lessonCount += 1;
  }
  const students = profiles.map((profile) => {
    const student = { ...publicProfile(profile), ...totals.get(profile.id) };
    if (account.role !== "teacher") delete student.lessonDay;
    return student;
  });
  return {
    user: publicProfile(account),
    students,
    entries: visibleEntries.map(publicEntry)
  };
}

function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    avatar: profile.avatar,
    avatarChosen: profile.avatar_chosen,
    lessonDay: profile.lesson_day || ""
  };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    studentId: entry.student_id,
    studentName: entry.student_name,
    score: entry.score,
    date: entry.point_date,
    createdAt: entry.created_at,
    type: entry.entry_type,
    reason: entry.reason
  };
}

async function selectRows(env, table, filters) {
  const query = new URLSearchParams(filters);
  return supabaseRequest(env, `/rest/v1/${table}?${query}`);
}

async function insertRows(env, table, rows) {
  return supabaseRequest(env, `/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: rows
  });
}

async function updateRows(env, table, values, filters) {
  const query = new URLSearchParams(filters);
  return supabaseRequest(env, `/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: values
  });
}

async function supabaseRequest(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...options.headers
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  return parseSupabaseResponse(response);
}

async function authRequest(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: options.key || env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...options.headers
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  return parseSupabaseResponse(response);
}

async function parseSupabaseResponse(response) {
  if (response.ok) return response.status === 204 ? null : response.json();
  let message = "Supabase požadavek se nepodařilo dokončit.";
  try {
    const body = await response.json();
    if (response.status < 500 && typeof body.message === "string") message = body.message;
    if (response.status < 500 && typeof body.msg === "string") message = body.msg;
    if (response.status < 500 && typeof body.error_description === "string") message = body.error_description;
  } catch {
    await response.body?.cancel();
  }
  const status = response.status >= 500 ? 503 : response.status;
  throw new SupabaseError(status, message);
}

async function checkLimit(env, key, limit) {
  const result = await limiterRequest(env, key, "check", limit);
  if (!result.allowed) throw new SupabaseError(429, "Příliš mnoho chybných pokusů. Přihlašování je dočasně uzamčeno.");
}

async function failLimit(env, key, limit) {
  return limiterRequest(env, key, "fail", limit);
}

async function clearLimit(env, key) {
  return limiterRequest(env, key, "clear", ACCOUNT_ATTEMPT_LIMIT);
}

async function limiterRequest(env, name, action, limit) {
  if (!env.LOGIN_LIMITER) throw new SupabaseError(503, "Ochrana přihlášení není nakonfigurovaná.");
  const id = env.LOGIN_LIMITER.idFromName(name);
  const response = await env.LOGIN_LIMITER.get(id).fetch("https://limiter/action", {
    method: "POST",
    body: JSON.stringify({ action, windowMs: ATTEMPT_WINDOW_MS, limit })
  });
  return response.json();
}

function sessionStub(env, tokenHash) {
  if (!env.USER_SESSION) throw new SupabaseError(503, "Úložiště přihlášení není nakonfigurované.");
  return env.USER_SESSION.get(env.USER_SESSION.idFromName(`session:${tokenHash}`));
}

function bearerToken(request) {
  return request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
}

async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw new SupabaseError(415, "Požadavek musí obsahovat data JSON.");
  }
  const text = await request.text();
  if (text.length > 16_384) throw new SupabaseError(413, "Požadavek je příliš velký.");
  try {
    return JSON.parse(text);
  } catch {
    throw new SupabaseError(400, "Požadavek obsahuje neplatná data.");
  }
}

function cleanName(value) {
  if (typeof value !== "string") throw new SupabaseError(400, "Jméno není platné.");
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new SupabaseError(400, "Jméno musí mít 2 až 80 znaků.");
  }
  return name;
}

function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new SupabaseError(400, "Heslo musí mít 12 až 128 znaků.");
  }
}

function normalizeName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("cs-CZ");
}

function loginEmail(id) {
  return `user-${id}@login.kytarovy-klub.invalid`;
}

function isLessonDay(value) {
  return value === ""
    || ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(value);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function requireTeacher(account) {
  if (account.role !== "teacher") throw new SupabaseError(403, "Tuto akci může provést jen učitel.");
}

function requireSupabaseConfig(env) {
  if (!env.SUPABASE_URL || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL)
    || !env.SUPABASE_SECRET_KEY || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new SupabaseError(503, "Supabase není na serveru nakonfigurované.");
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(a.length, 1)] || 0) ^ (b[index % Math.max(b.length, 1)] || 0);
  }
  return difference === 0;
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}
