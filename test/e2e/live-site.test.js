// End-to-end tests on the live site in headless Firefox. They need network
// access, Firefox and geckodriver (see firefox.js), and can break when the
// site changes, which is what they're for. Run with `npm run test:e2e`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAddon, choose, clickPlayer, openOptions, openVideo, optionsUrl, playerState, selectOptions, startFirefox, waitForPlayer,
} from "./firefox.js";

const addon = buildAddon();
const max = (list) => Math.max(...list);

describe("desktop", () => {
  let driver, OPTIONS_URL;
  before(async () => {
    driver = await startFirefox(addon);
    OPTIONS_URL = await optionsUrl(driver);
  });
  after(async () => { await driver?.quit(); });

  test("applies the default settings to the site's player", async () => {
    await openVideo(driver);
    const state = await waitForPlayer(driver,
      (s) => s.heights.length > 0 && s.rate === 1.5 && s.autoplayEnabled === false && s.currentLevel === max(s.heights),
      { message: "speed 1.5, autoplay-next off and highest quality" });
    assert.equal(state.native, false);
    assert.deepEqual(state.enabledHeights, [max(state.heights)], "only the highest level is enabled");
  });

  test("turns the sound on at the first click", async () => {
    await clickPlayer(driver);
    await waitForPlayer(driver, (s) => s.muted === false, { message: "unmuted" });
  });

  test("options page lists the player's speeds and qualities", async () => {
    const state = await playerState(driver);
    await openOptions(driver, OPTIONS_URL);
    const speeds = await selectOptions(driver, "speed");
    assert.deepEqual(speeds.map((o) => Number(o.value)), [...state.rates].sort((a, b) => a - b));
    assert.equal(speeds.find((o) => o.selected).value, "1.5");
    const qualities = await selectOptions(driver, "quality");
    assert.equal(qualities[0].value, "highest");
    assert.equal(qualities.find((o) => o.selected).value, "highest");
    for (const h of state.heights) assert.ok(qualities.some((o) => o.value === String(h)), `${h}p is listed`);
  });

  test("changes made in the options page apply to an open video", async () => {
    await openVideo(driver);
    await waitForPlayer(driver, (s) => s.rate === 1.5, { message: "page ready" });
    const page = await driver.getWindowHandle();
    await driver.switchTo().newWindow("tab");
    await openOptions(driver, OPTIONS_URL);
    await choose(driver, "quality", "480");
    await choose(driver, "speed", "2");
    await driver.switchTo().window(page);
    const state = await waitForPlayer(driver, (s) => s.rate === 2 && s.currentLevel === 480, { message: "speed 2 and 480p" });
    assert.deepEqual(state.enabledHeights, [480]);
  });

  test("settings are kept for the next page load", async () => {
    await openVideo(driver);
    await waitForPlayer(driver, (s) => s.rate === 2 && s.currentLevel === 480, { message: "speed 2 and 480p after reload" });
  });

  test("features can be turned off", async () => {
    await openOptions(driver, OPTIONS_URL);
    for (const id of ["customSpeed", "customQuality"]) await driver.findElement({ id }).click();
    await openVideo(driver);
    await driver.sleep(3000); // give the add-on time to (wrongly) act
    const state = await waitForPlayer(driver, () => true);
    assert.equal(state.rate, 1);
    assert.equal(state.currentLevel, "auto");
  });
});

describe("android", () => {
  let driver, OPTIONS_URL;
  before(async () => {
    driver = await startFirefox(addon, { android: true });
    OPTIONS_URL = await optionsUrl(driver);
  });
  after(async () => { await driver?.quit(); });

  test("switches to the highest variant stream and keeps the speed", async () => {
    await openVideo(driver);
    const state = await waitForPlayer(driver,
      (s) => s.native && s.heights.length > 0 && s.currentLevel === max(s.heights) && s.rate === 1.5 && s.autoplayEnabled === false,
      { message: "native switch to highest quality at 1.5x" });
    assert.doesNotMatch(state.src, /master\.m3u8/, "source switched away from the master playlist");
    await waitForPlayer(driver, (s) => s.videoHeight === max(s.heights), { message: "video decoded at the highest height" });
  });

  test("a chosen quality is used", async () => {
    await openOptions(driver, OPTIONS_URL);
    await choose(driver, "quality", "720");
    await openVideo(driver);
    await waitForPlayer(driver, (s) => s.currentLevel === 720 && s.videoHeight === 720 && s.rate === 1.5,
      { message: "720p at 1.5x" });
  });
});
