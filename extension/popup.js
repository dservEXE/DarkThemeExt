"use strict";
const globalToggle = document.getElementById("global-toggle");
const siteToggle = document.getElementById("site-toggle");
const slider = document.getElementById("brightness");
const reset = document.getElementById("reset");
const error = document.getElementById("error");
let settings = NightSettings.normalize(NightSettings.defaults);
let currentSite = null;
let currentTabId;
let busy = true;
let latestSave = 0;

function render() {
  const badge = document.getElementById("badge");
  badge.textContent = settings.enabled ? "Включена" : "Выключена";
  badge.dataset.enabled = String(settings.enabled);
  document.getElementById("status").textContent = settings.enabled
    ? "Сайты используют тёмную палитру. Фотографии сохраняют свои цвета."
    : "Включите, когда захотите. Настройка сразу применяется к открытым сайтам.";
  globalToggle.setAttribute("aria-checked", String(settings.enabled));
  globalToggle.disabled = busy;
  const allowed = currentSite && !settings.excludedHosts.includes(currentSite.hostname);
  siteToggle.setAttribute("aria-checked", String(Boolean(allowed)));
  siteToggle.disabled = busy || !currentSite || !settings.enabled;
  document.getElementById("host").textContent = currentSite?.hostname || "Служебная страница";
  document.getElementById("site-text").textContent = allowed ? "Использовать тёмную тему" : "Оставить исходные цвета";
  document.getElementById("site-hint").textContent = !currentSite
    ? "Браузер запрещает перекраску своих страниц, магазина расширений и встроенного просмотра PDF."
    : !settings.enabled
      ? "Сначала включите общий переключатель выше."
      : allowed ? "Отключите здесь, если сайту лучше подходят исходные цвета."
        : "Этот сайт добавлен в исключения. Другие сайты остаются тёмными.";
  slider.value = String(settings.brightness);
  document.getElementById("brightness-value").textContent = `${settings.brightness}%`;
  slider.disabled = busy || !settings.enabled;
  reset.disabled = busy || !settings.enabled || settings.brightness === 100;
}

function showError(message) { error.textContent = message; error.hidden = false; }

async function refreshInBackground(saveId) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "ns-refresh" });
    // Ignore a delayed reply if the user has already changed the settings again.
    if (saveId !== latestSave) return;
    if (!result?.ok) throw new Error("Refresh failed");
    if (settings.enabled && currentSite && result.results.some((item) => item.tabId === currentTabId && !item.ok)) {
      showError("На этой странице браузер ограничивает доступ. Обновите вкладку; если это не поможет, оставьте её в исходных цветах.");
    }
  } catch {
    if (saveId === latestSave) showError("Настройка сохранена. Для её применения к оставшимся вкладкам обновите эти страницы.");
  }
}

async function save(patch, refresh = false) {
  const saveId = ++latestSave;
  let saved = false;
  busy = true;
  error.hidden = true;
  render();
  try {
    await chrome.storage.local.set(patch);
    settings = NightSettings.normalize(await chrome.storage.local.get(NightSettings.defaults));
    saved = true;
  } catch {
    showError("Не удалось сохранить настройку. Попробуйте переключить ещё раз.");
  } finally { busy = false; render(); }
  // A loading, suspended or unresponsive tab must never lock this popup.
  if (saved && refresh) void refreshInBackground(saveId);
}

globalToggle.addEventListener("click", () => { if (!busy) void save({ enabled: !settings.enabled }, true); });
siteToggle.addEventListener("click", () => {
  if (busy || !currentSite || !settings.enabled) return;
  const host = currentSite.hostname;
  const excluded = settings.excludedHosts.includes(host);
  void save({ excludedHosts: excluded ? settings.excludedHosts.filter((item) => item !== host) : [...settings.excludedHosts, host] }, true);
});
slider.addEventListener("input", () => {
  document.getElementById("brightness-value").textContent = `${slider.value}%`;
});
slider.addEventListener("change", () => {
  void save({ brightness: Number(slider.value) });
});
reset.addEventListener("click", () => { void save({ brightness: 100 }); });

(async () => {
  try {
    settings = NightSettings.normalize(await chrome.storage.local.get(NightSettings.defaults));
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
    currentSite = NightSettings.site(tab?.url);
    if (currentSite && (currentSite.hostname === "chromewebstore.google.com" ||
        (currentSite.hostname === "chrome.google.com" && currentSite.pathname.startsWith("/webstore")))) currentSite = null;
    busy = false;
    render();
  } catch { showError("Не удалось загрузить настройки. Закройте и снова откройте расширение."); }
})();
