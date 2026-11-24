importScripts("settings.js", "lock.js", "tablock.js");

const t = (key, ...parts) => chrome.i18n.getMessage(key, parts.map(String)) || key;

const BADGE_MS = 2000;
const FAILSAFE_MS = 5000;   // call it off if the animation never shows up
const FORGET_MS = 60000;
const GOOGLE_DELAY_MS = 4200; // let the animation finish before opening Google
const ASSETS = { body: "ui/body.webp", eyes: "ui/eyes.webp", font: "ui/fonts/PirataOne-Regular.ttf" };
const BLOOD_MOON = 0.1;     // how often the rare variant appears, once grown

// Content scripts run inside web pages; keep them away from the settings.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

// ---------- Triggers ----------
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await chrome.contextMenus.removeAll();
  const contexts = ["action"];
  chrome.contextMenus.create({ id: "erase", title: t("menuErase"), contexts });
  for (const [id, range] of Object.entries(RANGES)) {
    chrome.contextMenus.create({ id, parentId: "erase", title: t(range.label), contexts });
  }
  chrome.contextMenus.create({ id: "google", title: t("menuGoogle"), contexts });
  chrome.contextMenus.create({ id: "lock", title: t("menuLock"), contexts });
  chrome.contextMenus.create({ id: "lock-tab", title: t("menuLockTab"), contexts: ["action", "page"] });
  chrome.contextMenus.create({ id: "lock-site", title: t("menuLockSite"), contexts: ["action", "page"] });
  chrome.contextMenus.create({ id: "settings", title: t("menuSettings"), contexts });

  if (reason === "update") await restoreStart(previousVersion);
  if (await isLocked()) enforceIfLocked();
  else if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("ui/welcome.html") });
});

chrome.runtime.onStartup.addListener(autoErase);
chrome.runtime.onStartup.addListener(lockOnStartup);

// Also fires for the keyboard shortcut.
chrome.action.onClicked.addListener(async (tab) => {
  if (await isLocked()) return;
  // A second click while there is still time means "no, wait".
  if (current?.state === "pending") spare(current);
  else summon(null, tab);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "lock-site") {
    // Chrome only shows its permission question if asked right away.
    const host = tidyHost(tab?.url ?? info.pageUrl ?? "");
    const asked = host && chrome.permissions.request({ origins: siteOrigins(host) }).catch(() => null);
    return requestSiteLock(host, await asked);
  }
  if (await isLocked()) return;
  if (info.menuItemId === "lock") requestLock();
  if (info.menuItemId === "lock-tab") requestTabLock(tab);
  if (info.menuItemId === "settings") chrome.runtime.openOptionsPage();
  if (info.menuItemId === "google") chrome.tabs.create({ url: GOOGLE_PAGES.searches });
  if (!Object.hasOwn(RANGES, info.menuItemId)) return;
  if (current?.state === "pending") spare(current);
  summon(info.menuItemId, tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (await isLocked()) return;
  if (command === "lock-browser") requestLock();
  if (command === "lock-tab") requestTabLock(tab);
});

async function requestTabLock(tab) {
  if (!await getLock()) openLockSettings();
  else if (!await lockTab(tab)) showBadge("!", "#d93025");
}

// Locks every tab of the site at once. allowed: true, false, or null when
// Chrome could not ask here; then the settings page does.
async function requestSiteLock(host, allowed) {
  if (await isLocked()) return;
  if (!host || allowed === null || !await getLock()) return openLockSettings(host);
  const reply = allowed && await inTurn(() => siteSettings.addSite({ host }));
  if (!reply?.ok) showBadge("!", "#d93025");
}

// Opens the Limbo Lock settings, with a site filled in if one was chosen.
function openLockSettings(host) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`ui/options.html#lock${host ? `=${host}` : ""}`) });
}

// Without a passcode there is nothing to lock with yet, so go and set one.
async function requestLock() {
  if (await getLock()) lockNow();
  else openLockSettings();
}

// ---------- Jobs ----------
// A job is pending until its undo time ends; then it erases. Only the triggers
// above can create a real one. The UI can merely start its clock or spare it,
// and a job whose clock never starts is called off.
const jobs = new Map();
let current = null;

// rangeId null means "whatever a click is set to erase".
function createJob(rangeId, preview = false) {
  const job = { id: crypto.randomUUID(), state: "pending", begun: false, preview };
  job.plan = loadState().then(({ settings, fed }) => {
    const id = rangeId ?? settings.range;
    return { settings, fed, rangeId: id, since: RANGES[id].since() };
  });
  job.done = new Promise((resolve) => { job.resolve = resolve; });
  job.done.then(() => setTimeout(() => jobs.delete(job.id), FORGET_MS));
  job.timer = setTimeout(lapse, FAILSAFE_MS, job);
  jobs.set(job.id, job);
  current = job;
  return job;
}

async function begin(job) {
  if (job.begun || job.state !== "pending") return;
  job.begun = true;
  clearTimeout(job.timer);
  const { settings } = await job.plan;
  if (job.state === "pending") job.timer = setTimeout(commit, settings.undo * 1000, job);
}

function spare(job) {
  if (job.state !== "pending") return false;
  clearTimeout(job.timer);
  job.state = "spared";
  job.resolve({ status: "spared" });
  if (!job.preview) showBadge("↺", "#5f6368");
  return true;
}

// Nobody saw it, so nobody could undo it: erase nothing.
function lapse(job) {
  if (!spare(job)) return;
  console.warn("Limbo could not show itself, so nothing was erased.");
  if (!job.preview) showBadge("!", "#d93025");
}

async function commit(job) {
  if (job.state !== "pending") return;
  job.state = "erasing";
  let grew = null;
  if (job.preview) {
    job.state = "ok";
  } else {
    try {
      const plan = await job.plan;
      await erase(plan.since, plan.settings);
      job.state = "ok";
      grew = await feed();
      showBadge("✓", "#1f9d55");
      if (plan.settings.googleAfter) setTimeout(openGoogle, GOOGLE_DELAY_MS);
    } catch (error) {
      // For example when a Chrome policy forbids deleting history.
      console.error("Limbo could not erase:", error);
      job.state = "fail";
      showBadge("!", "#d93025");
    }
  }
  job.resolve({ status: job.state, grew });
}

async function openGoogle() {
  if (!await isLocked()) chrome.tabs.create({ url: GOOGLE_PAGES.searches });
}

function erase(since, settings) {
  const types = { history: true };
  if (settings.cache) types.cache = true;
  if (settings.downloads) types.downloads = true;
  if (settings.cookies) {
    Object.assign(types, {
      cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true,
    });
  }
  return chrome.browsingData.remove({ since }, types);
}

// Counts a meal. Returns the new level's name if Limbo just grew.
async function feed() {
  try {
    const { fed } = await loadState();
    await chrome.storage.local.set({ fed: fed + 1 });
    const level = levelOf(fed + 1);
    return level > levelOf(fed) ? LEVELS[level].name : null;
  } catch {
    return null; // the erase itself worked; that is what matters
  }
}

async function autoErase() {
  const { settings } = await loadState();
  if (!settings.autoErase) return;
  try {
    await erase(RANGES[settings.autoRange].since(), settings);
    showBadge("✓", "#1f9d55");
  } catch (error) {
    console.error("Limbo could not erase on startup:", error);
    showBadge("!", "#d93025");
  }
}

// ---------- Showing Limbo ----------
async function summon(rangeId, tab) {
  const job = createJob(rangeId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["ui/shader.js", "ui/limbo.js"],
    });
  } catch {
    // Chrome's own pages (New Tab, Settings, Web Store) can't be drawn on.
    if (!await openFallbackPopup(tab)) lapse(job);
  }
}

async function openFallbackPopup(tab) {
  try {
    await chrome.action.setPopup({ tabId: tab.id, popup: "ui/popup.html" });
    await chrome.action.openPopup({ windowId: tab.windowId });
    return true;
  } catch {
    return false;
  } finally {
    await chrome.action.setPopup({ tabId: tab.id, popup: "" }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type?.startsWith?.("lock:")) return handleLockMessage(message, sender, sendResponse);
  const trusted = ["ui/options.html", "ui/welcome.html"].some(
    (page) => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(page));
  if (message?.type === "limbo:preview" && trusted) {
    if (current?.state === "pending") return;
    createJob(null, true);
    sendResponse(true);
    return;
  }
  if (message?.type === "limbo:open") {
    open(sender.tab?.id, trusted, message.idle === true).then(sendResponse);
    return true;
  }
  if (message?.type === "limbo:settings") chrome.runtime.openOptionsPage();
  const job = jobs.get(message?.id);
  if (message?.type === "limbo:begin" && job) begin(job);
  if (message?.type === "limbo:spare") sendResponse({ spared: !!job && spare(job) });
  if (message?.type === "limbo:result") {
    Promise.resolve(job?.done ?? { status: "fail" }).then(sendResponse);
    return true;
  }
});

// Assets travel by message so that nothing has to be exposed to websites.
async function open(tabId, isOptions, idle) {
  const job = idle ? null : current; // a portrait belongs to no job
  const { settings, fed, rangeId } = job ? await job.plan : { ...await loadState(), rangeId: "all" };
  const entries = await Promise.all(Object.entries(ASSETS).map(async ([name, path]) => {
    const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(path))).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return [name, btoa(binary)];
  }));
  if (settings.sound) await ensureSpeaker();
  const zoom = tabId && !isOptions ? await chrome.tabs.getZoom(tabId).catch(() => 1) : 1;
  const level = levelOf(fed);
  return {
    ...Object.fromEntries(entries),
    zoom, level,
    id: job?.id,
    done: doneText(job, rangeId, settings),
    graceMs: settings.undo * 1000,
    corner: settings.corner,
    scale: SIZES[settings.size],
    volume: settings.sound ? settings.volume / 100 : 0,
    blood: level > 0 && Math.random() < BLOOD_MOON,
  };
}

function doneText(job, rangeId, settings) {
  if (job?.preview) return t("donePreview");
  if (settings.cache || settings.downloads || settings.cookies) return t("doneMore");
  return rangeId === "all" ? t("doneAll") : t("doneRange", t(RANGES[rangeId].label));
}

// Web pages may not be allowed to play sound, so an offscreen page does it.
async function ensureSpeaker() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: "ui/speaker.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Plays the sound effects of the erase animation.",
    });
  } catch (error) {
    console.warn("Limbo has no sound:", error);
  }
}

async function showBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), BADGE_MS);
}
