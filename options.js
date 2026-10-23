"use strict";

const storage = browser.storage.local;
const FLAGS = ["unmute", "disableAutoplayNext", "customQuality", "customSpeed"];
// Each dropdown and the checkbox that enables it.
const SELECTS = { quality: "customQuality", speed: "customSpeed" };
const status = document.getElementById("status");
let statusTimer;

function showStatus(text) {
  status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.textContent = ""), 1500);
}

function select(name) {
  return document.getElementById(name);
}

async function load() {
  const settings = await storage.get(DEFAULT_SETTINGS);
  const { playerRates, playerQualities } = await storage.get(["playerRates", "playerQualities"]);
  const rates = Array.isArray(playerRates) && playerRates.length ? playerRates : FALLBACK_PLAYER_RATES;
  const heights = Array.isArray(playerQualities) && playerQualities.length ? playerQualities : FALLBACK_PLAYER_QUALITIES;

  // Fall back to the default when a saved value is no longer offered by the player.
  if (!rates.includes(settings.speed)) {
    settings.speed = rates.includes(DEFAULT_SETTINGS.speed) ? DEFAULT_SETTINGS.speed : 1;
    await storage.set({ speed: settings.speed });
  }
  if (settings.quality !== "highest" && !heights.includes(settings.quality)) {
    settings.quality = DEFAULT_SETTINGS.quality;
    await storage.set({ quality: settings.quality });
  }

  select("speed").replaceChildren(...rates.map((r) => new Option(r === 1 ? "1x (normal)" : `${r}x`, String(r))));
  select("quality").replaceChildren(
    new Option("Highest available", "highest"),
    ...heights.map((h) => new Option(`${h}p`, String(h))),
  );
  for (const name of Object.keys(SELECTS)) {
    select(name).value = String(settings[name]);
    select(name).disabled = !settings[SELECTS[name]];
  }
  for (const flag of FLAGS) document.getElementById(flag).checked = settings[flag];
}

for (const flag of FLAGS) {
  document.getElementById(flag).addEventListener("change", async (e) => {
    await storage.set({ [flag]: e.target.checked });
    for (const [name, enabledBy] of Object.entries(SELECTS)) {
      if (enabledBy === flag) select(name).disabled = !e.target.checked;
    }
    showStatus("Saved");
  });
}

select("speed").addEventListener("change", async (e) => {
  await storage.set({ speed: Number(e.target.value) });
  showStatus("Saved");
});

select("quality").addEventListener("change", async (e) => {
  const value = e.target.value;
  await storage.set({ quality: value === "highest" ? value : Number(value) });
  showStatus("Saved");
});

load();
