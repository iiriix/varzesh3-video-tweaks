// Options for `web-ext build|sign|lint|run` (https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
export default {
  ignoreFiles: [
    "README.md",
    "AMO_LISTING.md",
    "LICENSE",
    "web-ext-config.mjs",
    "package.json",
    "package-lock.json",
    "test",
    "icons/icon.svg",
    "*.xpi",
  ],
  build: {
    overwriteDest: true,
  },
};
