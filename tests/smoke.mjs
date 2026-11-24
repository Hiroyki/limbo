// Loads Limbo into a throwaway Chrome profile and checks what matters most:
// history goes only when it should, and locks hold.
//
// Usage: node tests/smoke.mjs        (CHROME=/path/to/chrome to choose a browser)
//        HEADFUL=1 node tests/smoke.mjs   to watch it

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TESTS);
const PASSCODE = "open sesame";

const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((file) => file && fs.existsSync(file));
if (!CHROME) throw new Error("Chrome not found. Set CHROME to its path.");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(check, what, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// ---------- A small DevTools client ----------
class Browser {
  #id = 0;
  #waiting = new Map();

  constructor() {
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), "limbo-smoke-"));
    const args = [
      "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--enable-unsafe-swiftshader",
      `--user-data-dir=${this.profile}`, "--no-first-run", "--no-default-browser-check",
      "--lang=en", "--window-size=1200,800", "about:blank",
    ];
    if (!process.env.HEADFUL) args.unshift("--headless=new");
    this.process = spawn(CHROME, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    let chunks = [];
    this.process.stdio[4].on("data", (data) => {
      let from = 0, at;
      while ((at = data.indexOf(0, from)) >= 0) {
        chunks.push(data.subarray(from, at));
        this.#receive(JSON.parse(Buffer.concat(chunks).toString()));
        chunks = [];
        from = at + 1;
      }
      chunks.push(data.subarray(from));
    });
  }

  #receive(message) {
    const waiting = this.#waiting.get(message.id);
    if (!waiting) return;
    this.#waiting.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.fail(new Error(message.error.message));
    else waiting.done(message.result);
  }

  send(method, params = {}, sessionId) {
    return new Promise((done, fail) => {
      const id = ++this.#id;
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        fail(new Error(`${method} timed out`));
      }, 20000);
      this.#waiting.set(id, { done, fail, timer });
      this.process.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }

  async targets(filter = [{}]) {
    return (await this.send("Target.getTargets", { filter })).targetInfos;
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return sessionId;
  }

  async run(session, expression) {
    const { result, exceptionDetails } = await this.send(
      "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async load(folder) {
    const { id } = await this.send("Extensions.loadUnpacked", { path: folder });
    const worker = await until(
      async () => (await this.targets()).find((t) => t.type === "service_worker" && t.url.includes(id)), "a service worker");
    return { id, worker: await this.attach(worker.targetId) };
  }

  async open(url) {
    const { targetId } = await this.send("Target.createTarget", { url });
    const session = await this.attach(targetId);
    await this.send("Page.enable", {}, session);
    return { targetId, session };
  }

  async typeAndEnter(session, text) {
    for (const key of text) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key, unmodifiedText: key }, session);
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key }, session);
    }
    const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...enter }, session);
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...enter }, session);
  }

  async click(session, x, y) {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      const pressed = type !== "mouseMoved";
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: pressed ? "left" : "none", clickCount: pressed ? 1 : 0 }, session);
    }
  }

  async close() {
    await this.send("Browser.close").catch(() => {});
    this.process.kill();
    await sleep(1000);
    fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// ---------- Setting up ----------
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(`<title>${request.url}</title><p>secret ${request.url}</p>`);
}).listen(0);
const site = (page) => `http://localhost:${server.address().port}${page}`;

const browser = new Browser();
let failures = 0;

async function test(name, body) {
  try {
    await body();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

function equal(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

try {
  const limbo = await browser.load(ROOT);
  const probe = await browser.load(path.join(TESTS, "probe"));
  const limboRun = (code) => browser.run(limbo.worker, code);
  const history = () => browser.run(probe.worker, "countHistory()");
  const locked = () => limboRun("isLocked()");
  const windows = () => limboRun("chrome.windows.getAll().then((all) => all.map((w) => `${w.type}:${w.state}`).join())");

  // Not the first tab: the welcome page opens there.
  const welcome = await until(
    async () => (await browser.targets()).find((t) => t.type === "page" && t.url.endsWith("ui/welcome.html")), "the welcome page");
  const tab = await browser.open(site("/start"));
  await browser.send("Target.closeTarget", { targetId: welcome.targetId });
  await limboRun("chrome.storage.local.set({ settings: { ...DEFAULTS, undo: 2 } })");

  const go = async (page) => {
    await browser.send("Page.navigate", { url: site(page) }, tab.session);
    await sleep(600);
  };
  const visit = async () => { await go("/one"); await go("/two"); };
  const clickIcon = async () => {
    for (const t of await browser.targets([{ type: "tab" }])) {
      const done = await browser.send("Extensions.triggerAction", { id: limbo.id, targetId: t.targetId }).then(() => true, () => false);
      if (done) return;
    }
    throw new Error("The toolbar icon could not be clicked");
  };
  const overlay = () => browser.run(tab.session, "!!document.querySelector('html > div[popover]')");
  const finished = (state) => until(async () => (await limboRun("current?.state")) === state, `the job to be ${state}`);
  const cleared = () => until(async () => !(await overlay()), "Limbo to leave");

  // ---------- Erasing ----------
  await test("nothing is erased while there is time to undo", async () => {
    await visit();
    const before = await history();
    await clickIcon();
    await until(overlay, "Limbo to appear");
    equal(await history(), before, "history entries");
  });

  await test("history is erased once the time is up", async () => {
    await finished("ok");
    equal(await history(), 0, "history entries");
    await cleared();
  });

  await test("clicking Limbo in time spares the history", async () => {
    await visit();
    const before = await history();
    await clickIcon();
    await until(overlay, "Limbo to appear");
    await sleep(900);
    const width = await browser.run(tab.session, "document.documentElement.clientWidth");
    await browser.click(tab.session, width - 160, 150);
    await finished("spared");
    equal(await history(), before, "history entries");
    // Limbo stays while the cursor is on it.
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 400 }, tab.session);
    await cleared();
  });

  await test("a page cannot fake the undo click", async () => {
    await visit();
    await clickIcon();
    await until(overlay, "Limbo to appear");
    await browser.run(tab.session, `
      document.querySelector("html > div[popover]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));`);
    await finished("ok");
    await cleared();
  });

  await test("nothing is erased if Limbo cannot show itself", async () => {
    await visit();
    const before = await history();
    await limboRun(`chrome.action.openPopup = () => Promise.reject(new Error("test")); summon(null, { id: 999999, windowId: 1 })`);
    await finished("spared");
    equal(await history(), before, "history entries");
  });

  // ---------- Locking the browser ----------
  await limboRun(`lockSettings.create({ passcode: ${JSON.stringify(PASSCODE)} })`);

  const lockPage = async () => {
    const target = await until(
      async () => (await browser.targets()).find((t) => t.type === "page" && t.url.endsWith("ui/lock.html")), "the lock page");
    return browser.attach(target.targetId);
  };

  await test("the passcode is stored only as a hash", async () => {
    const stored = JSON.stringify(await limboRun("chrome.storage.local.get()"));
    equal(stored.includes(PASSCODE), false, "passcode found in storage");
  });

  await test("locking hides every window behind the lock", async () => {
    await limboRun("lockNow()");
    await until(async () => (await windows()).includes("popup"), "the lock window");
    await sleep(800);
    const normal = (await windows()).split(",").filter((w) => w.startsWith("normal:"));
    equal(normal.every((w) => w === "normal:minimized"), true, "all windows minimized");
  });

  await test("a wrong passcode keeps it locked", async () => {
    await browser.typeAndEnter(await lockPage(), "wrong");
    await sleep(1500);
    equal(await locked(), true, "locked");
  });

  await test("closing the lock window brings it back", async () => {
    const target = (await browser.targets()).find((t) => t.type === "page" && t.url.endsWith("ui/lock.html"));
    await browser.send("Target.closeTarget", { targetId: target.targetId });
    await sleep(1500);
    await lockPage();
    equal(await locked(), true, "locked");
  });

  await test("nothing can be erased while locked", async () => {
    const job = await limboRun("current.id");
    await limboRun("chrome.action.onClicked.dispatch({ id: 1, windowId: 1 })");
    await sleep(600);
    equal(await limboRun("current.id"), job, "latest job");
  });

  await test("the right passcode opens it and brings the windows back", async () => {
    await browser.typeAndEnter(await lockPage(), PASSCODE);
    await until(async () => !(await locked()), "the lock to open");
    await until(async () => !/minimized|popup/.test(await windows()), "the windows to return");
  });

  // ---------- Locking a tab ----------
  const address = async () => (await browser.targets()).find((t) => t.targetId === tab.targetId)?.url ?? "";
  const atLock = async () => (await address()).includes("ui/tab-lock.html");
  let tabId;

  await test("a locked tab shows nothing of its page", async () => {
    await go("/private");
    await browser.send("Target.activateTarget", { targetId: tab.targetId });
    tabId = await limboRun("chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => t.id)");
    await limboRun(`chrome.tabs.get(${tabId}).then((t) => lockTab({ ...t, url: ${JSON.stringify(site("/private"))} }))`);
    await until(atLock, "the tab to lock");
    await sleep(600);
    const page = await browser.attach(tab.targetId);
    equal((await browser.run(page, "document.documentElement.outerHTML")).includes("secret"), false, "page text visible");
  });

  await test("Back and other addresses lead to the lock again", async () => {
    await limboRun(`chrome.tabs.goBack(${tabId}).catch(() => {})`);
    await sleep(1500);
    equal(await atLock(), true, "locked after Back");
    await limboRun(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(site("/elsewhere"))} }).then(() => 1)`);
    await sleep(1500);
    equal(await atLock(), true, "locked after another address");
  });

  await test("the passcode returns to the page that was locked", async () => {
    const page = await browser.attach(tab.targetId);
    await sleep(500);
    await browser.typeAndEnter(page, PASSCODE);
    await until(async () => (await address()) === site("/private"), "the page to return");
  });
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
