// Runs inside a guarded bundle alongside the locally bundled Dark Reader API.
// Dark Reader's API has its own private chrome.runtime shim, isolated at build time.
const nativeFetch = globalThis.fetch.bind(globalThis);
const hostnames = [location.hostname];
for (const origin of Array.from(location.ancestorOrigins || [])) {
  try { hostnames.push(new URL(origin).hostname); } catch { /* opaque frame */ }
}
let revision = 0;
let appliedSettings = "";

async function loadResource(url) {
  const parsed = NightSettings.site(url);
  if (parsed && !NightSettings.canFetchResource(parsed, NightSettings.site(location.href))) {
    throw new Error("Resource is outside the permitted page network context");
  }
  try {
    const response = await nativeFetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Resource HTTP ${response.status}`);
    return response;
  } catch (originalError) {
    // Styles and images on a CDN may not allow CORS from the page. The worker
    // retrieves that existing resource with the declared HTTP(S) host permission.
    if (!parsed) throw originalError;
    const result = await chrome.runtime.sendMessage({ type: "ns-fetch", url: parsed.href });
    if (!result?.ok) throw new Error(result?.error || "Resource is unavailable");
    const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { "Content-Type": result.contentType } });
  }
}
engine.setFetchMethod(loadResource);
// This is Dark Reader's existing extension fetch hook. The embedding API limits
// cross-origin requests to public HTTPS hosts, whereas this extension explicitly
// has HTTP(S) host permission and supports local development sites as well.
engine.Plugins = {
  fetch: async ({ url, responseType }) => {
    const response = await loadResource(url);
    if (responseType !== "data-url") return response.text();
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
};
globalThis.DarkReader = engine;

async function updateTheme() {
  const ticket = ++revision;
  try {
    const stored = await chrome.storage.local.get(NightSettings.defaults);
    if (ticket !== revision) return;
    const settings = NightSettings.normalize(stored);
    const active = settings.enabled && !hostnames.some((host) => settings.excludedHosts.includes(host));
    const fingerprint = JSON.stringify([active, settings.brightness]);
    if (fingerprint === appliedSettings) return;
    if (active) {
      engine.enable({
        brightness: settings.brightness,
        contrast: 100,
        sepia: 0,
        darkSchemeBackgroundColor: "#181a1b",
        darkSchemeTextColor: "#e8e6e3",
        styleSystemControls: true
      }, {
        // Do not inject a script into the page's main JavaScript world.
        // Mutation observers still handle new styles and SPA navigation.
        disableStyleSheetsProxy: true,
        disableCustomElementRegistryProxy: true
      });
    } else if (engine.isEnabled()) {
      engine.disable();
    }
    appliedSettings = fingerprint;
  } catch (error) {
    if (engine.isEnabled()) engine.disable();
    appliedSettings = "";
    console.warn("Night Sites: could not update the theme", error);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) => key in NightSettings.defaults)) {
    void updateTheme();
  }
});
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== "ns-status") return;
  respond({ enabled: engine.isEnabled() });
});
globalThis.__nightSitesInstalled = { refresh: updateTheme };
void updateTheme();
