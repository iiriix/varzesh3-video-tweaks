// Runs in the page's own JS world (manifest "world": "MAIN") so it can drive
// the site's Video.js player ("fkplayer") and its custom plugins directly:
//   - player.farakavQualitySelector  quality plugin instance (setQuality(height | "auto"))
//   - AutoplayToggleButton           "auto play next video" control-bar button
//   - player.autoplayEnabled         state behind that button
// The site is a Next.js SPA that creates a new player per video, so we poll
// for players instead of hooking a single page load.
// Settings arrive from settings-bridge.js (see the event names there).
(() => {
  "use strict";

  const TICK_MS = 500;

  let settings = null; // null until the bridge answers; nothing runs before that
  // Bumped when a feature's setting changes, so it is re-applied to the
  // current video. A feature is done for a video when done[feature] === gen.
  const generation = { unmute: 0, disableAutoplayNext: 0, customQuality: 0, customSpeed: 0 };
  // Settings that belong to a feature besides its on/off flag.
  const featureValue = { customQuality: "quality", customSpeed: "speed" };
  let reportedRates = "";
  let reportedQualities = "";

  // Per-player state. `key` identifies the current video so per-video steps
  // re-run if a player is reused for a different video.
  const states = new WeakMap();

  window.addEventListener("varzesh3-tweaks:settings", (event) => {
    let next;
    try {
      next = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (settings) {
      for (const feature of Object.keys(generation)) {
        const value = featureValue[feature];
        const changed = next[feature] !== settings[feature] || (value && next[value] !== settings[value]);
        if (changed) generation[feature]++;
      }
    }
    settings = next;
  });
  window.dispatchEvent(new CustomEvent("varzesh3-tweaks:request"));

  function getPlayers() {
    const vjs = window.videojs;
    if (!vjs) return [];
    const all = (typeof vjs.getAllPlayers === "function"
      ? vjs.getAllPlayers()
      : Object.values(vjs.players || {})
    ).filter((p) => p && !p.isDisposed());
    // Main players carry the "fkplayer" class; skip anything else (e.g. ad players).
    const main = all.filter((p) => p.hasClass("fkplayer"));
    return main.length ? main : all;
  }

  function inAd(player) {
    return player.hasClass("vjs-ad-playing") || player.hasClass("vjs-ad-loading");
  }

  function playerRates(player) {
    const rates = typeof player.playbackRates === "function" ? player.playbackRates() : player.options_.playbackRates;
    return Array.isArray(rates) ? rates.filter((r) => typeof r === "number") : [];
  }

  function reportRates(player) {
    const json = JSON.stringify(playerRates(player).slice().sort((a, b) => a - b));
    if (json === "[]" || json === reportedRates) return;
    reportedRates = json;
    window.dispatchEvent(new CustomEvent("varzesh3-tweaks:rates", { detail: json }));
  }

  // Heights offered for the current video, or [] while they're still loading.
  function availableHeights(player) {
    const qs = player.farakavQualitySelector;
    // Before the plugin runs, this property is the plugin factory function.
    if (!qs || typeof qs.setQuality !== "function") return [];
    let heights;
    if (qs.usesNativeQualitySwitch()) { // Android / iOS / desktop Safari
      heights = (qs.playlists || []).map((pl) => pl.attributes && pl.attributes.RESOLUTION && pl.attributes.RESOLUTION.height);
    } else {
      const levels = player.qualityLevels ? player.qualityLevels() : [];
      heights = Array.from({ length: levels.length }, (_, i) => levels[i].height);
    }
    return heights.filter((h) => typeof h === "number" && h > 0);
  }

  function reportQualities(player) {
    if (player.readyState() < 1) return;
    const json = JSON.stringify([...new Set(availableHeights(player))].sort((a, b) => b - a));
    if (json === "[]" || json === reportedQualities) return;
    reportedQualities = json;
    window.dispatchEvent(new CustomEvent("varzesh3-tweaks:qualities", { detail: json }));
  }

  function videoKey(player) {
    // On Android the quality plugin swaps src to a variant playlist but keeps
    // the master URL in actualSource, so prefer it to keep the key stable.
    const qs = player.farakavQualitySelector;
    return (qs && qs.actualSource) || player.currentSrc() || "";
  }

  // Each step returns true once it has done its job for the current video.

  function disableAutoplayNext(player) {
    const btn = player.controlBar && player.controlBar.getChild("AutoplayToggleButton");
    if (!btn) return false; // plugin not attached (yet)
    // Click through the button so its icon updates and the site's persist
    // plugin stores the choice in localStorage.
    if (player.autoplayEnabled) btn.handleClick();
    return true;
  }

  // The chosen height, or the closest lower one this video offers (the lowest
  // offered if all are higher). "highest" picks the top one.
  function targetHeight(heights) {
    const wanted = settings.quality;
    if (wanted === "highest") return Math.max(...heights);
    const lower = heights.filter((h) => h <= wanted);
    return lower.length ? Math.max(...lower) : Math.min(...heights);
  }

  function selectQuality(player, s) {
    if (inAd(player) || player.readyState() < 1) return false;
    const heights = availableHeights(player);
    if (!heights.length) return false; // plugin, levels or playlists not loaded yet

    const qs = player.farakavQualitySelector;
    const native = qs.usesNativeQualitySwitch();
    const best = targetHeight(heights);
    if (qs.currentLevel === best) return true;

    const wasPlaying = !player.paused();
    qs.setQuality(best);
    if (native) {
      // Native switch reloads the source: resume playback and re-apply speed.
      delete s.done.customSpeed;
      if (wasPlaying) player.one("loadedmetadata", () => player.play());
    } else if (qs._qualityButton && qs._qualityButton.items) {
      qs._qualityButton.items.forEach((item) => item.selected(item.options_.value === best));
    }
    return true;
  }

  function setPlaybackRate(player) {
    if (inAd(player) || player.readyState() < 1) return false;
    const rate = settings.speed;
    const rates = playerRates(player);
    if (rates.length && !rates.includes(rate)) {
      console.warn("[varzesh3-video-tweaks] speed", rate, "is not offered by the player:", rates);
      return true;
    }
    // defaultPlaybackRate survives source reloads (e.g. quality switches).
    player.defaultPlaybackRate(rate);
    player.playbackRate(rate);
    return true;
  }

  function unmuteOnUserGesture(player) {
    const events = ["pointerdown", "pointerup", "touchend", "keydown", "click"];
    const handler = () => {
      events.forEach((e) => document.removeEventListener(e, handler, true));
      if (player.isDisposed()) return;
      player.muted(false);
      if (player.volume() === 0) player.volume(1);
    };
    events.forEach((e) => document.addEventListener(e, handler, true));
  }

  function unmute(player) {
    if (inAd(player) || player.paused()) return false;
    if (!player.muted() && player.volume() > 0) return true;

    // Without prior user interaction, the browser's autoplay policy may pause
    // a video that gets unmuted. In that case wait for the first interaction.
    const policy = navigator.getAutoplayPolicy ? navigator.getAutoplayPolicy("mediaelement") : "allowed";
    const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (policy !== "allowed" && !activated) {
      unmuteOnUserGesture(player);
      return true;
    }

    player.muted(false);
    if (player.volume() === 0) player.volume(1);
    setTimeout(() => {
      if (player.isDisposed() || !player.paused() || player.ended()) return;
      // Paused right after unmuting: the browser blocked audible playback.
      player.muted(true);
      const p = player.play();
      if (p && p.catch) p.catch(() => {});
      unmuteOnUserGesture(player);
    }, 300);
    return true;
  }

  const STEPS = {
    disableAutoplayNext,
    customQuality: selectQuality,
    customSpeed: setPlaybackRate,
    unmute,
  };

  function tick() {
    if (!settings) return;
    for (const player of getPlayers()) {
      reportRates(player);
      reportQualities(player);
      const key = videoKey(player);
      let s = states.get(player);
      if (!s || s.key !== key) {
        // The autoplay-next toggle belongs to the player, not the video.
        const keep = s && "disableAutoplayNext" in s.done ? { disableAutoplayNext: s.done.disableAutoplayNext } : {};
        s = { key, done: keep };
        states.set(player, s);
      }
      for (const [feature, step] of Object.entries(STEPS)) {
        if (!settings[feature] || s.done[feature] === generation[feature]) continue;
        try {
          if (step(player, s)) s.done[feature] = generation[feature];
        } catch (err) {
          console.warn("[varzesh3-video-tweaks]", feature, err);
        }
      }
    }
  }

  setInterval(tick, TICK_MS);
})();
