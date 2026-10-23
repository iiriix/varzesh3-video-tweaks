// Runs in the extension's isolated world. player-tweaks.js runs in the page's
// world and can't use browser.storage, so this script relays between them
// with DOM events:
//   varzesh3-tweaks:request  page -> here   ask for the current settings
//   varzesh3-tweaks:settings here -> page   settings as a JSON string
//   varzesh3-tweaks:rates    page -> here   the player's playbackRates (JSON)
//   varzesh3-tweaks:qualities page -> here  the video's quality heights (JSON)
(() => {
  "use strict";

  const storage = browser.storage.local;

  async function sendSettings() {
    const settings = await storage.get(DEFAULT_SETTINGS);
    window.dispatchEvent(new CustomEvent("varzesh3-tweaks:settings", { detail: JSON.stringify(settings) }));
  }

  async function saveRates(event) {
    let rates;
    try {
      rates = JSON.parse(event.detail);
    } catch {
      return;
    }
    // The page can fire this event too, so only accept a sane list of numbers.
    if (!Array.isArray(rates) || !rates.length || !rates.every((r) => typeof r === "number" && r > 0 && r <= 16)) return;
    const { playerRates } = await storage.get("playerRates");
    if (JSON.stringify(playerRates) !== JSON.stringify(rates)) await storage.set({ playerRates: rates });
  }

  // Videos differ in which heights they offer, so keep every height seen.
  async function saveQualities(event) {
    let heights;
    try {
      heights = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (!Array.isArray(heights) || !heights.every((h) => Number.isInteger(h) && h > 0 && h <= 8640)) return;
    const { playerQualities = [] } = await storage.get("playerQualities");
    const merged = [...new Set([...playerQualities, ...heights])].sort((a, b) => b - a);
    if (merged.length !== playerQualities.length) await storage.set({ playerQualities: merged });
  }

  window.addEventListener("varzesh3-tweaks:request", sendSettings);
  window.addEventListener("varzesh3-tweaks:rates", saveRates);
  window.addEventListener("varzesh3-tweaks:qualities", saveQualities);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((k) => k in DEFAULT_SETTINGS)) sendSettings();
  });
  sendSettings();
})();
