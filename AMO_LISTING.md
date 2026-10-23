# addons.mozilla.org listing

Copy these into the AMO submission form.

**Name:** Video Tweaks for Varzesh3

**Summary** (max 250 chars):
> Makes videos on video.varzesh3.com play the way you want: sound on, no auto play of the next video, highest quality, and your preferred speed (1.5x by default). Each option can be turned off.

**Categories:** Firefox: *Photos, Music & Videos*. Firefox for Android: *Photos & Media*.

**Tags:** video, playback speed, quality, autoplay

**License:** MIT

**Description:**
> Video Tweaks for Varzesh3 changes the default behaviour of the video player on video.varzesh3.com.
>
> What it does, automatically:
> • Turns the sound on when a video starts. The site starts videos muted.
> • Turns off "auto play next video".
> • Selects the highest available quality (for example 1080p) instead of Auto, or a quality you choose.
> • Sets the playback speed. The default is 1.5x, and you can choose any speed the player offers (0.5x–2x).
>
> Each feature can be switched on or off in the add-on's preferences. Works in Firefox on desktop and on Android.
>
> About sound: Firefox doesn't let a page unmute a video until you have interacted with it. If you
> haven't, the sound turns on at your first tap or click on the page. To get sound without any
> interaction, set Autoplay to "Allow Audio and Video" for the site in Firefox's site permissions.
>
> This add-on is not affiliated with or endorsed by Varzesh3.

**Privacy:** the add-on collects and sends no data. It runs only on `https://video.varzesh3.com/*`
and stores its settings locally with `storage.local`. The manifest declares
`data_collection_permissions: none`, so AMO doesn't require a privacy policy.

**Notes to reviewer:**
> - No build step, minification or remote code. All files are plain, hand-written JS.
> - `player-tweaks.js` runs with `"world": "MAIN"` because it has to call the site's Video.js player
>   and its plugins (`window.videojs`, `player.farakavQualitySelector`, the `AutoplayToggleButton`
>   component). Those objects aren't reachable from the isolated world.
> - `settings-bridge.js` (isolated world) reads `storage.local` and passes the settings to the MAIN-world
>   script with DOM CustomEvents. Data coming back from the page (the player's speed list) is validated
>   before it is stored.
> - The site is a single-page app that creates a new player per video, so the script checks for
>   players every 500 ms.
> - Test page: https://video.varzesh3.com/video/566419/ . Open it, click the video, and check that the
>   sound is on, the speed is 1.5x, quality is 1080p (gear icon), and the "auto play next" toggle in the
>   control bar is off.
