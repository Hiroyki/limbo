"use strict";

// The Limbo Lock tab. Shares $, t and portrait with options.js.
const ask = (type, more) => chrome.runtime.sendMessage({ type: `lock:${type}`, ...more }).catch(() => null);

function note(id, text, bad = false) {
  $(id).textContent = text;
  $(id).classList.toggle("bad", bad);
}
const lockNote = (text, bad) => note("lock-note", text, bad);

const refusal = (reply) => (reply?.waitMs > 0 ? t("tooMany", Math.ceil(reply.waitMs / 1000)) : t("wrongShort"));

// ---------- Lock ----------
for (const minutes of [0, 5, 15, 30]) {
  const label = document.createElement("label");
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "lock-idle", value: minutes });
  const span = document.createElement("span");
  span.textContent = minutes ? t("minutes", minutes) : t("never");
  label.append(input, span);
  $("lock-idle").append(label);
}

async function showLock() {
  const info = await ask("info");
  $("lock-create").hidden = !info || info.set;
  $("lock-on").hidden = !info?.set;
  for (const part of document.querySelectorAll("[data-when-set]")) part.hidden = !info?.set;
  $("lock-code").hidden = true;
  $("guard").textContent = info?.set ? t("isOn") : t("isOff");
  if (!info) return lockNote(t("unavailable"), true);
  $("lock-start").checked = info.onStart;
  document.querySelector(`[name="lock-idle"][value="${info.idle}"]`).checked = true;
}

// Limbo looks away while any passcode is typed.
for (const field of document.querySelectorAll("input[type=password]")) {
  const look = () => {
    if (portrait.mood) portrait.mood.shy = document.activeElement === field && field.value.length > 0;
  };
  for (const type of ["input", "focus", "blur"]) field.addEventListener(type, look);
}

$("lock-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const passcode = $("new-passcode").value;
  if (passcode !== $("repeat-passcode").value) return lockNote(t("mismatch"), true);
  const reply = await ask("create", { passcode });
  if (!reply?.ok) return lockNote(t("tooShort"), true);
  e.target.reset();
  lockNote("");
  $("code").textContent = reply.code;
  $("lock-create").hidden = true;
  $("lock-code").hidden = false;
});

$("copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("code").textContent);
    lockNote(t("copied"));
  } catch {
    lockNote(t("notCopied"), true);
  }
});

$("code-saved").addEventListener("click", () => {
  $("code").textContent = "";
  lockNote(t("nowOn"));
  showLock().then(showSites).then(prefillSite);
});

$("lock-now").addEventListener("click", async () => {
  const reply = await ask("now");
  if (!reply?.locked) lockNote(t("unavailable"), true);
});

$("lock-on").addEventListener("change", async (e) => {
  if (e.target.id !== "lock-start" && e.target.name !== "lock-idle") return;
  const idle = Number(document.querySelector('[name="lock-idle"]:checked').value);
  const reply = await ask("change", { onStart: $("lock-start").checked, idle });
  lockNote(reply?.ok ? t("saved") : t("notSaved"), !reply?.ok);
});

$("lock-remove").addEventListener("submit", async (e) => {
  e.preventDefault();
  const reply = await ask("remove", { passcode: $("old-passcode").value });
  e.target.reset();
  if (reply?.ok) {
    note("remove-note", "");
    lockNote(t("nowOff"));
    await showLock();
    scrollTo(0, 0);
  } else {
    note("remove-note", refusal(reply), true);
  }
});

$("lock-rekey").addEventListener("submit", async (e) => {
  e.preventDefault();
  const next = $("rekey-new").value;
  if (next !== $("rekey-repeat").value) return note("rekey-note", t("mismatch"), true);
  const reply = await ask("rekey", { passcode: $("rekey-old").value, next });
  e.target.reset();
  if (portrait.mood) portrait.mood.shy = false;
  if (reply?.ok) note("rekey-note", t("rekeyed"));
  else note("rekey-note", reply?.short ? t("tooShort") : refusal(reply), true);
});

// ---------- Sites ----------
for (const minutes of SITE_MINUTES) {
  const label = document.createElement("label");
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "site-minutes", value: minutes });
  const span = document.createElement("span");
  span.textContent = minutes ? t("minutes", minutes) : t("siteUntilClose");
  label.append(input, span);
  $("site-minutes").append(label);
}

const button = (text, onClick) => {
  const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  b.addEventListener("click", onClick);
  return b;
};

async function showSites() {
  const reply = await ask("sites");
  if (!reply) return;
  document.querySelector(`[name="site-minutes"][value="${reply.minutes}"]`).checked = true;
  $("site-list").replaceChildren(...reply.list.map(({ host, allowed }) => {
    const row = document.createElement("li");
    const line = Object.assign(document.createElement("div"), { className: "site" });
    const name = document.createElement("span");
    name.textContent = host;
    line.append(name);
    // Chrome can take the permission away at any time.
    if (!allowed) {
      line.append(button(t("siteAllow"), async () => {
        await chrome.permissions.request({ origins: siteOrigins(host) }).catch(() => false);
        showSites();
      }));
    }
    line.append(button(t("siteRemove"), () => askToRemove(row, host)));
    row.append(line);
    return row;
  }));
}

// Taking a site off the list needs the passcode.
function askToRemove(row, host) {
  if (row.querySelector("form")) return row.querySelector("form").remove();
  const form = Object.assign(document.createElement("form"), { className: "inline", autocomplete: "off" });
  const field = Object.assign(document.createElement("input"), { type: "password", maxLength: 200, required: true, placeholder: t("currentPasscode") });
  field.setAttribute("aria-label", t("currentPasscode"));
  const go = Object.assign(document.createElement("button"), { type: "submit", textContent: t("siteRemove") });
  form.append(field, go);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const reply = await ask("removeSite", { host, passcode: field.value });
    if (!reply?.ok) {
      field.value = "";
      return note("site-note", refusal(reply), true);
    }
    note("site-note", "");
    showSites();
  });
  row.append(form);
  field.focus();
}

$("site-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = tidyHost($("site-host").value);
  if (!host) return note("site-note", t("siteBad"), true);
  // Must come first: Chrome only asks in direct response to a click.
  const allowed = await chrome.permissions.request({ origins: siteOrigins(host) }).catch(() => false);
  if (!allowed) return note("site-note", t("siteDenied"), true);
  const reply = await ask("addSite", { host });
  if (!reply?.ok) return note("site-note", t("notSaved"), true);
  e.target.reset();
  note("site-note", t("siteAdded", host));
  showSites();
});

$("site-minutes").addEventListener("change", async (e) => {
  const reply = await ask("siteMinutes", { minutes: Number(e.target.value) });
  note("site-note", reply?.ok ? t("saved") : t("notSaved"), !reply?.ok);
});

function prefillSite() {
  const host = tidyHost(decodeURIComponent(location.hash.replace(/^#lock=?/, "")));
  if (!host) return;
  $("site-host").value = host;
  if (!$("sites").hidden) {
    $("sites").scrollIntoView({ block: "center" });
    $("site-host").focus();
  }
}

// ---------- Incognito ----------
async function checkIncognito() {
  $("incognito").hidden = await chrome.extension.isAllowedIncognitoAccess();
}
$("details").addEventListener("click", () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
addEventListener("focus", checkIncognito);

showLock().then(showSites).then(prefillSite);
checkIncognito();
