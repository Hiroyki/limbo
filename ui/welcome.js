"use strict";

const $ = (id) => document.getElementById(id);
const portrait = createPortrait($("hero"));

$("preview").addEventListener("click", async () => {
  $("preview").disabled = true;
  await portrait.preview();
  $("preview").disabled = false;
});

$("done").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("lock").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("ui/options.html#lock") }));

portrait.show();
