import { handleSupabaseRequest } from "./supabase.js";

const GOOGLE_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_ATTEMPT_LIMIT = 5;
const IP_ATTEMPT_LIMIT = 60;
const DEFAULT_AVATAR = "cat";
const AVATAR_IDS = new Set([
  "cat", "dog", "rabbit", "bear", "lion", "tiger", "fox", "wolf", "mouse", "hamster",
  "squirrel", "hedgehog", "raccoon", "panda", "koala", "monkey", "gorilla", "elephant",
  "giraffe", "zebra", "horse", "unicorn", "cow", "pig", "sheep", "goat", "deer", "bison",
  "camel", "llama", "kangaroo", "sloth", "otter", "beaver", "seal", "dolphin", "whale",
  "orca", "shark", "octopus"
]);

let googleTokenCache;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = (env.APP_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) {
      return json({ error: "Tento původ není povolen." }, 403);
    }

    const headers = origin && allowedOrigins.includes(origin)
      ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin"
      }
      : {};

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(headers) });
    }

    try {
      const supabaseResponse = await handleSupabaseRequest(request, env);
      if (supabaseResponse) return withHeaders(supabaseResponse, headers);
      const response = await routeRequest(request, env);
      return withHeaders(response, headers);
    } catch (error) {
      if (error instanceof HttpError || error?.name === "SupabaseError") {
        return withHeaders(json({ error: error.message }, error.status), headers);
      }
      console.error("api_request_failed", error instanceof Error ? error.name : "UnknownError");
      return withHeaders(json({ error: "Požadavek se nepodařilo bezpečně dokončit." }, 500), headers);
    }
  }
};

export class LoginRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const { action, windowMs, limit } = await request.json();
    const now = Date.now();
    const result = await this.state.storage.transaction(async (storage) => {
      const previous = await storage.get("attempts") || { failures: [], lockedUntil: 0 };
      const failures = previous.failures.filter((timestamp) => now - timestamp < windowMs);
      if (action === "check") {
        const lockedUntil = previous.lockedUntil > now ? previous.lockedUntil : 0;
        await storage.put("attempts", { failures, lockedUntil });
        return { allowed: !lockedUntil, retryAfter: Math.max(0, Math.ceil((lockedUntil - now) / 1000)) };
      }
      if (action === "fail") {
        failures.push(now);
        const lockedUntil = failures.length >= limit ? now + windowMs : 0;
        await storage.put("attempts", { failures, lockedUntil });
        return { allowed: !lockedUntil, retryAfter: Math.max(0, Math.ceil((lockedUntil - now) / 1000)) };
      }
      if (action === "clear") {
        await storage.delete("attempts");
        return { allowed: true, retryAfter: 0 };
      }
      return { allowed: false, retryAfter: 0 };
    });
    return Response.json(result);
  }
}

export class UserSession {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === "POST") {
      const session = await request.json();
      await this.state.storage.put("session", session);
      return new Response(null, { status: 204 });
    }
    if (request.method === "DELETE") {
      await this.state.storage.delete("session");
      return new Response(null, { status: 204 });
    }
    const session = await this.state.storage.get("session");
    if (!session || session.expiresAt <= Date.now()) {
      await this.state.storage.delete("session");
      return Response.json({ error: "Přihlášení vypršelo." }, { status: 401 });
    }
    return Response.json(session);
  }
}

async function routeRequest(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/auth/login" && request.method === "POST") return loginUser(request, env);
  if (pathname === "/api/auth/bootstrap" && request.method === "POST") return bootstrapTeacher(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") return logoutUser(request, env);

  const account = await authenticatedAccount(request, env);
  if (pathname === "/api/data" && request.method === "GET") {
    return json(await getClassData(env, account));
  }
  if (pathname === "/api/students" && request.method === "POST") {
    requireTeacher(account);
    return createStudent(request, env);
  }
  if (pathname === "/api/scores" && request.method === "POST") {
    requireTeacher(account);
    return createScores(request, env);
  }
  if (pathname === "/api/me/avatar" && request.method === "PATCH") {
    if (account.role !== "student") throw new HttpError(403, "Tuto změnu může provést jen žák ve vlastním profilu.");
    return changeAvatar(request, env, account);
  }

  const codeMatch = pathname.match(/^\/api\/students\/([0-9a-f-]{36})\/code$/i);
  if (codeMatch && request.method === "PUT") {
    requireTeacher(account);
    return changeStudentCode(request, env, account, codeMatch[1]);
  }
  const studentMatch = pathname.match(/^\/api\/students\/([0-9a-f-]{36})$/i);
  if (studentMatch && request.method === "DELETE") {
    requireTeacher(account);
    return deactivateStudent(env, account, studentMatch[1]);
  }
  throw new HttpError(404, "Požadovaná stránka neexistuje.");
}

async function loginUser(request, env) {
  requireBindings(env);
  const input = await readJson(request);
  const name = cleanName(input.name);
  const code = cleanCode(input.code);
  const normalizedName = normalizeName(name);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `ip:${await hashPin(env, "address", ip)}`;
  const ipLimit = await checkLimit(env, ipKey, IP_ATTEMPT_LIMIT);
  if (!ipLimit.allowed) {
    throw new HttpError(429, "Příliš mnoho chybných pokusů. Přihlašování je dočasně uzamčeno.");
  }

  const accounts = await readAccounts(env);
  const account = accounts.find((item) => item.normalizedName === normalizedName && item.active);
  const accountKey = account
    ? `account:${await hashPin(env, "login", normalizedName)}`
    : "account:unknown";
  const accountLimit = await checkLimit(env, accountKey, ACCOUNT_ATTEMPT_LIMIT);
  if (!accountLimit.allowed) {
    throw new HttpError(429, "Příliš mnoho chybných pokusů. Přihlašování je dočasně uzamčeno.");
  }
  const salt = account?.pinSalt || "kytarovy-klub-neplatny-ucet";
  const suppliedHash = await hashPin(env, salt, code);
  const expectedHash = account?.pinHash || await hashPin(env, salt, "000000");
  if (!account || !constantTimeEqual(suppliedHash, expectedHash)) {
    await Promise.all([
      failLimit(env, accountKey, ACCOUNT_ATTEMPT_LIMIT),
      failLimit(env, ipKey, IP_ATTEMPT_LIMIT)
    ]);
    throw new HttpError(401, "Neplatné jméno nebo kód.");
  }

  await clearLimit(env, accountKey);
  const token = randomToken();
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const session = {
    userId: account.id,
    role: account.role,
    authVersion: account.authVersion,
    expiresAt
  };
  await sessionStub(env, await sha256(token)).fetch("https://session/create", {
    method: "POST",
    body: JSON.stringify(session)
  });
  return json({ token, user: publicAccount(account) });
}

async function bootstrapTeacher(request, env) {
  requireBindings(env);
  if (!env.BOOTSTRAP_SECRET || env.BOOTSTRAP_SECRET.length < 24) {
    throw new HttpError(503, "První účet učitele zatím není nakonfigurovaný.");
  }
  const suppliedSecret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!constantTimeEqual(await sha256(suppliedSecret), await sha256(env.BOOTSTRAP_SECRET))) {
    throw new HttpError(403, "Požadavek na založení účtu nebyl ověřen.");
  }
  const input = await readJson(request);
  const name = cleanName(input.name);
  const code = cleanCode(input.code);
  const accounts = await readAccounts(env);
  if (accounts.some((account) => account.role === "teacher")) {
    throw new HttpError(409, "Účet učitele už existuje.");
  }
  const account = await appendAccount(env, name, "teacher", code, "guitar");
  return json({ user: publicAccount(account) }, 201);
}

async function logoutUser(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) await sessionStub(env, await sha256(token)).fetch("https://session/revoke", { method: "DELETE" });
  return json({ ok: true });
}

async function authenticatedAccount(request, env) {
  requireBindings(env);
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token.length > 256) throw new HttpError(401, "Přihlášení je neplatné nebo vypršelo.");
  const sessionResponse = await sessionStub(env, await sha256(token)).fetch("https://session/check");
  if (!sessionResponse.ok) throw new HttpError(401, "Přihlášení je neplatné nebo vypršelo.");
  const session = await sessionResponse.json();
  const accounts = await readAccounts(env);
  const account = accounts.find((item) => item.id === session.userId && item.active);
  if (!account || account.authVersion !== session.authVersion || account.role !== session.role) {
    await sessionStub(env, await sha256(token)).fetch("https://session/revoke", { method: "DELETE" });
    throw new HttpError(401, "Přihlášení je neplatné nebo vypršelo.");
  }
  return account;
}

async function createStudent(request, env) {
  const input = await readJson(request);
  const name = cleanName(input.name);
  const code = cleanCode(input.code);
  const accounts = await readAccounts(env);
  if (accounts.some((account) => account.active && account.normalizedName === normalizeName(name))) {
    throw new HttpError(409, "Účet s tímto jménem už existuje.");
  }
  const student = await appendAccount(env, name, "student", code, DEFAULT_AVATAR);
  return json({ student: publicAccount(student) }, 201);
}

async function deactivateStudent(env, teacher, studentId) {
  const accounts = await readAccounts(env);
  const student = accounts.find((account) => account.id === studentId && account.role === "student" && account.active);
  if (!student) throw new HttpError(404, "Aktivního žáka se nepodařilo najít.");
  student.active = false;
  student.authVersion += 1;
  await updateAccount(env, student);
  return json({ ok: true, studentId: student.id, changedBy: teacher.id });
}

async function changeStudentCode(request, env, teacher, studentId) {
  const { code } = await readJson(request);
  const newCode = cleanCode(code);
  const accounts = await readAccounts(env);
  const student = accounts.find((account) => account.id === studentId && account.role === "student" && account.active);
  if (!student) throw new HttpError(404, "Aktivního žáka se nepodařilo najít.");
  student.pinSalt = randomToken(16);
  student.pinHash = await hashPin(env, student.pinSalt, newCode);
  student.authVersion += 1;
  await updateAccount(env, student);
  return json({ ok: true, changedBy: teacher.id });
}

async function changeAvatar(request, env, account) {
  const { avatarId } = await readJson(request);
  if (typeof avatarId !== "string" || !AVATAR_IDS.has(avatarId)) {
    throw new HttpError(400, "Vybraný avatar není dostupný.");
  }
  account.avatar = avatarId;
  await updateAccount(env, account);
  return json({ user: publicAccount(account) });
}

async function createScores(request, env) {
  const input = await readJson(request);
  if (!isValidDate(input.date)) throw new HttpError(400, "Datum lekce není platné.");
  if (!Array.isArray(input.scores) || input.scores.length < 1 || input.scores.length > 100) {
    throw new HttpError(400, "Zadej body alespoň jednomu a nejvýše stu žákům.");
  }
  const accounts = await readAccounts(env);
  const students = new Map(accounts
    .filter((account) => account.role === "student" && account.active)
    .map((account) => [account.id, account]));
  const createdAt = new Date().toISOString();
  const rows = input.scores.map((entry) => {
    const student = students.get(entry.studentId);
    if (!student) throw new HttpError(400, "Některý vybraný žák není aktivní.");
    if (!Number.isInteger(entry.score) || entry.score < 1 || entry.score > 10) {
      throw new HttpError(400, "Body musí být celé číslo od 1 do 10.");
    }
    return [crypto.randomUUID(), student.id, student.name, entry.score, input.date, createdAt];
  });
  await appendRows(env, "Scores", "F", rows);
  return json({ saved: rows.length }, 201);
}

async function getClassData(env, account) {
  const [accounts, scoreRows] = await Promise.all([
    readAccounts(env),
    readScoreRows(env)
  ]);
  const activeStudents = accounts.filter((item) => item.role === "student" && item.active);
  const allEntries = scoreRows.map(parseScore);
  if (allEntries.some((entry) => !entry.id
    || !entry.studentId
    || !entry.studentName
    || !Number.isInteger(entry.score)
    || entry.score < 1
    || entry.score > 10
    || !isValidDate(entry.date))) {
    throw new HttpError(503, "Soukromá tabulka obsahuje neplatný zápis bodů.");
  }
  const totals = new Map(activeStudents.map((student) => [student.id, { totalPoints: 0, lessonCount: 0 }]));
  for (const entry of allEntries) {
    const total = totals.get(entry.studentId);
    if (!total) continue;
    total.totalPoints += entry.score;
    total.lessonCount += 1;
  }
  const students = activeStudents.map((student) => ({
    ...publicAccount(student),
    ...totals.get(student.id)
  }));
  const entries = account.role === "teacher"
    ? allEntries
    : allEntries.filter((entry) => entry.studentId === account.id);
  return {
    user: publicAccount(account),
    students,
    entries
  };
}

async function readAccounts(env) {
  const { valueRanges } = await readRanges(env, ["Accounts!A2:J"]);
  const rows = valueRanges?.[0]?.values || [];
  return rows.flatMap((row, index) => {
    if (!row.some((cell) => String(cell ?? "").trim())) return [];
    const account = parseAccount(row, index + 2);
    if (!account.id
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.id)
      || !account.name
      || account.name.length > 80
      || /[\u0000-\u001f\u007f]/.test(account.name)
      || account.normalizedName !== normalizeName(account.name)
      || !["teacher", "student"].includes(account.role)
      || !/^[A-Za-z0-9_-]{22}$/.test(account.pinSalt)
      || !/^[A-Za-z0-9_-]{43}$/.test(account.pinHash)
      || (!AVATAR_IDS.has(account.avatar) && account.avatar !== "guitar")
      || ![true, false, "true", "false"].includes(row[7])
      || !Number.isInteger(account.authVersion)
      || account.authVersion < 1
      || !Number.isFinite(Date.parse(account.createdAt))) {
      throw new HttpError(503, "Soukromá tabulka obsahuje neplatný účet.");
    }
    return [account];
  });
}

async function readScoreRows(env) {
  const { valueRanges } = await readRanges(env, ["Scores!A2:F"]);
  return valueRanges?.[0]?.values || [];
}

function parseAccount(row, rowNumber) {
  return {
    id: String(row[0] || ""),
    name: String(row[1] || ""),
    normalizedName: String(row[2] || ""),
    role: String(row[3] || ""),
    pinSalt: String(row[4] || ""),
    pinHash: String(row[5] || ""),
    avatar: String(row[6] || ""),
    active: row[7] === true || String(row[7]).toLowerCase() === "true",
    authVersion: Number(row[8]) || 1,
    createdAt: String(row[9] || ""),
    rowNumber
  };
}

function parseScore(row) {
  const score = Number(row[3]);
  return {
    id: String(row[0] || ""),
    studentId: String(row[1] || ""),
    studentName: String(row[2] || ""),
    score,
    date: String(row[4] || ""),
    createdAt: String(row[5] || "")
  };
}

async function appendAccount(env, name, role, code, avatar) {
  const pinSalt = randomToken(16);
  const account = {
    id: crypto.randomUUID(),
    name,
    normalizedName: normalizeName(name),
    role,
    pinSalt,
    pinHash: await hashPin(env, pinSalt, code),
    avatar,
    active: true,
    authVersion: 1,
    createdAt: new Date().toISOString()
  };
  await appendRows(env, "Accounts", "J", [[
    account.id,
    account.name,
    account.normalizedName,
    account.role,
    account.pinSalt,
    account.pinHash,
    account.avatar,
    true,
    account.authVersion,
    account.createdAt
  ]]);
  return account;
}

async function updateAccount(env, account) {
  const row = [[
    account.id,
    account.name,
    account.normalizedName,
    account.role,
    account.pinSalt,
    account.pinHash,
    account.avatar,
    account.active,
    account.authVersion,
    account.createdAt
  ]];
  const range = `Accounts!A${account.rowNumber}:J${account.rowNumber}`;
  await googleSheetsRequest(env, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: row })
  });
}

async function readRanges(env, ranges) {
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  return googleSheetsRequest(env, `/values:batchGet?${query}`);
}

async function appendRows(env, sheetName, lastColumn, rows) {
  const range = encodeURIComponent(`${sheetName}!A:${lastColumn}`);
  return googleSheetsRequest(env, `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: rows })
  });
}

async function googleSheetsRequest(env, path, options = {}) {
  requireBindings(env);
  const token = await googleAccessToken(env);
  const url = `${GOOGLE_API}/${encodeURIComponent(env.SPREADSHEET_ID)}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(503, "Soukromou tabulku se nepodařilo načíst. Zkontroluj její oprávnění a konfiguraci serveru.");
  }
  return response.status === 204 ? null : response.json();
}

async function googleAccessToken(env) {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 60_000) {
    return googleTokenCache.token;
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  }));
  const encodedKey = env.GOOGLE_PRIVATE_KEY
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const keyBytes = Uint8Array.from(atob(encodedKey), (character) => character.charCodeAt(0));
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) {
    let errorCode = "";
    try {
      const body = await response.json();
      if (typeof body.error === "string") errorCode = body.error;
    } catch {
      await response.body?.cancel();
    }
    const message = {
      invalid_grant: "Google odmítl podepsaný požadavek. Zkontroluj, že GOOGLE_SERVICE_ACCOUNT_EMAIL a GOOGLE_PRIVATE_KEY pocházejí ze stejného JSON klíče a že tento klíč není v Google Cloud zrušený.",
      invalid_client: "Google odmítl účet služby. Zkontroluj GOOGLE_SERVICE_ACCOUNT_EMAIL a GOOGLE_PRIVATE_KEY ze stejného JSON klíče.",
      unauthorized_client: "Google nepovolil ověření tímto účtem služby. Zkontroluj, že účet služby je aktivní a Google Sheets API je povolené v jeho projektu.",
      access_denied: "Google zamítl přístup. Zkontroluj, že tabulka je sdílená jako Čtenář přesně s e-mailem účtu služby.",
      invalid_scope: "Google odmítl požadovaná oprávnění. Zkontroluj nastavení účtu služby a povolené Google Sheets API."
    }[errorCode] || "Google odmítl ověření účtu služby. Zkontroluj, že e-mail a privátní klíč pocházejí ze stejného JSON klíče a že účet služby je aktivní.";
    console.error("google_auth_failed", errorCode || `HTTP_${response.status}`);
    throw new HttpError(503, message);
  }
  const result = await response.json();
  googleTokenCache = {
    token: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000
  };
  return googleTokenCache.token;
}

async function hashPin(env, salt, code) {
  if (!env.PIN_PEPPER || env.PIN_PEPPER.length < 32) {
    throw new HttpError(503, "Zabezpečené ověřování kódů není nakonfigurované.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PIN_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${salt}:${code}`));
  return base64Url(new Uint8Array(signature));
}

async function checkLimit(env, key, limit) {
  return limiterRequest(env, key, { action: "check", windowMs: ATTEMPT_WINDOW_MS, limit });
}

async function failLimit(env, key, limit) {
  return limiterRequest(env, key, { action: "fail", windowMs: ATTEMPT_WINDOW_MS, limit });
}

async function clearLimit(env, key) {
  return limiterRequest(env, key, { action: "clear", windowMs: ATTEMPT_WINDOW_MS, limit: ACCOUNT_ATTEMPT_LIMIT });
}

async function limiterRequest(env, name, payload) {
  if (!env.LOGIN_LIMITER) throw new HttpError(503, "Ochrana přihlášení není nakonfigurovaná.");
  const id = env.LOGIN_LIMITER.idFromName(name);
  const response = await env.LOGIN_LIMITER.get(id).fetch("https://limiter/action", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

function sessionStub(env, tokenHash) {
  if (!env.USER_SESSION) throw new HttpError(503, "Úložiště přihlášení není nakonfigurované.");
  const id = env.USER_SESSION.idFromName(`session:${tokenHash}`);
  return env.USER_SESSION.get(id);
}

async function sha256(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Požadavek musí obsahovat data JSON.");
  }
  const text = await request.text();
  if (text.length > 16_384) throw new HttpError(413, "Požadavek je příliš velký.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Požadavek obsahuje neplatná data.");
  }
}

function cleanName(value) {
  if (typeof value !== "string") throw new HttpError(400, "Jméno není platné.");
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, "Jméno musí mít 2 až 80 znaků.");
  }
  return name;
}

function cleanCode(value) {
  if (typeof value !== "string" || !/^[0-9]{6}$/.test(value)) {
    throw new HttpError(400, "Kód musí obsahovat přesně šest číslic.");
  }
  return value;
}

function normalizeName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("cs-CZ");
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    avatar: account.avatar
  };
}

function requireTeacher(account) {
  if (account.role !== "teacher") throw new HttpError(403, "Tuto akci může provést jen učitel.");
}

function requireBindings(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    || !env.GOOGLE_PRIVATE_KEY
    || !env.SPREADSHEET_ID) {
    throw new HttpError(503, "Zabezpečené úložiště ještě není nakonfigurované.");
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function responseHeaders(additional = {}) {
  return new Headers({
    ...additional,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
  });
}

function withHeaders(response, additional) {
  const headers = responseHeaders(additional);
  response.headers.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
