"use strict";

// Runs on top of the current page (normal case), inside popup.html (fallback)
// or inside the options page, which sets limboMount: a preview, or an idle
// portrait. It only plays the animation; background.js does the erasing.
(async () => {
  globalThis.limboDestroy?.(true);           // clicked again: start over
  const run = globalThis.limboRun = {};      // only the latest run may appear
  const mount = globalThis.limboMount ?? null;
  const idle = !!mount?.idle;

  // ---------- Stage ----------
  const W = 300, H = 300;
  const RADIUS = 122;
  const C = { x: W / 2, y: H / 2 };
  const LOGO = 590;                          // native size of the body image
  const EYES = [250.5, 327.5];               // x of each eye in the body image
  const FACE = { x: 289, y: 239 };           // midpoint between the eyes
  const pose = (size) => ({
    x: C.x + (FACE.x - LOGO / 2) * (size / LOGO),
    y: C.y + (FACE.y - LOGO / 2) * (size / LOGO),
    size,
  });
  const HOME = pose(172);                    // feeding
  const REST = pose(282);                    // resting: the ring becomes the rim

  // ---------- Tempo (seconds) ----------
  const IRIS = 0.4;
  const INTRO_AT = 0.2, INTRO = 0.65;
  const SUCK_AT = 0.85;
  const SPIT = 0.75, SINK_AT = 1.0, SINK = 0.5; // undo: page flies back, Limbo sinks
  const IMPLODE = 0.6, HOLD = 0.2, IMPACT = 0.11;
  const LINGER = 2100, LEAVE = 1200;         // ms before closing on its own
  const CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const smooth = (t) => t * t * (3 - 2 * t);
  const rand = (a, b) => a + Math.random() * (b - a);
  const isPopup = !mount && location.protocol === "chrome-extension:";
  const inPage = !mount && !isPopup;

  // ---------- Assets ----------
  const say = (key, ...parts) => chrome.i18n.getMessage(key, parts) || "";
  const send = (type, id, more) => chrome.runtime.sendMessage({ type, id, ...more }).catch(() => null);
  const assets = await send("limbo:open", null, { idle });
  const result = idle ? new Promise(() => {}) : send("limbo:result", assets.id);
  const cue = (name) => {
    if (assets.volume > 0 && !idle) send("limbo:cue", null, { name, volume: assets.volume, seconds: GRACE });
  };
  const GRACE = assets.graceMs / 1000;       // the undo window, kept by background.js
  const SUCK = GRACE - SUCK_AT - 0.05;
  const bytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const bitmap = (b64) => createImageBitmap(
    new Blob([bytes(b64)], { type: "image/webp" }), { premultiplyAlpha: "premultiply" });
  const font = new FontFace("Limbo Pirata One", bytes(assets.font));
  const [body, eyes] = await Promise.all([
    bitmap(assets.body), bitmap(assets.eyes), font.load().catch(() => null),
  ]);
  if (globalThis.limboRun !== run) return;
  document.fonts.add(font);

  // ---------- DOM, sealed off from the page's own styles ----------
  const host = document.createElement("div");
  const PLACES = {
    tl: "2px auto auto 10px", tr: "2px 10px auto auto", center: "0",
    bl: "auto auto 2px 10px", br: "auto 10px 2px auto",
  };
  const scale = mount ? mount.size / W : inPage ? assets.scale : 1;
  const fit = scale / (assets.zoom || 1);
  const hostStyle = {
    all: "initial", position: mount ? "absolute" : "fixed",
    inset: inPage ? PLACES[assets.corner] : "0",
    width: `${W}px`, height: `${H}px`, margin: inPage && assets.corner === "center" ? "auto" : "0", padding: "0", border: "0",
    background: "transparent", overflow: "visible", "pointer-events": "none",
    "z-index": "2147483647", "color-scheme": "light", zoom: String(fit),
  };
  for (const [k, v] of Object.entries(hostStyle)) host.style.setProperty(k, v, "important");
  const shadow = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    #stage { position: absolute; inset: 0; user-select: none; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    #hit {
      position: absolute; inset: ${H / 2 - RADIUS}px ${W / 2 - RADIUS}px;
      border-radius: 50%; pointer-events: auto; cursor: default;
    }
    #words {
      position: absolute; inset: 183px 0 auto; text-align: center;
      transition: opacity 0.2s;
    }
    #words.off { opacity: 0; }
    #words.ink { inset: 119px 0 auto; }
    #words.ink #title { color: #0b0b0b; text-shadow: 0 0 10px #e5e5e5, 0 0 10px #e5e5e5; }
    #words.ink #title span { animation-delay: calc(var(--i) * 60ms); }
    #words.ink #detail { color: #3d3b3a; text-shadow: 0 0 6px #e5e5e5, 0 0 6px #e5e5e5; animation-delay: 0.4s; }
    #hit.armed { cursor: pointer; }
    #undo, #more {
      position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%);
      padding: 6px 13px; border: 1px solid rgb(236 233 230 / 0.28); border-radius: 99px;
      background: rgb(8 8 8 / 0.92); color: #ece9e6; white-space: nowrap;
      font: 500 12px/1 system-ui, sans-serif; cursor: pointer; pointer-events: auto;
      transition: opacity 0.2s, visibility 0.2s;
    }
    :is(#undo, #more):hover { background: #262423; }
    :is(#undo, #more):focus-visible { outline: 2px solid #c8321f; outline-offset: 2px; }
    :is(#undo, #more).off { opacity: 0; visibility: hidden; }
    #title {
      margin: 0; min-height: 38px; color: #ece9e6;
      font: 400 38px/1 "Limbo Pirata One", Georgia, serif;
      text-shadow: 0 0 16px rgb(236 233 230 / 0.35), 0 1px 8px #000;
    }
    #title span {
      display: inline-block; opacity: 0; filter: blur(12px);
      transform: translateY(12px) scale(1.35);
      animation: emerge 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      animation-delay: calc(0.35s + var(--i) * 80ms);
    }
    @keyframes emerge { to { opacity: 1; filter: blur(0); transform: none; } }
    #detail {
      margin: 3px 0 0; color: #b4b0ad; opacity: 0;
      font: 400 12px/1.35 system-ui, sans-serif; text-shadow: 0 1px 5px #000;
      animation: fade 0.6s ease-out 0.9s forwards;
    }
    #detail:empty { animation: none; }
    @keyframes fade { to { opacity: 1; } }
    #status {
      position: absolute; width: 1px; height: 1px; margin: 0;
      overflow: hidden; clip-path: inset(50%);
    }
    @media (prefers-reduced-motion: reduce) {
      #undo, #more { transition: none; }
      #title span, #detail { animation: none; opacity: 1; filter: none; transform: none; }
    }
  `);
  shadow.adoptedStyleSheets = [sheet];

  const el = (tag, id, parent) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    parent.append(node);
    return node;
  };
  const stage = el("div", "stage", shadow);
  let sceneCanvas = el("canvas", "scene", stage);
  const topCanvas = el("canvas", "top", stage);
  const words = el("div", "words", stage);
  words.setAttribute("aria-hidden", "true");
  const title = el("p", "title", words);
  const detail = el("p", "detail", words);
  const status = el("p", "status", stage);
  status.setAttribute("role", "status");
  const hit = el("div", "hit", stage);
  const undo = el("button", "undo", stage);
  undo.type = "button";
  undo.textContent = say("clickToUndo");
  undo.className = "off";
  const more = el("button", "more", stage);
  more.type = "button";
  more.textContent = say("settings");
  more.className = "off";

  const ctx = topCanvas.getContext("2d");
  const DPR = Math.min(2.5, (devicePixelRatio || 1) * fit);
  for (const c of [sceneCanvas, topCanvas]) { c.width = W * DPR; c.height = H * DPR; }

  (mount?.target ?? (isPopup ? document.body : document.documentElement)).append(host);
  if (inPage) {
    // Top layer: stays above dialogs and fullscreen elements too.
    host.popover = "manual";
    try { host.showPopover(); } catch { /* z-index still applies */ }
  }

  // ---------- State ----------
  // devour | implode | hold | impact | void | error, or devour | spit | spared
  let phase = "devour";
  let start = 0, phaseAt = 0, now = 0, last = 0;
  let outcome = null;                        // null while still erasing
  let nextGulp = 0, blinkAt = 0, pokeAt = -9, sleepAt = 0;
  let inside = false, closeTimer = 0, raf = 0;
  let shyness = 0;                           // eyes shut while a passcode is typed
  let asking = false, spitFrom = 0, spitZoom = 1, spoke = false;
  const pointer = { x: -999, y: -999 };
  const look = { x: 0, y: 0, tx: 0, ty: 0 };

  // Everything the shader reads.
  const s = {
    radius: RADIUS, size: HOME.size, time: 0, zoom: 1, iris: 0, intro: 0, suck: 0, power: 0,
    gulp: 0, implode: 0, impact: 0, ghost: 0, rage: 0, blank: 0,
    might: assets.level / 4, blood: assets.blood ? 1 : 0,
    face: { x: HOME.x, y: HOME.y }, look,
    ripple: { x: 0, y: 0, r: 0, k: 0 },
  };

  // The finale waits for what really happened.
  let grew = null;                           // name of the level just reached
  result.then((reply) => {
    grew = reply?.grew ?? null;
    outcome = reply?.status ?? "fail";
  });

  // ---------- History page (decoration, never real data) ----------
  function paintPage() {
    const c = document.createElement("canvas");
    c.width = W * 2;
    c.height = H * 2;
    const g = c.getContext("2d");
    g.scale(2, 2);
    g.fillStyle = "#e5e5e5";
    g.fillRect(0, 0, W, H);
    const bar = (x, y, w, h, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, y, w, h, h / 2);
      g.fill();
    };
    let y = 34;
    for (const rows of [4, 5, 5]) {
      bar(40, y, rand(50, 80), 6, "#4a4a4a");
      y += 17;
      for (let i = 0; i < rows; i++) {
        g.fillStyle = ["#8c8c8c", "#a3a3a3", "#767676"][Math.floor(rand(0, 3))];
        g.beginPath();
        g.roundRect(40, y - 3, 9, 9, 2.5);
        g.fill();
        const w = rand(50, 105);
        bar(56, y - 1, w, 4.5, "#7b7b7b");
        bar(56 + w + 7, y - 1, rand(20, 45), 4.5, "#b9b9b9");
        bar(W - 66, y - 1, 24, 4.5, "#b9b9b9");
        y += 14;
      }
      y += 9;
    }
    return c;
  }

  // ---------- Embers and ash ----------
  const embers = [];
  function burst() {
    embers.length = 0;
    for (let i = 0; i < 46 + s.might * 60; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, 430);
      embers.push({
        x: HOME.x + Math.cos(a) * 6, y: HOME.y + Math.sin(a) * 6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: rand(0.45, 1.3), rise: rand(5, 16), seed: rand(0, 9), red: Math.random() < 0.3 + s.might * 0.35 + s.blood * 0.4,
      });
    }
  }

  function drawEmbers(dt) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(C.x, C.y, RADIUS * s.iris, 0, Math.PI * 2);
    ctx.clip();
    for (const p of embers) {
      const drag = Math.exp(-dt * 3.4);
      p.vx = p.vx * drag + Math.sin(s.time * 0.9 + p.seed) * 8 * dt;
      p.vy = p.vy * drag - p.rise * 2.6 * dt;
      // Ash shies away from the cursor.
      const dx = p.x - pointer.x, dy = p.y - pointer.y, d = Math.hypot(dx, dy);
      if (d < 55 && d > 0) {
        const push = (1 - d / 55) * 520 * dt;
        p.vx += (dx / d) * push;
        p.vy += (dy / d) * push;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const top = C.y - RADIUS - 4, bottom = C.y + RADIUS + 4;
      if (p.y < top) { p.y = bottom; p.x = C.x + rand(-RADIUS, RADIUS); }
      ctx.globalAlpha = 0.4 + 0.35 * Math.sin(s.time * 2.2 + p.seed);
      ctx.strokeStyle = p.red || s.rage > 0.5 ? "#c8321f" : "#dedad6";
      ctx.lineWidth = p.r * 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022 + 0.1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Eyes ----------
  function tint(color) {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const g = c.getContext("2d");
    g.drawImage(eyes, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, 200, 100);
    return c;
  }
  const sprites = { white: eyes, red: tint("#e0301f"), black: tint("#050505") };

  function eyeOpenness(t) {
    const blink = (at) => {
      const d = t - at;
      return d > 0 && d < 0.2 ? Math.abs(d / 0.1 - 1) : 1;
    };
    let open = smooth(clamp((t - INTRO_AT - 0.4) / 0.26));   // waking up
    const since = now - phaseAt;
    if (phase === "implode") open *= 1 - smooth(clamp((since - IMPLODE * 0.62) / 0.18));
    else if (phase === "hold" || phase === "spared") open = 0;
    else if (phase === "spit") open *= 1 - smooth(clamp((since - SINK_AT + 0.2) / 0.2));
    else if (phase === "void" || phase === "error") {
      if (t > blinkAt + 0.2) blinkAt = t + rand(1.6, 3.4);
      open *= blink(blinkAt);
    }
    open *= blink(pokeAt);
    if (sleepAt) open *= 1 - clamp((t - sleepAt) / 0.2);
    open *= 1 - 0.94 * shyness;
    return open;
  }

  function drawEyes(t) {
    const open = eyeOpenness(t) * (phase === "devour" ? 1 - s.power * 0.3 + s.gulp * 0.25 : 1);
    if (open <= 0.01) return;
    const k = (s.size / LOGO) * s.zoom;
    const startled = phase === "spit" ? 0.28 * (1 - clamp((now - phaseAt) / 0.8)) : 0;
    const pop = phase === "impact" ? 1.35 : 1 + s.gulp * 0.1 + startled;
    const sprite = 100 * k * pop;
    const hover = CALM ? 0 : Math.sin(s.time * 1.5) * 1.4 * s.ghost;
    const sheetImage = phase === "impact" ? sprites.black : s.rage > 0.5 ? sprites.red : sprites.white;

    EYES.forEach((ex, i) => {
      const x = s.face.x + (ex - FACE.x) * k + look.x;
      const y = s.face.y + look.y + hover;
      if (phase !== "impact" && s.ghost > 0.01) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 44);
        const rgb = s.rage > 0.5 ? "200,40,25" : "235,232,228";
        halo.addColorStop(0, `rgba(${rgb},${0.2 * s.ghost * open})`);
        halo.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(x - 44, y - 44, 88, 88);
      }
      if (assets.level >= 3 && phase !== "impact" && !CALM) drawWisp(x, y, k, open, i);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((i ? -1 : 1) * s.rage * 0.22);
      ctx.scale(1, Math.max(0.03, open));
      if (phase !== "impact") {
        ctx.shadowColor = s.rage > 0.5 ? "rgba(210,45,28,.9)" : "rgba(255,255,255,.8)";
        ctx.shadowBlur = (4 + s.gulp * 10 + s.ghost * 7) * DPR;
      }
      ctx.drawImage(sheetImage, i * 100, 0, 100, 100, -sprite / 2, -sprite / 2, sprite, sprite);
      ctx.restore();
    });
  }

  // From Inferno on, light trails off the eyes like smoke.
  function drawWisp(x, y, k, open, i) {
    const h = (assets.level >= 4 ? 118 : 82) * k * open;
    const rgb = s.rage > 0.5 || s.blood ? "224,48,31" : "255,255,255";
    const side = i ? 1 : -1;
    ctx.save();
    ctx.fillStyle = `rgba(${rgb},1)`;
    for (let n = 0; n < 56; n++) {
      const u = n / 55;
      const drift = Math.sin(s.time * 3.4 - u * 4.6 + i * 1.7) * 11 * k * u + side * 15 * k * u * u;
      ctx.globalAlpha = 0.1 * (1 - u) ** 1.6 * open;
      ctx.beginPath();
      ctx.ellipse(x + drift, y - 12 * k - h * u, (17 * (1 - u) + 2.5) * k, (13 * (1 - u) + 5) * k, 0, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Undo countdown around the rim ----------
  function drawCountdown(t) {
    if (!pending()) return;
    const left = 1 - clamp(t / GRACE), a = -Math.PI / 2;
    ctx.globalAlpha = clamp((t - 0.25) / 0.25);
    ctx.lineCap = "round";
    for (const [width, color] of [[5, "rgba(8,8,8,.55)"], [2.5, "#e03a24"]]) {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(C.x, C.y, RADIUS + 10, a, a + Math.PI * 2 * left);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Fallback without WebGL ----------
  function createFlatScene(page) {
    const flat = sceneCanvas.cloneNode();
    sceneCanvas.replaceWith(flat);
    sceneCanvas = flat;
    const c = flat.getContext("2d");
    const draw = (image, scale, turn, x, y, w, h) => {
      if (scale <= 0.01) return;
      c.save();
      c.translate(s.face.x, s.face.y);
      c.rotate(turn);
      c.scale(scale, scale);
      c.drawImage(image, x - s.face.x, y - s.face.y, w, h);
      c.restore();
    };
    return {
      draw() {
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        c.clearRect(0, 0, W, H);
        c.save();
        c.beginPath();
        c.arc(C.x, C.y, RADIUS * s.iris, 0, Math.PI * 2);
        c.clip();
        c.fillStyle = s.impact ? "#eee" : "#050505";
        c.fillRect(0, 0, W, H);
        draw(page, 1 - s.suck, s.suck * 2.4, 0, 0, W, H);
        const x = C.x - HOME.size / 2, y = C.y - HOME.size / 2;
        if (!s.ghost) {
          draw(body, easeOut(s.intro) * (1 - s.implode), s.implode ** 2 * 3, x, y, HOME.size, HOME.size);
        }
        c.restore();
      },
      dispose() {},
    };
  }

  // ---------- Flow ----------
  function setPhase(name) {
    phase = name;
    phaseAt = now;
    if (name === "implode" || name === "impact") cue(name);
  }

  function ripple(x, y, k) {
    Object.assign(s.ripple, { x, y, r: 0, k });
  }

  const pending = () => phase === "devour" && !outcome && !idle;

  // Ask background.js to call it off; it knows whether there is still time.
  async function trySpare() {
    if (asking || !pending()) return;
    asking = true;
    const reply = await send("limbo:spare", assets.id);
    asking = false;
    if (reply?.spared) outcome = "spared";
  }

  function spit() {
    setPhase("spit");
    cue("spit");
    spitFrom = s.suck;
    spitZoom = s.zoom;
    s.gulp = 1;
    if (!CALM) ripple(s.face.x, s.face.y, 1);
  }

  function step(t, dt) {
    const since = now - phaseAt;
    const ease = (rate) => 1 - Math.exp(-dt * rate);
    s.time = CALM ? 0 : t;
    s.intro = CALM ? 1 : clamp((t - INTRO_AT) / INTRO);
    s.iris = CALM ? 1 : easeOut(clamp(t / IRIS));
    if (sleepAt && !CALM) s.iris *= 1 - clamp((t - sleepAt - 0.16) / 0.26) ** 2;
    s.gulp *= Math.exp(-dt * 7);
    s.ripple.r += dt * 300;
    s.ripple.k *= Math.exp(-dt * 2.6);

    if (phase === "devour") {
      if (!CALM) {
        const u = clamp((t - SUCK_AT) / SUCK);
        s.suck = u ** 2.1;
        s.power = lerp(s.power, t > SUCK_AT - 0.15 ? 1 : 0, ease(3.2));
        s.zoom = 1 + 0.28 * smooth(u);
        if (u > 0 && t > nextGulp) {
          s.gulp = Math.min(1, s.gulp + 0.45);
          nextGulp = t + rand(0.16, 0.26);
        }
      }
      // If erasing outlasts the animation, Limbo just keeps writhing.
      if (outcome === "spared") spit();
      else if (outcome && t > GRACE) setPhase(CALM ? "impact" : "implode");
    } else if (phase === "spit" || phase === "spared") {
      // Coughs the page back up, then sinks into the paper.
      const spat = phase === "spared" ? 9 : since;
      const back = easeOut(clamp(spat / SPIT));
      s.suck = CALM ? 0 : spitFrom * (1 - back);
      s.zoom = lerp(spitZoom, 1, back);
      s.power = lerp(s.power, 0, ease(4));
      const sink = CALM ? clamp(spat / 0.3) : smooth(clamp((spat - SINK_AT) / SINK));
      s.intro *= 1 - sink;
      s.blank = sink;
      if (phase === "spit" && spat > SINK_AT + SINK * 0.6 && !spoke) speak(say("spared"), say("nothingErased"), true);
      if (phase === "spit" && spat > SINK_AT + SINK) {
        setPhase("spared");
        scheduleClose(1700);
      }
    } else if (phase === "implode") {
      s.suck = 1;
      s.implode = smooth(clamp(since / IMPLODE));
      s.zoom = 1.28 + 0.12 * s.implode;
      if (since >= IMPLODE) setPhase("hold");
    } else if (phase === "hold") {
      s.implode = 1;
      if (since >= HOLD) setPhase("impact");
    } else if (phase === "impact") {
      s.impact = CALM ? 0 : 1;
      if (CALM || since >= IMPACT) finish();
    } else {
      s.impact = 0;
      s.suck = s.implode = 1;
      s.power = lerp(s.power, 0, ease(5));
      const k = CALM ? 1 : easeOut(clamp(since / 0.9));
      s.ghost = CALM ? 1 : smooth(clamp(since / 0.8));
      s.zoom = lerp(1.4, 1, k);
      s.face.x = lerp(HOME.x, REST.x, k);
      s.face.y = lerp(HOME.y, REST.y, k);
      s.size = lerp(HOME.size, REST.size, k);
    }
    s.rage = lerp(s.rage, phase === "error" || mount?.angry ? 1 : 0, ease(6));
    shyness = lerp(shyness, mount?.shy ? 1 : 0, ease(14));
    look.x = lerp(look.x, look.tx, ease(9));
    look.y = lerp(look.y, look.ty, ease(9));
  }

  function finish() {
    const ok = outcome === "ok";
    s.impact = 0;
    setPhase(ok ? "void" : "error");
    blinkAt = now - start + 1.5;
    if (!CALM) {
      ripple(HOME.x, HOME.y, 1);
      burst();
    }
    if (!ok) cue("fail");
    if (idle) return;
    if (ok) speak(say("gone"), grew ? say("became", grew) : assets.done);
    else speak(say("failed"), say("blocked"));
    scheduleClose(ok && !grew ? LINGER : LINGER * 1.8);
  }

  function speak(heading, text, inked = false) {
    spoke = true;
    words.classList.toggle("ink", inked);
    detail.textContent = text;
    status.textContent = `${heading}. ${text}.`;
    title.replaceChildren(...[...heading].map((letter, i) => {
      const span = document.createElement("span");
      span.textContent = letter === " " ? "\u00a0" : letter;
      span.style.setProperty("--i", i);
      return span;
    }));
  }

  function frame(ms) {
    now = ms / 1000;
    if (!start) {
      start = last = now;
      if (idle) {
        outcome = "ok";
        s.implode = s.suck = 1;
        finish();
      } else {
        send("limbo:begin", assets.id);      // the undo clock starts now
        cue("devour");
      }
    }
    const t = now - start, dt = Math.min(0.05, now - last);
    last = now;
    step(t, dt);
    scene.draw(s);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (phase === "void" || phase === "error") drawEmbers(dt);
    drawEyes(t);
    drawCountdown(t);
    undo.classList.toggle("off", !pending() || t < 0.3);
    hit.classList.toggle("armed", pending());
    const settled = ["void", "error", "spared"].includes(phase) && now - phaseAt > 0.7;
    more.classList.toggle("off", !settled || !!sleepAt || !!mount);

    let shake = 0;
    if (!CALM && phase === "devour") shake = s.power * 0.5 + s.gulp * 1.2;
    else if (!CALM && phase === "impact") shake = 4;
    else if (!CALM && phase === "spit") shake = 3.5 * Math.exp(-(now - phaseAt) * 5);
    else if (!CALM && phase === "void") shake = 2.5 * Math.exp(-(now - phaseAt) * 9);
    stage.style.transform = shake > 0.05
      ? `translate(${rand(-shake, shake)}px, ${rand(-shake, shake)}px)` : "";
    raf = requestAnimationFrame(frame);
  }

  // ---------- Interaction ----------
  function wake() {
    sleepAt = 0;
    words.classList.remove("off");
    clearTimeout(closeTimer);
  }

  function scheduleClose(ms) {
    clearTimeout(closeTimer);
    if (idle || !["void", "error", "spared"].includes(phase) || inside) return;
    closeTimer = setTimeout(() => {
      sleepAt = now - start;                 // shut the eyes, then the circle
      words.classList.add("off");
      closeTimer = setTimeout(destroy, 460, false);
    }, ms);
  }

  // Page coordinates to stage coordinates, whatever the zoom.
  function locate(e) {
    const box = host.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * W,
      y: ((e.clientY - box.top) / box.height) * H,
    };
  }

  const controller = new AbortController();
  const listen = { signal: controller.signal, passive: true, capture: true };

  // The eyes follow the cursor anywhere on the page.
  addEventListener("pointermove", (e) => {
    Object.assign(pointer, locate(e));
    const dx = pointer.x - s.face.x, dy = pointer.y - s.face.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, d / 110) * (phase === "devour" ? 4 : 8);
    look.tx = (dx / d) * reach;
    look.ty = (dy / d) * reach * 0.8;
  }, listen);
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (e.target !== document.documentElement) return;
    pointer.x = pointer.y = -999;
    look.tx = look.ty = 0;
  }, listen);
  for (const zone of [hit, more]) {
    zone.addEventListener("pointerenter", () => { inside = true; wake(); });
    zone.addEventListener("pointerleave", () => { inside = false; scheduleClose(LEAVE); });
  }
  more.addEventListener("click", (e) => { if (e.isTrusted) send("limbo:settings"); });
  // Only real input counts; a page must not be able to fake it.
  undo.addEventListener("click", (e) => { if (e.isTrusted) trySpare(); });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !e.isTrusted || !pending()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    trySpare();
  }, { signal: controller.signal, capture: true });
  hit.addEventListener("pointerdown", (e) => {
    if (pending()) {
      if (e.isTrusted) trySpare();
      return;
    }
    pokeAt = now - start;
    s.gulp = 1;
    const at = locate(e);
    if (!CALM && s.ghost > 0.5) ripple(at.x, at.y, 0.8);
  });

  function destroy(replaced = false) {
    cancelAnimationFrame(raf);
    clearTimeout(closeTimer);
    controller.abort();
    scene.dispose();
    document.fonts.delete(font);
    host.remove();
    globalThis.limboDestroy = null;
    if (isPopup && !replaced) window.close();
    if (!replaced) mount?.onDone();
  }
  globalThis.limboDestroy = destroy;

  // ---------- Go ----------
  const page = paintPage();
  const scene = limboScene(sceneCanvas, W, H, body, page) ?? createFlatScene(page);
  raf = requestAnimationFrame(frame);
})();
