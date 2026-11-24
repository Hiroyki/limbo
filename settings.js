"use strict";

// Shared by background.js and the pages. Labels are message names.
const DAY = 24 * 60 * 60 * 1000;

const RANGES = {
  all: { label: "rangeAll", since: () => 0 },
  hour: { label: "rangeHour", since: () => Date.now() - DAY / 24 },
  today: { label: "rangeToday", since: () => new Date().setHours(0, 0, 0, 0) },
  week: { label: "rangeWeek", since: () => Date.now() - 7 * DAY },
};

const CORNERS = ["tl", "tr", "center", "bl", "br"];
const SIZES = { small: 0.8, medium: 1, large: 1.3 };
const UNDO_SECONDS = [2, 3, 5, 10];

const DEFAULTS = {
  range: "all",
  undo: 3,
  cache: false,
  downloads: false,
  cookies: false,
  googleAfter: false,
  autoErase: false,
  autoRange: "all",
  corner: "tr",
  size: "medium",
  sound: false,
  volume: 60,
};

// Searches saved in the Google account live on Google's servers, and Google
// offers no way for an extension to delete them. These are its own pages.
const GOOGLE_PAGES = {
  searches: "https://myactivity.google.com/product/search",
  controls: "https://myactivity.google.com/activitycontrols",
};

// "https://www.Example.com/x" and "example.com" both become "example.com".
function tidyHost(text) {
  try {
    const raw = String(text).trim();
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host.includes(".") || host === "localhost" ? host : null;
  } catch {
    return null;
  }
}

const siteOrigins = (host) => [`*://${host}/*`, `*://*.${host}/*`];

const SITE_MINUTES = [0, 5, 15, 60];         // 0: until Chrome closes

// Limbo grows the more it is fed.
const LEVELS = [
  { at: 0, name: "Whisper" },
  { at: 5, name: "Ember" },
  { at: 15, name: "Wraith" },
  { at: 40, name: "Inferno" },
  { at: 100, name: "Abyss" },
];

const levelOf = (fed) => LEVELS.findLastIndex((level) => fed >= level.at);

// Never trust what is in storage: anything unexpected becomes the default.
function sanitize(raw) {
  const s = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw?.[key];
    if (typeof value === typeof fallback) s[key] = value;
  }
  if (!Object.hasOwn(RANGES, s.range)) s.range = DEFAULTS.range;
  if (!Object.hasOwn(RANGES, s.autoRange)) s.autoRange = DEFAULTS.autoRange;
  if (!CORNERS.includes(s.corner)) s.corner = DEFAULTS.corner;
  if (!Object.hasOwn(SIZES, s.size)) s.size = DEFAULTS.size;
  if (!UNDO_SECONDS.includes(s.undo)) s.undo = DEFAULTS.undo;
  s.volume = Math.min(100, Math.max(0, s.volume || 0));
  return s;
}

async function loadState() {
  const { settings, fed } = await chrome.storage.local.get(["settings", "fed"]);
  return { settings: sanitize(settings), fed: Number.isInteger(fed) && fed > 0 ? fed : 0 };
}
