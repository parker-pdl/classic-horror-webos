# Classic Horror Movies — LG webOS TV app

Web-app build of the Classic Horror Movies channel, packaged for LG smart TVs
(webOS 3.0+). Same catalogue as the Roku channel — pulls from the same
`roku-feed.parkerdatalinktv.workers.dev/feed.json`, so editing that feed
updates this app too, no rebuild needed.

## What's in this build

- `index.html` / `css/` / `js/` — the app itself. Adapted from the existing
  Free Classic Movies & TV web app (`fcm-web`), retitled and repointed at
  the horror feed.
- `js/webos-remote.js` — new. Maps the LG remote's dedicated Back button
  (keyCode 461) to the same close behavior the web app already has on
  Escape, and makes sure the D-pad always has something focused to start
  from.
- `appinfo.json` — the webOS app manifest (id, icons, splash screen).
- `icons/` — app icon and splash image, generated from the existing
  Classic Horror artwork.

## Ads

Reuses the existing house-ad system instead of Google's IMA SDK (which has
no official webOS build and is unreliable there per LG's own dev forum).
Pre-roll bumper on features, mid-roll house spot on shorts — both already
built into the web app (`bumpersFor()` / `MIDROLL` in `app.js`), served from
the same `pdl-ads.parkerdatalinktv.workers.dev` worker the Roku channel
uses.

## Installing on a TV

Needs a dev-mode LG TV (or the webOS TV simulator) on the same network.

1. Put the TV in Developer Mode (LG Content Store → search "Developer
   Mode" → install → follow the on-screen setup, gives you a passphrase
   and IP address).
2. From a machine with Node installed:
   ```
   npm install -g @webosose/ares-cli
   ares-setup-device      # add the TV using its IP + passphrase
   ares-install com.parkerdatalink.classichorror_1.0.0_all.ipk -d <device-name>
   ares-launch com.parkerdatalink.classichorror -d <device-name>
   ```
3. The app shows up on the TV's launcher like any other app.

Dev Mode apps expire after 48 hours and need reinstalling — normal for
LG's developer program, not a bug. Submitting to the LG Content Store for
real (permanent) distribution is a separate, later step once this is
confirmed working on a real set.

## Status

Built and packaged (`.ipk`), not yet installed on an actual LG TV. Same
"untested on real hardware" caveat as the Roku channel — the web app itself
has been running fine in a browser, but LG's webOS browser engine can have
its own quirks worth checking on-device.
