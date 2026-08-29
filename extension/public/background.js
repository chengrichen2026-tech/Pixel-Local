/* global chrome */

chrome.action.onClicked.addListener(async () => {
  const editorUrl = chrome.runtime.getURL("index.html");
  const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL("")}*` });
  const existing = tabs.find((tab) => tab.url === editorUrl);

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: editorUrl });
});
