"use strict";

const $ = (id) => document.getElementById(id);
const form = $("form");
const portrait = createPortrait($("hero"));
let fed = 0;

// ---------- Building the choices ----------
const ranges = Object.entries(RANGES).map(([value, r]) => [value, t(r.label)]);
const CHOICES = {
  range: ranges,
  autoRange: ranges,
  undo: UNDO_SECONDS.map((n) => [n, t("seconds", n)]),
  size: Object.keys(SIZES).map((value) => [value, t(value)]),
  corner: CORNERS.map((value) => [value, t(value)]),
};

for (const box of document.querySelectorAll("[data-radios]")) {
  const name = box.dataset.radios;
  for (const [value, text] of CHOICES[name]) {
    const label = document.createElement("label");
    const input = Object.assign(document.createElement("input"), { type: "radio", name, value });
    const span = document.createElement("span");
    if (name === "corner") {
      label.className = value;
      label.title = text;
      const hidden = document.createElement("b");
      hidden.textContent = text;
      span.append(hidden);
    } else {
      span.textContent = text;
    }
    label.append(input, span);
    box.append(label);
  }
}

// ---------- Loading and saving ----------
function reflect(settings) {
  $("autoRange").disabled = !settings.autoErase;
  form.elements.volume.disabled = !settings.sound;
  $("volume").classList.toggle("off", !settings.sound);
}

function show(settings) {
  for (const [name, value] of Object.entries(settings)) {
    const field = form.elements[name];
    if (typeof value === "boolean") field.checked = value;
    else field.value = String(value);
  }
  reflect(settings);
}

function read() {
  const raw = {};
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    const field = form.elements[name];
    if (typeof fallback === "boolean") raw[name] = field.checked;
    else if (typeof fallback === "number") raw[name] = Number(field.value);
    else raw[name] = field.value;
  }
  return sanitize(raw);
}

let savedTimer = 0;
form.addEventListener("change", async () => {
  const settings = read();
  reflect(settings);
  let text = t("saved");
  try {
    await chrome.storage.local.set({ settings });
  } catch {
    text = t("notSaved");
  }
  $("saved").textContent = text;
  $("saved").classList.add("on");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    $("saved").classList.remove("on");
    $("saved").textContent = "";
  }, 1500);
});
form.addEventListener("submit", (e) => e.preventDefault());

// ---------- Growth ----------
function showGrowth() {
  const index = levelOf(fed), level = LEVELS[index], next = LEVELS[index + 1];
  $("level").textContent = level.name;
  $("meals").textContent = next ? t("meals", fed, next.at - fed, next.name) : t("mealsFull", fed);
  const percent = next ? Math.round(((fed - level.at) / (next.at - level.at)) * 100) : 100;
  $("progress").setAttribute("aria-valuenow", percent);
  $("progress").firstElementChild.style.width = `${percent}%`;
}

chrome.storage.onChanged.addListener((changes) => {
  if (!changes.fed) return;
  const before = levelOf(fed);
  fed = changes.fed.newValue ?? 0;
  showGrowth();
  if (before !== levelOf(fed)) portrait.show();
});

$("preview").addEventListener("click", async () => {
  $("preview").disabled = true;
  if (matchMedia("(max-width: 860px)").matches) $("hero").scrollIntoView({ block: "center" });
  await portrait.preview();
  $("preview").disabled = false;
});

// ---------- Tabs ----------
const tabs = [...document.querySelectorAll("[role=tab]")];

function showTab(name) {
  for (const tab of tabs) {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute("aria-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
}

const tabInUrl = () => (/^#lock(=|$)/.test(location.hash) ? "lock" : "limbo");
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    history.replaceState(null, "", tab.id === "tab-lock" ? "#lock" : "#");
    showTab(tabInUrl());
    scrollTo(0, 0);
  });
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const other = tabs.find((x) => x !== tab);
    other.click();
    other.focus();
  });
}
addEventListener("hashchange", () => showTab(tabInUrl()));
showTab(tabInUrl());

// ---------- Google ----------
for (const button of document.querySelectorAll("[data-google]")) {
  button.addEventListener("click", () => chrome.tabs.create({ url: GOOGLE_PAGES[button.dataset.google] }));
}

// ---------- Shortcut ----------
async function showShortcut() {
  const commands = await chrome.commands.getAll();
  for (const box of document.querySelectorAll("[data-key]")) {
    box.textContent = commands.find((c) => c.name === box.dataset.key)?.shortcut || t("notSet");
  }
}
for (const button of document.querySelectorAll("[data-rebind]")) {
  button.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
}
addEventListener("focus", showShortcut);

$("version").textContent = `Limbo ${chrome.runtime.getManifest().version}`;

loadState().then((state) => {
  fed = state.fed;
  show(state.settings);
  showGrowth();
  showShortcut();
  portrait.show();
});
