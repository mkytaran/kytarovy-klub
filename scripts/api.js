let accessToken = null;
const pendingRequests = new Map();
const CHANNEL = "kytarovy-klub";

function isAppsScriptOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:"
      && (url.hostname === "script.google.com" || url.hostname.endsWith(".googleusercontent.com"));
  } catch {
    return false;
  }
}

function appsScriptParentOrigin() {
  if (window.parent === window || !document.referrer) {
    throw new Error("Otevři Kytarový klub přes odkaz nasazené aplikace.");
  }
  const origin = new URL(document.referrer).origin;
  if (!isAppsScriptOrigin(origin)) {
    throw new Error("Aplikaci je potřeba otevřít přes zabezpečený odkaz Apps Scriptu.");
  }
  return origin;
}

function createAppsScriptBridge() {
  const endpoint = document.querySelector('meta[name="apps-script-url"]')?.content;
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error("Chybí platná URL nasazení Apps Scriptu.");
  }
  if (endpointUrl.protocol !== "https:" || endpointUrl.hostname !== "script.google.com"
    || !/\/macros\/s\/[^/]+\/exec$/.test(endpointUrl.pathname)) {
    throw new Error("URL nasazení Apps Scriptu není platná.");
  }
  const bridgeNonce = crypto.randomUUID();
  endpointUrl.searchParams.set("bridge", "1");
  endpointUrl.searchParams.set("bridge_nonce", bridgeNonce);

  const frame = document.createElement("iframe");
  frame.title = "Spojení se zabezpečeným serverem";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:absolute;width:1px;height:1px;left:-10000px;border:0";
  document.body.append(frame);

  let resolveReady;
  let rejectReady;
  let ready = false;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeout = setTimeout(() => {
    if (ready) return;
    rejectReady(new Error("Zabezpečený server se neozval. Zkontroluj připojení a zkus to znovu."));
  }, 20000);

  window.addEventListener("message", function onBridgeMessage(event) {
    if (!isAppsScriptOrigin(event.origin)
      || !event.data || event.data.channel !== CHANNEL || event.data.type !== "ready"
      || event.data.bridgeNonce !== bridgeNonce) return;
    ready = true;
    clearTimeout(timeout);
    window.removeEventListener("message", onBridgeMessage);
    resolveReady({ target: event.source, targetOrigin: event.origin, bridgeNonce });
  });
  frame.addEventListener("error", () => {
    if (ready) return;
    clearTimeout(timeout);
    rejectReady(new Error("Zabezpečený server se nepodařilo načíst."));
  }, { once: true });
  frame.src = endpointUrl.href;
  return readyPromise;
}

const standaloneBridge = window.parent === window
  ? Promise.resolve().then(createAppsScriptBridge)
  : null;
standaloneBridge?.catch(() => {});

function callServer(method, ...args) {
  return (async () => {
    const bridge = standaloneBridge
      ? await standaloneBridge
      : { target: window.parent, targetOrigin: appsScriptParentOrigin() };
    const { target, targetOrigin } = bridge;
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("Apps Script neodpovídá. Zkontroluj připojení a zkus to znovu."));
      }, 30000);

      pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        targetOrigin,
        target,
        bridgeNonce: bridge.bridgeNonce
      });
      window.addEventListener("message", receiveResponse);
      target.postMessage({
        channel: CHANNEL,
        type: "request",
        id,
        method,
        args,
        ...(bridge.bridgeNonce ? { bridgeNonce: bridge.bridgeNonce } : {})
      }, targetOrigin);
    });
  })();
}

function receiveResponse(event) {
  const response = event.data;
  if (!response || response.channel !== CHANNEL
    || response.type !== "response" || typeof response.id !== "string") return;
  const pending = pendingRequests.get(response.id);
  if (!pending || event.source !== pending.target || event.origin !== pending.targetOrigin
    || (pending.bridgeNonce && response.bridgeNonce !== pending.bridgeNonce)) return;

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
