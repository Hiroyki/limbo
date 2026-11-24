"use strict";

const $ = (id) => document.getElementById(id);
const form = $("form"), passcode = $("passcode"), openButton = $("open"), note = $("note");
const send = (type, more) => chrome.runtime.sendMessage({ type, ...more }).catch(() => null);

// The same page locks the browser, a tab, or a site.
const inTab = document.body.dataset.mode === "tab";
const host = inTab ? decodeURIComponent(location.hash.slice(1)) : "";
if (inTab) {
  // The site was opened from another tab.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "lock:site-open" && message.host === host) history.back();
  });
  send("lock:tab-info", { host }).then((info) => {
    if (!note.textContent) say(info?.host ?? t("tabLocked"));
  });
}

// Limbo looks away while you type, and glares when it is wrong.
const portrait = createPortrait($("hero"));
const mood = (changes) => { if (portrait.mood) Object.assign(portrait.mood, changes); };
portrait.show();

passcode.addEventListener("input", () => {
  mood({ shy: passcode.value.length > 0, angry: false });
});

// The field is always ready to type into, wherever the focus was.
const ready = () => { if (!passcode.disabled) passcode.focus(); };
ready();
addEventListener("focus", ready);
document.addEventListener("visibilitychange", ready);
document.addEventListener("pointerup", (e) => { if (!e.target.closest("button")) ready(); });
addEventListener("keydown", (e) => {
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement !== passcode) ready();
}, true);

let waiting = 0;
function say(text, bad = false) {
  note.textContent = text;
  note.classList.toggle("bad", bad);
}

function lockOut(ms) {
  const end = Date.now() + ms;
  passcode.disabled = openButton.disabled = true;
  clearInterval(waiting);
  const tick = () => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left > 0) return say(t("tooMany", left), true);
    clearInterval(waiting);
    passcode.disabled = openButton.disabled = false;
    mood({ angry: false });
    say("");
    passcode.focus();
  };
  tick();
  waiting = setInterval(tick, 1000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  openButton.disabled = true;
  const reply = await send(inTab ? "lock:tab-open" : "lock:unlock", { passcode: passcode.value, host });
  openButton.disabled = false;
  passcode.value = "";
  mood({ shy: false });

  if (reply?.ok) {
    $("title").textContent = t("welcomeBack");
    passcode.disabled = openButton.disabled = true;
    say(reply.recovery ? t("recovered") : "");
    if (reply.back) setTimeout(() => history.back(), 350);
    return;                                  // background.js sees to the rest
  }
  mood({ angry: true });
  document.body.classList.remove("shake");
  void document.body.offsetWidth;            // restart the animation
  document.body.classList.add("shake");
  if (reply?.waitMs > 0) lockOut(reply.waitMs);
  else {
    say(reply ? t("wrong") : t("oops"), true);
    passcode.focus();
    setTimeout(() => mood({ angry: false }), 1600);
  }
});

// Keep honest people honest.
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  const devtools = e.key === "F12" || (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase()));
  if (devtools || (e.ctrlKey && e.key.toLowerCase() === "u")) e.preventDefault();
}, true);
