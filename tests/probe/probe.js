globalThis.countHistory = async () =>
  (await chrome.history.search({ text: "", startTime: 0, maxResults: 1000 })).length;
