# Android app (Trusted Web Activity)

MOON GRAVITY is a PWA (manifest + service worker, fullscreen landscape, offline start).
To ship it as an Android app from the Play Store, wrap the deployed site in a
Trusted Web Activity with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap):

1. Deploy the site to Netlify (Git or CLI deploy — see the main README) and note its
   URL, e.g. `https://moon-gravity.netlify.app`.
2. Replace `YOUR-SITE.netlify.app` in `twa-manifest.json` with that host (or let
   Bubblewrap generate the file: `bubblewrap init --manifest https://<host>/manifest.webmanifest`).
3. Install the tooling (JDK 17 + Android SDK are downloaded on first run):
   ```sh
   npm i -g @bubblewrap/cli
   cd twa
   bubblewrap build          # creates android.keystore on first run, outputs app-release-signed.apk / .aab
   ```
4. Digital Asset Links — let Android trust the site so the app runs without the URL bar:
   ```sh
   bubblewrap fingerprint list   # or: keytool -list -v -keystore android.keystore
   ```
   Put the SHA-256 fingerprint into `public/.well-known/assetlinks.json`
   (replace `REPLACE_WITH_YOUR_SIGNING_KEY_SHA256_FINGERPRINT`; if you use Play App
   Signing, add the Play signing key fingerprint too) and redeploy.
5. Install `app-release-signed.apk` on a device (`adb install`) or upload the `.aab`
   to the Play Console.

The app opens `/?source=twa` in fullscreen landscape. Multiplayer, profile and settings
work exactly as on the web (they live in the site's storage).
