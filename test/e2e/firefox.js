// Headless Firefox with the add-on installed, for tests against the live site.
//
// Environment variables:
//   FIREFOX_BIN    Firefox binary (default: Selenium's choice; the snap's real
//                  binary is used automatically when Firefox is a snap)
//   GECKODRIVER    geckodriver binary (default: /snap/bin/geckodriver if present,
//                  otherwise Selenium Manager downloads one)
//   V3_TEST_URL    video page to test (default: a sample clip)
//   HEADFUL=1      show the browser window
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ADDON_ID = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;

export const VIDEO_URL = process.env.V3_TEST_URL || "https://video.varzesh3.com/video/566419/";
const ANDROID_UA = "Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0";
const SNAP_FIREFOX = "/snap/firefox/current/usr/lib/firefox/firefox";
const SNAP_GECKODRIVER = "/snap/bin/geckodriver";

// Packs the add-on the same way a release is built.
export function buildAddon() {
  const outDir = mkdtempSync(join(tmpdir(), "v3-tweaks-e2e-"));
  execFileSync(join(root, "node_modules/.bin/web-ext"), ["build", "--artifacts-dir", outDir, "--filename", "addon.xpi"], { cwd: root, stdio: "ignore" });
  return join(outDir, "addon.xpi");
}

// android: pretend to be Firefox for Android, which makes the site's quality
// plugin switch sources natively, like it does on a phone.
export async function startFirefox(addonPath, { android = false } = {}) {
  const options = new firefox.Options();
  if (!process.env.HEADFUL) options.addArguments("-headless");
  if (android) options.setPreference("general.useragent.override", ANDROID_UA);
  const binary = process.env.FIREFOX_BIN || (existsSync(SNAP_FIREFOX) ? SNAP_FIREFOX : null);
  if (binary) options.setBinary(binary);

  const driverPath = process.env.GECKODRIVER || (existsSync(SNAP_GECKODRIVER) ? SNAP_GECKODRIVER : null);
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  // System access lets the tests read the add-on's internal UUID (see optionsUrl).
  builder.setFirefoxService(new firefox.ServiceBuilder(driverPath || undefined).addArguments("--allow-system-access"));

  const driver = await builder.build();
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  await driver.installAddon(addonPath, true);
  return driver;
}

// The options page lives at moz-extension://<uuid>/, where Firefox picks the
// UUID at install time and records it in a browser pref.
export async function optionsUrl(driver) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    const uuids = JSON.parse(await driver.executeScript(
      "return Services.prefs.getStringPref('extensions.webextensions.uuids')"));
    return `moz-extension://${uuids[ADDON_ID]}/options.html`;
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

// Snapshot of the site's main player, or null while it doesn't exist yet.
export function playerState(driver) {
  return driver.executeScript(`
    const p = window.videojs && videojs.getAllPlayers().find((p) => p.hasClass("fkplayer") && !p.isDisposed());
    if (!p) return null;
    const qs = p.farakavQualitySelector;
    const levels = p.qualityLevels ? p.qualityLevels() : [];
    const all = Array.from({ length: levels.length }, (_, i) => levels[i]);
    const heights = qs && qs.usesNativeQualitySwitch && qs.usesNativeQualitySwitch()
      ? (qs.playlists || []).map((pl) => pl.attributes.RESOLUTION.height)
      : all.map((l) => l.height);
    return {
      native: !!(qs && qs.usesNativeQualitySwitch && qs.usesNativeQualitySwitch()),
      heights: heights.filter(Boolean),
      enabledHeights: all.filter((l) => l.enabled).map((l) => l.height),
      currentLevel: qs ? qs.currentLevel : null,
      src: p.currentSrc(),
      videoHeight: p.videoHeight(),
      rate: p.playbackRate(),
      rates: p.playbackRates(),
      muted: p.muted(),
      autoplayEnabled: p.autoplayEnabled,
    };
  `);
}

// Polls the player until `predicate(state)` is true; returns that state.
export async function waitForPlayer(driver, predicate, { timeout = 30000, message = "player condition" } = {}) {
  let last = null;
  try {
    await driver.wait(async () => {
      last = await playerState(driver);
      return last && predicate(last);
    }, timeout);
  } catch {
    const page = await driver.executeScript(`return {
      url: location.href,
      readyState: document.readyState,
      videojs: !!window.videojs,
      players: window.videojs ? videojs.getAllPlayers().map((p) => p.el() && p.el().className) : null,
      videoElements: document.querySelectorAll("video").length,
    };`).catch((err) => String(err));
    throw new Error(`Timed out waiting for ${message}. Last player state: ${JSON.stringify(last)}. Page: ${JSON.stringify(page)}`);
  }
  return last;
}

// Opens the video page and waits until the site's player has loaded its
// quality levels. The site occasionally loads without creating a player, or
// drops it right after creating it (seen with and without the add-on), so
// retry a couple of times before giving up.
export async function openVideo(driver, { attempts = 3 } = {}) {
  for (let i = 1; ; i++) {
    await driver.get(VIDEO_URL);
    try {
      return await waitForPlayer(driver, (s) => s.heights.length > 0, { timeout: 20000, message: "the site's player to load" });
    } catch (err) {
      if (i >= attempts) throw err;
    }
  }
}

// Opens the options page and waits until options.js has filled the dropdowns.
export async function openOptions(driver, url) {
  await driver.get(url);
  await driver.wait(async () => (await driver.findElements(By.css("#speed option"))).length > 0
    && (await driver.findElements(By.css("#quality option"))).length > 0, 10000);
}

// A real click on the player, which also counts as user interaction.
export async function clickPlayer(driver) {
  const el = await driver.findElement(By.css(".video-js"));
  await driver.actions().move({ origin: el }).click().perform();
}

export async function selectOptions(driver, id) {
  const select = await driver.findElement(By.id(id));
  const options = await select.findElements(By.css("option"));
  return Promise.all(options.map(async (o) => ({ value: await o.getAttribute("value"), text: await o.getText(), selected: await o.isSelected() })));
}

export async function choose(driver, id, value) {
  await driver.findElement(By.css(`#${id} option[value="${value}"]`)).click();
}
