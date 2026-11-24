"use strict";

// Fills in text in Chrome's language: data-t for text, data-t-label for labels.
const t = (key, ...parts) => chrome.i18n.getMessage(key, parts.map(String)) || key;

document.documentElement.lang = t("@@ui_locale").startsWith("id") ? "id" : "en";
for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
for (const node of document.querySelectorAll("[data-t-label]")) node.setAttribute("aria-label", t(node.dataset.tLabel));
for (const node of document.querySelectorAll("[data-t-hint]")) node.placeholder = t(node.dataset.tHint);
