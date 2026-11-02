"use strict";
const NightSettings = (() => {
  const defaults = { enabled: false, brightness: 100, excludedHosts: [] };
  function normalize(value = {}) {
    const brightness = Number(value.brightness);
    return {
      enabled: value.enabled === true,
      brightness: Number.isFinite(brightness) ? Math.min(110, Math.max(70, brightness)) : 100,
      excludedHosts: Array.isArray(value.excludedHosts)
        ? [...new Set(value.excludedHosts.filter((host) => typeof host === "string").map((host) => host.toLowerCase()))]
        : []
    };
  }
  function site(url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      return parsed;
    } catch { return null; }
  }
  function isLocalHost(host) {
    return !host.includes(".") || host.startsWith("[") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|localdomain|lan|home|internal|intranet|corp|test)$/.test(host);
  }
  function canFetchResource(resource, page) {
    if (!resource || !page || resource.username || resource.password) return false;
    if (page.protocol === "https:" && resource.protocol === "http:") return false;
    // Public pages cannot use the extension as a bridge into local networks.
    return !isLocalHost(resource.hostname) || isLocalHost(page.hostname);
  }
  return Object.freeze({ defaults, normalize, site, canFetchResource });
})();
