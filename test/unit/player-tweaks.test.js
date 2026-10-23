import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakePlayer, loadPlayerTweaks, SITE_HEIGHTS, SITE_RATES } from "./fake-site.js";

// A page with one player whose metadata has loaded, with default settings.
function setup({ player = new FakePlayer(), settings = {}, ...env } = {}) {
  const page = loadPlayerTweaks({ players: [player], ...env });
  page.settings(settings);
  player.loadMetadata();
  return { page, player };
}

const enabledHeights = (player) => player.levels.filter((l) => l.enabled).map((l) => l.height);

describe("startup", () => {
  test("asks the bridge for settings and does nothing until they arrive", () => {
    const player = new FakePlayer();
    player.loadMetadata();
    player.startPlaying();
    const page = loadPlayerTweaks({ players: [player] });
    assert.equal(page.reported.requests, 1);
    page.tick();
    assert.equal(player.autoplayClicks, 0);
    assert.equal(player.playbackRate(), 1);
    assert.deepEqual(player.qualityCalls, []);
    assert.equal(player.muted(), true);
  });

  test("ignores players without the fkplayer class when a main player exists", () => {
    const main = new FakePlayer();
    const other = new FakePlayer();
    other.classes.delete("fkplayer");
    other.loadMetadata();
    const page = loadPlayerTweaks({ players: [main, other] });
    page.settings();
    main.loadMetadata();
    page.tick();
    assert.equal(main.playbackRate(), 1.5);
    assert.equal(other.playbackRate(), 1);
  });
});

describe("auto play next video", () => {
  test("is turned off by clicking the site's toggle button", () => {
    const { page, player } = setup();
    page.tick();
    assert.equal(player.autoplayEnabled, false);
    assert.equal(player.autoplayClicks, 1);
  });

  test("is left alone when already off", () => {
    const player = new FakePlayer();
    player.autoplayEnabled = false;
    const { page } = setup({ player });
    page.tick();
    assert.equal(player.autoplayClicks, 0);
  });

  test("waits for the toggle button to be added", () => {
    const player = new FakePlayer();
    player.hasAutoplayButton = false;
    const { page } = setup({ player });
    page.tick();
    assert.equal(player.autoplayEnabled, true);
    player.hasAutoplayButton = true;
    page.tick();
    assert.equal(player.autoplayEnabled, false);
  });

  test("is not touched again on the same player after the user turns it back on", () => {
    const { page, player } = setup();
    page.tick();
    player.autoplayEnabled = true; // user clicks the toggle
    player.state.src = "https://vod.test/next/master.m3u8"; // next video, same player
    page.tick();
    assert.equal(player.autoplayEnabled, true);
  });

  test("is not touched when the feature is off", () => {
    const { page, player } = setup({ settings: { disableAutoplayNext: false } });
    page.tick();
    assert.equal(player.autoplayEnabled, true);
  });
});

describe("quality", () => {
  test("defaults to the highest available on desktop and updates the menu", () => {
    const { page, player } = setup();
    page.tick();
    assert.deepEqual(player.qualityCalls, [1080]);
    assert.deepEqual(enabledHeights(player), [1080]);
    assert.deepEqual(player.menuItems.filter((i) => i.isSelected).map((i) => i.options_.value), [1080]);
  });

  for (const [wanted, expected] of [
    [720, 720],
    [480, 480],
    [900, 720], // not offered: closest lower
    [2160, 1080], // higher than anything offered: closest lower is the top one
    [144, 240], // lower than anything offered: the lowest
  ]) {
    test(`chosen ${wanted}p plays ${expected}p`, () => {
      const { page, player } = setup({ settings: { quality: wanted } });
      page.tick();
      assert.deepEqual(player.qualityCalls, [expected]);
    });
  }

  test("waits for metadata and quality levels", () => {
    const player = new FakePlayer({ heights: [] });
    const page = loadPlayerTweaks({ players: [player] });
    page.settings();
    page.tick(); // no metadata yet
    player.loadMetadata();
    page.tick(); // no levels yet
    assert.deepEqual(player.qualityCalls, []);
    player.levels = SITE_HEIGHTS.map((height) => ({ height, enabled: true }));
    page.tick();
    assert.deepEqual(player.qualityCalls, [1080]);
  });

  test("waits for the quality plugin to initialise", () => {
    const player = new FakePlayer();
    const plugin = player.farakavQualitySelector;
    player.farakavQualitySelector = function farakavQualitySelector() {}; // plugin factory, before init
    const { page } = setup({ player });
    page.tick();
    assert.deepEqual(player.qualityCalls, []);
    player.farakavQualitySelector = plugin;
    page.tick();
    assert.deepEqual(player.qualityCalls, [1080]);
  });

  test("is not changed again if the user picks another quality", () => {
    const { page, player } = setup();
    page.tick();
    player.farakavQualitySelector.currentLevel = 360; // user choice
    page.tick();
    assert.deepEqual(player.qualityCalls, [1080]);
  });

  test("is not touched when the feature is off", () => {
    const { page, player } = setup({ settings: { customQuality: false } });
    page.tick();
    assert.deepEqual(player.qualityCalls, []);
  });

  describe("on Android (native switch)", () => {
    test("switches to the variant playlist and keeps the speed after the reload", () => {
      const { page, player } = setup({ player: new FakePlayer({ native: true }) });
      page.tick(); // quality switch resets the rate to the default rate
      assert.deepEqual(player.qualityCalls, [1080]);
      assert.match(player.currentSrc(), /index-1080\.m3u8$/);
      page.tick();
      assert.equal(player.playbackRate(), 1.5);
      assert.equal(player.defaultPlaybackRate(), 1.5);
    });

    test("resumes playback after the reload if the video was playing", () => {
      const player = new FakePlayer({ native: true });
      player.startPlaying();
      const { page } = setup({ player });
      page.tick();
      assert.equal(player.paused(), true);
      player.loadMetadata();
      assert.equal(player.paused(), false);
    });

    test("treats the switched source as the same video", () => {
      const { page, player } = setup({ player: new FakePlayer({ native: true }) });
      page.tick();
      page.tick();
      page.tick();
      assert.deepEqual(player.qualityCalls, [1080]);
    });
  });
});

describe("speed", () => {
  test("defaults to 1.5x and sets the default rate too", () => {
    const { page, player } = setup();
    page.tick();
    assert.equal(player.playbackRate(), 1.5);
    assert.equal(player.defaultPlaybackRate(), 1.5);
  });

  test("uses the chosen speed", () => {
    const { page, player } = setup({ settings: { speed: 2 } });
    page.tick();
    assert.equal(player.playbackRate(), 2);
  });

  test("refuses a speed the player doesn't offer", () => {
    const { page, player } = setup({ settings: { speed: 3 } });
    page.tick();
    assert.equal(player.playbackRate(), 1);
    assert.match(page.warnings.join("\n"), /speed 3 is not offered/);
  });

  test("waits for metadata", () => {
    const player = new FakePlayer();
    const page = loadPlayerTweaks({ players: [player] });
    page.settings();
    page.tick();
    assert.equal(player.playbackRate(), 1);
    player.loadMetadata();
    page.tick();
    assert.equal(player.playbackRate(), 1.5);
  });

  test("is not changed again if the user picks another speed", () => {
    const { page, player } = setup();
    page.tick();
    player.playbackRate(1.25); // user choice
    page.tick();
    assert.equal(player.playbackRate(), 1.25);
  });

  test("is not touched when the feature is off", () => {
    const { page, player } = setup({ settings: { customSpeed: false } });
    page.tick();
    assert.equal(player.playbackRate(), 1);
  });
});

describe("sound", () => {
  test("is turned on once the video plays", () => {
    const { page, player } = setup();
    page.tick();
    assert.equal(player.muted(), true, "not before playback starts");
    player.startPlaying();
    page.tick();
    assert.equal(player.muted(), false);
  });

  test("sets the volume when it is zero", () => {
    const player = new FakePlayer();
    player.volume(0);
    player.startPlaying();
    const { page } = setup({ player });
    page.tick();
    assert.equal(player.volume(), 1);
  });

  test("waits for the first user interaction when the browser blocks audible autoplay", () => {
    const player = new FakePlayer();
    player.startPlaying();
    const { page } = setup({ player, policy: "allowed-muted", activated: false });
    page.tick();
    assert.equal(player.muted(), true);
    page.userGesture("pointerdown");
    assert.equal(player.muted(), false);
  });

  test("goes back to muted playback if unmuting gets the video paused", () => {
    const player = new FakePlayer();
    player.startPlaying();
    const { page } = setup({ player });
    page.tick();
    assert.equal(player.muted(), false);
    player.state.paused = true; // browser blocked audible playback
    page.runTimeouts();
    assert.equal(player.muted(), true);
    assert.equal(player.paused(), false);
    page.userGesture("keydown");
    assert.equal(player.muted(), false);
  });

  test("stays on when the video simply ended right after unmuting", () => {
    const player = new FakePlayer();
    player.startPlaying();
    const { page } = setup({ player });
    page.tick();
    player.state.paused = true;
    player.state.ended = true;
    page.runTimeouts();
    assert.equal(player.muted(), false);
    assert.equal(player.playCalls, 0);
  });

  test("is not touched when the feature is off", () => {
    const player = new FakePlayer();
    player.startPlaying();
    const { page } = setup({ player, settings: { unmute: false } });
    page.tick();
    assert.equal(player.muted(), true);
  });
});

describe("ads", () => {
  for (const adClass of ["vjs-ad-playing", "vjs-ad-loading"]) {
    test(`nothing but the autoplay toggle is applied during ${adClass}`, () => {
      const player = new FakePlayer();
      player.classes.add(adClass);
      player.startPlaying();
      const { page } = setup({ player });
      page.tick();
      assert.equal(player.playbackRate(), 1);
      assert.deepEqual(player.qualityCalls, []);
      assert.equal(player.muted(), true);
      assert.equal(player.autoplayEnabled, false);

      player.classes.delete(adClass);
      page.tick();
      assert.equal(player.playbackRate(), 1.5);
      assert.deepEqual(player.qualityCalls, [1080]);
      assert.equal(player.muted(), false);
    });
  }
});

describe("settings changes", () => {
  test("a new speed is applied to the current video", () => {
    const { page, player } = setup();
    page.tick();
    page.settings({ speed: 1.25 });
    page.tick();
    assert.equal(player.playbackRate(), 1.25);
  });

  test("a new quality is applied to the current video", () => {
    const { page, player } = setup();
    page.tick();
    page.settings({ quality: 480 });
    page.tick();
    assert.deepEqual(player.qualityCalls, [1080, 480]);
  });

  test("turning a feature off doesn't undo it", () => {
    const { page, player } = setup();
    page.tick();
    page.settings({ customSpeed: false, disableAutoplayNext: false });
    page.tick();
    assert.equal(player.playbackRate(), 1.5);
    assert.equal(player.autoplayEnabled, false);
  });

  test("turning the autoplay feature back on turns the toggle off again", () => {
    const { page, player } = setup();
    page.tick();
    player.autoplayEnabled = true; // user turned it back on
    page.settings({ disableAutoplayNext: false });
    page.settings({ disableAutoplayNext: true });
    page.tick();
    assert.equal(player.autoplayEnabled, false);
  });

  test("unrelated changes don't re-apply a feature", () => {
    const { page, player } = setup();
    page.tick();
    player.playbackRate(1.25); // user choice
    page.settings({ quality: 720 });
    page.tick();
    assert.equal(player.playbackRate(), 1.25);
  });

  test("invalid settings messages are ignored", () => {
    const player = new FakePlayer();
    player.loadMetadata();
    const page = loadPlayerTweaks({ players: [player] });
    page.sendRawSettings("{not json");
    page.tick();
    assert.equal(player.playbackRate(), 1);
    page.settings({ speed: 2 });
    page.sendRawSettings("{not json");
    page.tick();
    assert.equal(player.playbackRate(), 2, "a bad message doesn't replace good settings");
  });
});

describe("new videos", () => {
  test("per-video features are applied again when the source changes", () => {
    const { page, player } = setup();
    page.tick();
    player.playbackRate(1);
    player.farakavQualitySelector.currentLevel = "auto";
    player.state.src = "https://vod.test/next/master.m3u8";
    page.tick();
    assert.equal(player.playbackRate(), 1.5);
    assert.deepEqual(player.qualityCalls, [1080, 1080]);
  });

  test("a player created later is handled too", () => {
    const first = new FakePlayer();
    const page = loadPlayerTweaks({ players: [first] });
    page.settings();
    first.loadMetadata();
    page.tick();
    first.disposed = true;
    const second = new FakePlayer({ src: "https://vod.test/next/master.m3u8" });
    page.players.push(second);
    second.loadMetadata();
    page.tick();
    assert.equal(second.playbackRate(), 1.5);
    assert.equal(second.autoplayEnabled, false);
  });
});

describe("reporting to the options page", () => {
  test("reports the player's speeds and the video's qualities once", () => {
    const { page } = setup();
    page.tick();
    page.tick();
    assert.deepEqual(page.reported.rates, [SITE_RATES]);
    assert.deepEqual(page.reported.qualities, [SITE_HEIGHTS]);
  });

  test("reports qualities again when a video offers different ones", () => {
    const { page } = setup({ player: new FakePlayer({ heights: [720, 360] }) });
    page.tick();
    const next = new FakePlayer({ heights: [1080, 720] });
    next.loadMetadata();
    page.players.splice(0, 1, next);
    page.tick();
    assert.deepEqual(page.reported.qualities, [[720, 360], [1080, 720]]);
  });
});
