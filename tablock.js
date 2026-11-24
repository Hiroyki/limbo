"use strict";

// Locks for single tabs and for whole sites, behind the same passcode as the
// browser lock. A locked tab is sent to TAB_PAGE; its real address is kept in
// memory only, and unlocking sends it back.
const TAB_PAGE = "ui/tab-lock.html";
const tabPageUrl = (hash = "") => chrome.runtime.getURL(TAB_PAGE) + hash;
const isTabPage = (url) => (url ?? "").split(/[?#]/)[0] === tabPageUrl();

let tabQueue = Promise.resolve();
function tabTurn(task) {
  const run = tabQueue.then(task);
  tabQueue = run.catch(() => {});
  return run;
}

// { [tabId]: { url, settled, moved, host } } for tabs that are locked now.
async function getTabs() {
  return (await chrome.storage.session.get("lockedTabs")).lockedTabs ?? {};
}
const setTabs = (lockedTabs) => chrome.storage.session.set({ lockedTabs });

// ---------- One tab ----------
// Returns false if this tab can't be locked.
const lockTab = (tab) => tabTurn(async () => {
  if (!tab?.id || tab.incognito || !await getLock()) return false;
  if (isTabPage(tab.url ?? tab.pendingUrl)) return true;
  const tabs = await getTabs();
  tabs[tab.id] = { url: tab.url ?? null, settled: false, moved: false, host: null };
  await setTabs(tabs);
  try {
    await chrome.tabs.update(tab.id, { url: tabPageUrl() });
    return true;
  } catch {
    delete tabs[tab.id];
    await setTabs(tabs);
    return false;
  }
});

// A locked tab that wanders off (Back, or a new address) is brought back.
async function guardTab(tabId, tab) {
  const tabs = await getTabs();
  const entry = tabs[tabId];
  if (!entry || entry.host) return;
  if (isTabPage(tab.url) || isTabPage(tab.pendingUrl)) {
    if (!entry.settled && isTabPage(tab.url)) {
      entry.settled = true;
      await setTabs(tabs);
    }
    return;
  }
  if (!entry.settled) return;                // still on its way to the lock
  entry.moved = true;
  entry.settled = false;
  await setTabs(tabs);
  await chrome.tabs.update(tabId, { url: tabPageUrl() }).catch(() => {});
}

// ---------- Sites ----------
async function getSites() {
  const { lockedSites = [], siteMinutes = 0 } = await chrome.storage.local.get(["lockedSites", "siteMinutes"]);
  return {
    hosts: Array.isArray(lockedSites) ? lockedSites.filter((h) => typeof h === "string") : [],
    minutes: SITE_MINUTES.includes(siteMinutes) ? siteMinutes : 0,
  };
}

function matchSite(url, hosts) {
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  return hosts.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

async function siteIsOpen(host, minutes) {
  const { openSites = {} } = await chrome.storage.session.get("openSites");
  const since = openSites[host];
  return !!since && (minutes === 0 || Date.now() - since < minutes * 60000);
}

async function guardSite(tabId, tab) {
  if (!tab.url || tab.incognito || !await getLock()) return;
  const { hosts, minutes } = await getSites();
  const host = matchSite(tab.url, hosts);
  if (!host || await siteIsOpen(host, minutes)) return;
  const tabs = await getTabs();
  if (tabs[tabId] && !tabs[tabId].host) return; // already locked on its own
  tabs[tabId] = { url: tab.url, settled: true, moved: false, host };
  await setTabs(tabs);
  await chrome.tabs.update(tabId, { url: tabPageUrl(`#${host}`) }).catch(() => {});
}

// Look at every open tab, for when a site is added or its time runs out.
const sweepSites = () => tabTurn(async () => {
  const { hosts } = await getSites();
  if (!hosts.length) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) await guardSite(tab.id, tab);
});

const closeSites = () => chrome.storage.session.remove("openSites");

// ---------- Watching tabs ----------
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.status && !change.url) return;
  tabTurn(async () => {
    await guardTab(tabId, tab);
    await guardSite(tabId, tab);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => tabTurn(async () => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) await guardSite(tabId, tab);
}));

chrome.tabs.onRemoved.addListener((tabId) => tabTurn(async () => {
  const tabs = await getTabs();
  if (!tabs[tabId]) return;
  delete tabs[tabId];
  await setTabs(tabs);
}));

// ---------- The lock page inside a tab ----------
// A copied or restored lock page has no entry yet; from now on it is guarded.
const tabInfo = (tab, hash) => tabTurn(async () => {
  const host = await knownHost(hash);
  const tabs = await getTabs();
  if (!tabs[tab.id] && !host) {
    tabs[tab.id] = { url: null, settled: true, moved: false, host: null };
    await setTabs(tabs);
  }
  return { host: tabs[tab.id] ? tabs[tab.id].host : host };
});

const knownHost = async (text) => ((await getSites()).hosts.includes(text) ? text : null);

async function openTab(tab, hash, secret) {
  const hostInPage = await knownHost(hash);
  const result = await inTurn(() => tryPasscode(secret));
  if (!result.ok) return result;
  if (result.recovery) await chrome.storage.local.remove(["lock", "locked"]);
  await tabTurn(async () => {
    const tabs = await getTabs();
    const entry = tabs[tab.id];
    delete tabs[tab.id];
    await setTabs(tabs);
    const host = entry ? entry.host : hostInPage;
    if (host) {
      const { openSites = {} } = await chrome.storage.session.get("openSites");
      await chrome.storage.session.set({ openSites: { ...openSites, [host]: Date.now() } });
      await openOthers(host, tab.id);
    }
    // The lock page steps back itself, which keeps the page as it was. Chrome's
    // own goBack would skip pages that were never clicked.
    result.back = !entry?.moved;
    if (result.back) setTimeout(() => sendBack(tab.id, entry, host), 1500);
    else setTimeout(() => sendBack(tab.id, entry, host), 350);
  });
  return result;
}

// One passcode opens every tab of the site.
async function openOthers(host, exceptId) {
  const tabs = await getTabs();
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === exceptId || tab.url !== tabPageUrl(`#${host}`)) continue;
    const entry = tabs[tab.id];
    delete tabs[tab.id];
    setTimeout(() => sendBack(tab.id, entry, host), 1500);
  }
  await setTabs(tabs);
  chrome.runtime.sendMessage({ type: "lock:site-open", host }).catch(() => {});
}

// Loads the real address if the tab is still showing the lock.
async function sendBack(tabId, entry, host) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isTabPage(tab.url)) return;
  const url = entry?.url ?? (host ? `https://${host}/` : null);
  if (url) await chrome.tabs.update(tabId, { url }).catch(() => {});
  else await chrome.tabs.goBack(tabId).catch(() => chrome.tabs.remove(tabId).catch(() => {}));
}

// When the lock is turned off, nothing stays behind it.
const releaseTabs = () => tabTurn(async () => {
  const tabs = await getTabs();
  await setTabs({});
  for (const [id, entry] of Object.entries(tabs)) await sendBack(Number(id), entry, entry.host);
});

// ---------- Settings page ----------
const siteSettings = {
  async sites() {
    const { hosts, minutes } = await getSites();
    const list = [];
    for (const host of hosts) {
      list.push({ host, allowed: await chrome.permissions.contains({ origins: siteOrigins(host) }) });
    }
    return { list, minutes };
  },
  async addSite({ host }) {
    const clean = tidyHost(host);
    if (!clean || !await getLock()) return { ok: false };
    const { hosts } = await getSites();
    const listed = hosts.find((h) => clean === h || clean.endsWith(`.${h}`));
    if (!listed) await chrome.storage.local.set({ lockedSites: [...hosts, clean].sort() });
    // Locking a site that was opened earlier closes it again, in every tab.
    const { openSites = {} } = await chrome.storage.session.get("openSites");
    delete openSites[listed ?? clean];
    await chrome.storage.session.set({ openSites });
    sweepSites();
    return { ok: true };
  },
  async removeSite({ host, passcode }) {
    const result = await tryPasscode(passcode);
    if (!result.ok) return result;
    const { hosts } = await getSites();
    await chrome.storage.local.set({ lockedSites: hosts.filter((h) => h !== host) });
    await chrome.permissions.remove({ origins: siteOrigins(host) }).catch(() => {});
    return { ok: true };
  },
  async siteMinutes({ minutes }) {
    await chrome.storage.local.set({ siteMinutes: SITE_MINUTES.includes(minutes) ? minutes : 0 });
    return { ok: true };
  },
};

chrome.permissions.onAdded.addListener(sweepSites);
