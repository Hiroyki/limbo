"use strict";

// Puts Limbo on one of our own pages: an idle portrait, or a preview.
function createPortrait(target) {
  const portrait = { mood: null, previewing: false };

  function mount(idle, onDone = () => {}) {
    portrait.mood = globalThis.limboMount = {
      idle, target, onDone, size: target.clientWidth, shy: false, angry: false,
    };
    const script = document.createElement("script");
    script.src = "limbo.js";
    script.onload = () => script.remove();
    document.body.append(script);
  }

  portrait.show = () => { if (!portrait.previewing) mount(true); };

  // Resolves once the preview is over, or right away if it can't start.
  portrait.preview = async () => {
    if (portrait.previewing) return;
    const ready = await chrome.runtime.sendMessage({ type: "limbo:preview" }).catch(() => null);
    if (!ready || portrait.previewing) return;
    portrait.previewing = true;
    await new Promise((done) => mount(false, done));
    portrait.previewing = false;
    mount(true);
  };

  // Redraw at the right size when the window changes.
  let timer = 0;
  addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (target.clientWidth !== portrait.mood?.size) portrait.show();
    }, 200);
  });
  return portrait;
}
