# Tests

```sh
npm install          # once
npm run check        # lint + unit tests (fast, offline): run before every commit
npm run test:e2e     # real Firefox on the live site, desktop and Android modes
```

## Unit tests (`test/unit/`)

`npm test` runs `player-tweaks.js` and `settings-bridge.js` in Node against a fake page and a
fake player (`fake-site.js`). The fake player copies the parts of the site's player the add-on
relies on: the `farakavQualitySelector` plugin (desktop and Android modes), the
`AutoplayToggleButton`, ad classes and the standard Video.js methods. No browser or network
is needed.

When the add-on's behaviour changes, update or add a test here. When the site changes its
player, update `FakePlayer` to match it first.

## End-to-end tests (`test/e2e/`)

`npm run test:e2e` builds the add-on and installs it in headless Firefox, then checks on a real
video page that each feature works and that the options page works. It runs once as desktop
Firefox and once with an Android user agent, which makes the site's player use its Android
quality switching. These tests are the ones that catch changes on the site itself.

Requirements: network access, Firefox, and geckodriver. With the snap Firefox, the snap's
geckodriver is used automatically. Environment variables:

| Variable | Purpose |
|---|---|
| `FIREFOX_BIN` | Firefox binary to use |
| `GECKODRIVER` | geckodriver binary to use |
| `V3_TEST_URL` | Video page to test (the default sample clip may be removed one day) |
| `HEADFUL=1` | Show the browser window |

The site sometimes loads a page without creating a player, with or without the add-on, so the
tests reload the page up to three times before failing.
