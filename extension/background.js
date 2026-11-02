"use strict";
importScripts("settings.js");

async function refreshOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const results = await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        injectImmediately: true,
        files: ["content.js"]
      });
      return { tabId: tab.id, ok: true };
    } catch {
      // Browser stores, built-in PDF viewers and closing tabs can reject injection.
      return { tabId: tab.id, ok: false };
    }
  }));
  return { ok: true, results };
}

async function fetchResource(url, pageUrl) {
  const parsed = NightSettings.site(url);
  if (!NightSettings.canFetchResource(parsed, NightSettings.site(pageUrl))) throw new Error("Unsupported resource URL");
  const response = await fetch(parsed.href, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "force-cache",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Resource HTTP ${response.status}`);
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Resource too large");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error("Resource too large"); }
    chunks.push(value);
  }
  let binary = "";
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 16384) {
      binary += String.fromCharCode(...chunk.subarray(i, i + 16384));
    }
  }
  return { ok: true, base64: btoa(binary), contentType: response.headers.get("content-type") || "application/octet-stream" };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === "ns-refresh" && sender.url === chrome.runtime.getURL("popup.html")) {
    refreshOpenTabs().then(respond, () => respond({ ok: false }));
    return true;
  }
  if (message?.type === "ns-fetch" && sender.tab && NightSettings.site(sender.url)) {
    fetchResource(message.url, sender.url).then(respond, (error) => respond({ ok: false, error: String(error.message) }));
    return true;
  }
});
chrome.runtime.onInstalled.addListener(() => { void refreshOpenTabs(); });
