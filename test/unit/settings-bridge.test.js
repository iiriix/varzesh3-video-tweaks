import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, fakeStorage, loadSettingsBridge, settle } from "./fake-site.js";

describe("settings bridge", () => {
  test("sends the defaults on load", async () => {
    const bridge = loadSettingsBridge();
    await settle();
    assert.deepEqual(bridge.sent, [DEFAULT_SETTINGS]);
  });

  test("sends stored settings merged over the defaults", async () => {
    const bridge = loadSettingsBridge(fakeStorage({ speed: 2, unmute: false }));
    await settle();
    assert.deepEqual(bridge.sent, [{ ...DEFAULT_SETTINGS, speed: 2, unmute: false }]);
  });

  test("answers a request from the page", async () => {
    const bridge = loadSettingsBridge();
    await settle();
    bridge.dispatch("varzesh3-tweaks:request");
    await settle();
    assert.equal(bridge.sent.length, 2);
  });

  test("re-sends when a setting changes, but not for the stored player lists", async () => {
    const bridge = loadSettingsBridge();
    await settle();
    await bridge.storage.local.set({ quality: 720 });
    await settle();
    assert.equal(bridge.sent.at(-1).quality, 720);
    await bridge.storage.local.set({ playerRates: [1, 2] });
    await settle();
    assert.equal(bridge.sent.length, 2);
  });

  describe("player speeds", () => {
    test("are stored", async () => {
      const bridge = loadSettingsBridge();
      bridge.dispatch("varzesh3-tweaks:rates", JSON.stringify([0.5, 1, 1.5]));
      await settle();
      assert.deepEqual(bridge.storage.data.playerRates, [0.5, 1, 1.5]);
    });

    for (const [name, detail] of [
      ["invalid JSON", "{"],
      ["not a list", JSON.stringify({ 0: 1 })],
      ["an empty list", "[]"],
      ["non-numbers", JSON.stringify([1, "2"])],
      ["out of range", JSON.stringify([1, 100])],
      ["zero", JSON.stringify([0, 1])],
    ]) {
      test(`are rejected when ${name}`, async () => {
        const bridge = loadSettingsBridge();
        bridge.dispatch("varzesh3-tweaks:rates", detail);
        await settle();
        assert.equal(bridge.storage.data.playerRates, undefined);
      });
    }
  });

  describe("video qualities", () => {
    test("are merged with the ones seen before, highest first", async () => {
      const bridge = loadSettingsBridge(fakeStorage({ playerQualities: [720, 360] }));
      bridge.dispatch("varzesh3-tweaks:qualities", JSON.stringify([1080, 720, 480]));
      await settle();
      assert.deepEqual(bridge.storage.data.playerQualities, [1080, 720, 480, 360]);
    });

    test("don't trigger a write when nothing is new", async () => {
      const storage = fakeStorage({ playerQualities: [1080, 720] });
      let writes = 0;
      storage.onChanged.addListener(() => writes++);
      const bridge = loadSettingsBridge(storage);
      bridge.dispatch("varzesh3-tweaks:qualities", JSON.stringify([720]));
      await settle();
      assert.equal(writes, 0);
    });

    for (const [name, detail] of [
      ["invalid JSON", "nope"],
      ["fractions", JSON.stringify([720.5])],
      ["negative", JSON.stringify([-1])],
      ["too large", JSON.stringify([100000])],
      ["strings", JSON.stringify(["1080"])],
    ]) {
      test(`are rejected when ${name}`, async () => {
        const bridge = loadSettingsBridge();
        bridge.dispatch("varzesh3-tweaks:qualities", detail);
        await settle();
        assert.equal(bridge.storage.data.playerQualities, undefined);
      });
    }
  });
});
