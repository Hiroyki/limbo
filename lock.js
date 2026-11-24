"use strict";

// Browser lock. While locked, every Chrome window is minimized and a lock
// window asks for the passcode. This keeps passers-by out; it is not
// encryption, and someone who controls the computer can get around it.
const LOCK_PAGE = "ui/lock.html";
const PBKDF2_ROUNDS = 600000;
const MIN_PASSCODE = 4;
const IDLE_MINUTES = [0, 5, 15, 30];
const FREE_TRIES = 5;                        // then waits: 30 s, doubling to 10 min

// ---------- Secrets ----------
const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function hashSecret(secret, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS }, key, 256));
}

async function sealSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: toBase64(await hashSecret(secret, salt)) };
}

async function matches(secret, sealed) {
  const expected = fromBase64(sealed.hash);
  const actual = await hashSecret(secret, fromBase64(sealed.salt));
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

// Letters and digits that can't be confused with one another.
function makeRecoveryCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < 12) {
    const [n] = crypto.getRandomValues(new Uint8Array(1));
    if (n < limit) code += alphabet[n % alphabet.length];
  }
  return code.match(/.{4}/g).join("-");
}

const tidyCode = (text) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---------- Saved state ----------
async function getLock() {
  const { lock } = await chrome.storage.local.get("lock");
  return lock?.passcode?.hash ? lock : null;
}

const setLock = (lock) => chrome.storage.local.set({ lock });

async function isLocked() {
  const { locked } = await chrome.storage.local.get("locked");
  return locked === true && (await getLock()) !== null;
}

// One thing at a time, so windows and tries are never handled twice at once.
let queue = Promise.resolve();
function inTurn(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

// ---------- Checking a passcode ----------
async function tryPasscode(secret) {
  const lock = await getLock();
  if (!lock) return { ok: true };
  const wait = (lock.until ?? 0) - Date.now();
  if (wait > 0) return { ok: false, waitMs: wait };

  const text = String(secret ?? "").slice(0, 200);
  const passcode = await matches(text, lock.passcode);
  const recovery = !passcode && tidyCode(text).length === 12 && await matches(tidyCode(text), lock.recovery);
  if (passcode || recovery) {
    await setLock({ ...lock, fails: 0, until: 0 });
    return { ok: true, recovery };
  }
  const fails = (lock.fails ?? 0) + 1;
  const over = fails - FREE_TRIES;
  const waitMs = over >= 0 ? Math.min(600000, 30000 * 2 ** Math.min(over, 10)) : 0;
  await setLock({ ...lock, fails, until: waitMs ? Date.now() + waitMs : 0 });
  return { ok: false, waitMs };
}

// ---------- Windows ----------
async function lockWindow() {
  const { lockWindowId } = await chrome.storage.session.get("lockWindowId");
  if (lockWindowId === undefined) return null;
  return chrome.windows.get(lockWindowId).catch(() => null);
}

// Lock windows left over from before a reload, or restored with a session,
// no longer answer to anyone. Close every one except the current guard.
async function closeStrays(guardId) {
  const page = chrome.runtime.getURL(LOCK_PAGE);
  for (const tab of await chrome.tabs.query({})) {
    if (tab.windowId === guardId) continue;
    if ((tab.url || tab.pendingUrl || "").startsWith(page)) await chrome.tabs.remove(tab.id).catch(() => {});
  }
  const { knownLockWindows = [] } = await chrome.storage.local.get("knownLockWindows");
  for (const { id, session } of knownLockWindows) {
    if (id === guardId || session !== await browserSession()) continue;
    // Only ever a lone popup like the ones made here, never a browsing window.
    const w = await chrome.windows.get(id, { populate: true }).catch(() => null);
    if (w?.type === "popup" && w.tabs?.length === 1) await chrome.windows.remove(id).catch(() => {});
  }
  await chrome.storage.local.set({
    knownLockWindows: guardId === undefined ? [] : [{ id: guardId, session: await browserSession() }],
  });
}

// Window ids mean nothing after Chrome restarts, so remember which run they
// belong to. A reload keeps the run; a restart begins a new one.
async function browserSession() {
  const { run } = await chrome.storage.local.get("run");
  if (run) return run;
  return newBrowserSession();
}

async function newBrowserSession() {
  const run = crypto.randomUUID();
  await chrome.storage.local.set({ run });
  return run;
}

const lockNow = () => inTurn(async () => {
  if (!await getLock() || await isLocked()) return;
  const open = await chrome.windows.getAll();
  const focused = open.find((w) => w.focused)?.id;
  await chrome.storage.session.set({
    frame: frameOf(open),
    restore: open.filter((w) => w.state !== "minimized").map((w) => ({ id: w.id, state: w.state, focused: w.id === focused })),
  });
  await chrome.storage.local.set({ locked: true });
  await closeSites();
  await enforce();
});

// The lock takes the place of the browser window: same spot, same size.
function frameOf(windows) {
  const usable = windows.filter((w) => w.state !== "minimized");
  const main = usable.find((w) => w.focused && w.type === "normal") ?? usable.find((w) => w.type === "normal") ?? usable[0];
  if (!main) return null;
  if (main.state !== "normal") return { state: "maximized" };
  const { left, top, width, height } = main;
  return { left, top, width: Math.max(width, 380), height: Math.max(height, 480) };
}

async function openGuard() {
  const { frame } = await chrome.storage.session.get("frame");
  const place = frame ?? frameOf(await chrome.windows.getAll()) ?? { state: "maximized" };
  const base = { url: LOCK_PAGE, type: "popup", focused: true };
  let guard;
  try {
    guard = await chrome.windows.create({ ...base, ...place });
  } catch {
    return chrome.windows.create(base);      // off-screen bounds, for example
  }
  // Chrome does not always honour these while creating a popup.
  const fits = place.state ? guard.state === place.state : guard.width === place.width && guard.height === place.height;
  if (!fits) await chrome.windows.update(guard.id, place).catch(() => {});
  return guard;
}

// Put the lock window up and everything else away. Must run inside inTurn.
async function enforce() {
  if (!await isLocked()) return;
  let guard = await lockWindow();
  if (!guard) {
    try {
      guard = await openGuard();
      await chrome.storage.session.set({ lockWindowId: guard.id });
    } catch (error) {
      // Never hide windows without a way to unlock them.
      console.error("Limbo could not show the lock:", error);
      await chrome.storage.local.set({ locked: false });
      return;
    }
  }
  await closeStrays(guard.id);
  for (const w of await chrome.windows.getAll()) {
    if (w.id === guard.id || w.state === "minimized") continue;
    await chrome.windows.update(w.id, { state: "minimized" }).catch(() => {});
  }
  const now = await chrome.windows.get(guard.id).catch(() => null);
  if (now?.state === "minimized") {
    const { frame } = await chrome.storage.session.get("frame");
    await chrome.windows.update(guard.id, { state: frame?.state ?? "normal" }).catch(() => {});
  }
  await chrome.windows.update(guard.id, { focused: true }).catch(() => {});
}

const unlock = (secret) => inTurn(async () => {
  const result = await tryPasscode(secret);
  if (!result.ok) return result;
  await chrome.storage.local.set({ locked: false });
  if (result.recovery) await chrome.storage.local.remove("lock");
  // From here the windows come back whatever happens to the lock page.
  setTimeout(reveal, result.recovery ? 2200 : 250);
  return result;
});

const reveal = () => inTurn(async () => {
  if (await isLocked()) return;
  const { restore = [] } = await chrome.storage.session.get("restore");
  const guard = await lockWindow();
  await chrome.storage.session.remove(["restore", "lockWindowId", "frame"]);
  const open = new Set((await chrome.windows.getAll()).map((w) => w.id));
  let targets = restore.filter((w) => open.has(w.id));
  if (!targets.length) {
    targets = [...open].filter((id) => id !== guard?.id).map((id) => ({ id, state: "normal" }));
  }
  targets.sort((a, b) => (a.focused ? 1 : 0) - (b.focused ? 1 : 0));
  for (const w of targets) await chrome.windows.update(w.id, { state: w.state }).catch(() => {});
  if (targets.length) await chrome.windows.update(targets.at(-1).id, { focused: true }).catch(() => {});
  if (guard) await chrome.windows.remove(guard.id).catch(() => {});
  await closeStrays();
});

const enforceIfLocked = () => inTurn(enforce);

chrome.windows.onCreated.addListener(enforceIfLocked);
chrome.windows.onFocusChanged.addListener((id) => {
  if (id === chrome.windows.WINDOW_ID_NONE) return;
  inTurn(async () => {
    if (!await isLocked()) return;
    const guard = await lockWindow();
    if (guard?.id !== id) await enforce();
  });
});
chrome.windows.onRemoved.addListener(() => inTurn(async () => {
  // Closing the lock doesn't open anything, unless Chrome itself is quitting.
  if (!await isLocked() || await lockWindow()) return;
  if ((await chrome.windows.getAll()).length) await enforce();
}));

// ---------- Locking on its own ----------
async function watchIdle() {
  const lock = await getLock();
  if (lock?.idle) chrome.idle.setDetectionInterval(lock.idle * 60);
}

chrome.idle.onStateChanged.addListener(async (state) => {
  const lock = await getLock();
  if (lock?.idle && state !== "active") lockNow();
});

async function lockOnStartup() {
  await inTurn(newBrowserSession);
  const lock = await getLock();
  if (!lock) return;
  if (await isLocked()) await enforceIfLocked(); // quitting Chrome is no way out
  else if (lock.onStart) await lockNow();
}

// 2.3.1 briefly turned this off for everyone; put it back.
const restoreStart = (previousVersion) => inTurn(async () => {
  const lock = await getLock();
  if (lock && previousVersion === "2.3.1") await setLock({ ...lock, onStart: true });
});

// ---------- Settings page ----------
const lockSettings = {
  async info() {
    const lock = await getLock();
    return { set: !!lock, onStart: !!lock?.onStart, idle: lock?.idle ?? 0 };
  },
  async create({ passcode }) {
    if (await getLock()) return { ok: false };
    if (typeof passcode !== "string" || passcode.length < MIN_PASSCODE || passcode.length > 200) return { ok: false };
    const code = makeRecoveryCode();
    await setLock({
      passcode: await sealSecret(passcode),
      recovery: await sealSecret(tidyCode(code)),
      onStart: true, idle: 0, fails: 0, until: 0,
    });
    return { ok: true, code };
  },
  async change({ onStart, idle }) {
    const lock = await getLock();
    if (!lock) return { ok: false };
    await setLock({ ...lock, onStart: !!onStart, idle: IDLE_MINUTES.includes(idle) ? idle : 0 });
    await watchIdle();
    return { ok: true };
  },
  async rekey({ passcode, next }) {
    if (typeof next !== "string" || next.length < MIN_PASSCODE || next.length > 200) return { ok: false, short: true };
    const result = await tryPasscode(passcode);
    const lock = await getLock();
    if (result.ok && lock) await setLock({ ...lock, passcode: await sealSecret(next) });
    return result;
  },
  async remove({ passcode }) {
    const result = await tryPasscode(passcode);
    if (result.ok) {
      await chrome.storage.local.remove(["lock", "locked"]);
      releaseTabs();
    }
    return result;
  },
};

function handleLockMessage(message, sender, reply) {
  const from = (page) => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(page);
  if (from(LOCK_PAGE)) {
    if (message.type === "lock:unlock") unlock(message.passcode).then(reply);
    else return false;
    return true;
  }
  if (from(TAB_PAGE) && sender.tab) {
    if (message.type === "lock:tab-info") tabInfo(sender.tab, message.host).then(reply);
    else if (message.type === "lock:tab-open") openTab(sender.tab, message.host, message.passcode).then(reply);
    else return false;
    return true;
  }
  if (!from("ui/options.html")) return false;
  if (message.type === "lock:now") {
    lockNow().then(isLocked).then((locked) => reply({ ok: true, locked }));
    return true;
  }
  const action = message.type.slice("lock:".length);
  const actions = { ...lockSettings, ...siteSettings };
  if (!Object.hasOwn(actions, action)) return false;
  inTurn(() => actions[action](message)).then(reply, () => reply({ ok: false }));
  return true;
}

watchIdle();
