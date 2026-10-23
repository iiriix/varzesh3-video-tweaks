// Runs the add-on's content scripts in a Node vm context against a fake page
// and a fake Video.js player. The fake player copies the parts of the site's
// player ("fkplayer") that the add-on uses: the farakavQualitySelector plugin,
// the AutoplayToggleButton component and the standard Video.js methods.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const source = (file) => readFileSync(new URL(file, root), "utf8");

// Read through JSON so the objects belong to this realm (strict deep-equal
// compares prototypes, and vm contexts have their own Object/Array).
export const { DEFAULT_SETTINGS, FALLBACK_PLAYER_RATES, FALLBACK_PLAYER_QUALITIES } = JSON.parse(vm.runInContext(
  `${source("defaults.js")}\nJSON.stringify({ DEFAULT_SETTINGS, FALLBACK_PLAYER_RATES, FALLBACK_PLAYER_QUALITIES })`,
  vm.createContext({}),
));

export const SITE_HEIGHTS = [1080, 720, 480, 360, 240];
export const SITE_RATES = [0.5, 1, 1.25, 1.5, 2];

export class FakePlayer {
  // native: the quality plugin's Android/iOS mode, which switches the source
  // to a variant playlist instead of toggling qualityLevels().
  constructor({ native = false, heights = SITE_HEIGHTS, rates = SITE_RATES, src = "https://vod.test/566419/master.m3u8" } = {}) {
    this.native = native;
    this.classes = new Set(["video-js", "fkplayer"]);
    this.disposed = false;
    this.state = { muted: true, volume: 1, rate: 1, defaultRate: 1, paused: true, ended: false, readyState: 0, src };
    this.rates = rates;
    this.listeners = {};
    this.playCalls = 0;

    // AutoplayToggleButton (autoplayToggle plugin)
    this.autoplayEnabled = true;
    this.autoplayClicks = 0;
    this.hasAutoplayButton = true;
    const button = { handleClick: () => { this.autoplayClicks++; this.autoplayEnabled = !this.autoplayEnabled; } };
    this.controlBar = { getChild: (name) => (name === "AutoplayToggleButton" && this.hasAutoplayButton ? button : null) };

    // qualityLevels() and the desktop quality menu
    this.levels = heights.map((height) => ({ height, enabled: true }));
    this.menuItems = ["auto", ...heights].map((value) => ({
      options_: { value },
      isSelected: value === "auto",
      selected(on) { this.isSelected = on; },
    }));

    // farakavQualitySelector plugin instance
    this.qualityCalls = [];
    const plugin = {
      currentLevel: "auto",
      actualSource: native ? src : undefined,
      playlists: native ? heights.map((height) => ({ uri: `index-${height}.m3u8`, attributes: { RESOLUTION: { height } } })) : [],
      _qualityButton: native ? undefined : { items: this.menuItems },
      usesNativeQualitySwitch: () => native,
      setQuality: (height) => {
        this.qualityCalls.push(height);
        plugin.currentLevel = height;
        if (native) {
          // Like player.src(): a media load resets the rate to the default rate.
          this.state.src = `https://vod.test/566419/index-${height}.m3u8`;
          this.state.rate = this.state.defaultRate;
          this.state.paused = true;
        } else {
          for (const level of this.levels) level.enabled = level.height === height;
        }
      },
    };
    this.farakavQualitySelector = plugin;
  }

  // Test helpers
  loadMetadata() { this.state.readyState = 1; this.emit("loadedmetadata"); }
  startPlaying() { this.state.paused = false; this.state.ended = false; }
  emit(event) {
    const fns = this.listeners[event] || [];
    this.listeners[event] = [];
    fns.forEach((fn) => fn());
  }

  // Video.js API used by the add-on
  hasClass(name) { return this.classes.has(name); }
  isDisposed() { return this.disposed; }
  muted(value) { if (value === undefined) return this.state.muted; this.state.muted = value; }
  volume(value) { if (value === undefined) return this.state.volume; this.state.volume = value; }
  playbackRate(value) { if (value === undefined) return this.state.rate; this.state.rate = value; }
  defaultPlaybackRate(value) { if (value === undefined) return this.state.defaultRate; this.state.defaultRate = value; }
  playbackRates() { return this.rates; }
  paused() { return this.state.paused; }
  ended() { return this.state.ended; }
  readyState() { return this.state.readyState; }
  currentSrc() { return this.state.src; }
  qualityLevels() { return this.levels; }
  play() { this.playCalls++; this.state.paused = false; return Promise.resolve(); }
  one(event, fn) { (this.listeners[event] ||= []).push(fn); }
}

// Loads player-tweaks.js. `env` controls the browser autoplay policy and
// whether the user has interacted with the page.
export function loadPlayerTweaks({ players = [], policy = "allowed", activated = true } = {}) {
  const window = new EventTarget();
  window.videojs = { getAllPlayers: () => players };
  const document = new EventTarget();
  const env = { policy, activated };
  const navigator = {
    getAutoplayPolicy: () => env.policy,
    userActivation: { get hasBeenActive() { return env.activated; } },
  };

  let interval;
  const timeouts = [];
  const warnings = [];
  const reported = { requests: 0, rates: [], qualities: [] };
  window.addEventListener("varzesh3-tweaks:request", () => reported.requests++);
  window.addEventListener("varzesh3-tweaks:rates", (e) => reported.rates.push(JSON.parse(e.detail)));
  window.addEventListener("varzesh3-tweaks:qualities", (e) => reported.qualities.push(JSON.parse(e.detail)));

  const context = vm.createContext({
    window,
    document,
    navigator,
    CustomEvent,
    setInterval: (fn) => { interval = fn; },
    setTimeout: (fn) => { timeouts.push(fn); },
    console: { warn: (...args) => warnings.push(args.join(" ")) },
  });
  vm.runInContext(source("player-tweaks.js"), context);

  let current = null;
  return {
    players,
    env,
    reported,
    warnings,
    tick: () => interval(),
    // Sends settings like the bridge does; `overrides` are merged into the
    // previously sent settings (or the defaults on the first call).
    settings(overrides = {}) {
      current = { ...(current || DEFAULT_SETTINGS), ...overrides };
      window.dispatchEvent(new CustomEvent("varzesh3-tweaks:settings", { detail: JSON.stringify(current) }));
    },
    sendRawSettings(detail) {
      window.dispatchEvent(new CustomEvent("varzesh3-tweaks:settings", { detail }));
    },
    runTimeouts() { timeouts.splice(0).forEach((fn) => fn()); },
    userGesture(type = "pointerdown") { document.dispatchEvent(new Event(type)); },
  };
}

// In-memory browser.storage.local with onChanged events.
export function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  const listeners = [];
  const local = {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(data);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
      return Object.fromEntries(Object.entries(keys).map(([k, dflt]) => [k, k in data ? structuredClone(data[k]) : dflt]));
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = structuredClone(v);
      }
      listeners.forEach((fn) => fn(changes, "local"));
    },
  };
  return { data, local, onChanged: { addListener: (fn) => listeners.push(fn) } };
}

// Loads defaults.js + settings-bridge.js, as the manifest does.
export function loadSettingsBridge(storage = fakeStorage()) {
  const window = new EventTarget();
  const sent = [];
  window.addEventListener("varzesh3-tweaks:settings", (e) => sent.push(JSON.parse(e.detail)));
  const context = vm.createContext({
    window,
    CustomEvent,
    browser: { storage: { local: storage.local, onChanged: storage.onChanged } },
  });
  vm.runInContext(source("defaults.js"), context);
  vm.runInContext(source("settings-bridge.js"), context);
  return {
    storage,
    sent,
    dispatch(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); },
  };
}

// Lets pending promise callbacks (async storage calls) finish.
export const settle = () => new Promise((resolve) => setImmediate(resolve));
