// Shared by the options page and the settings bridge content script.
// eslint-disable-next-line no-unused-vars
const DEFAULT_SETTINGS = {
  unmute: true,
  disableAutoplayNext: true,
  customQuality: true,
  quality: "highest", // "highest" or a height in pixels, e.g. 720
  customSpeed: true,
  speed: 1.5,
};

// Heights the site's player offered when this was written. The content script
// adds every height it sees on a player to the stored `playerQualities` list.
// eslint-disable-next-line no-unused-vars
const FALLBACK_PLAYER_QUALITIES = [1080, 720, 480, 360, 240];

// Speeds the site's player offered when this was written (its `playbackRates`
// option). The content script replaces this with the live list, stored as
// `playerRates`, whenever it sees a player.
// eslint-disable-next-line no-unused-vars
const FALLBACK_PLAYER_RATES = [0.5, 1, 1.25, 1.5, 2];
