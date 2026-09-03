# Temperatura — build plan

Companion to `Temperatura.md`. The spec says **what** the app does; this says **how the repo
is put together**, what gets ported from which reference project, and in what order to build.
Nothing here overrides the spec. Where the two disagree, the spec wins.

Reference material, all read before writing this:

| File | What it is | Used for |
| --- | --- | --- |
| `Temperatura.md` | the spec | behaviour |
| `FeatherThermometer.ino` | ESP32-S3 firmware | BLE packet format, button semantics |
| `ride-the-wind-main.zip` | Ride the Wind (RTW) | repo shape, tests, storage, keep-alive, back guard |
| `ble-hr-tool-main.zip` | Manawa Pace | Web Bluetooth connect/reconnect, alert routing, SW notifications |

---

## 1. Scaffold

Same stack as RTW: Vite 6 + React 18, no TypeScript, no test framework, no CSS framework.

Copy from RTW **verbatim or near-verbatim**:

- `package.json` — same four scripts. Keep the test runner as
  `for f in test*.mjs; do node "$f" || exit 1; done`. Rename, reset version to `0.1.0`.
- `vite.config.js` — `base: "/"`, react plugin. Unchanged.
- `.gitignore` — unchanged (`node_modules/`, `dist/`, `.env.production`, `.env.development`).
- `generate-env.mjs` — unchanged except the console line. It already reads
  `WORKERS_CI_COMMIT_SHA || CF_PAGES_COMMIT_SHA || GITHUB_SHA`, which is the Cloudflare
  Workers Builds variable. See §6 for the one change it *does* need.
- `wrangler.jsonc` — change `name`, bump `compatibility_date`. Keep
  `assets.directory: "./dist"`, `not_found_handling: "single-page-application"`,
  `compatibility_flags: ["nodejs_compat"]`, `observability.enabled: true`.
- `src/main.jsx` — SW registration and update flow, with one change (§6).
- `index.html` — structure, meta block, the `html, body, #root { height: 100dvh; overflow: hidden }`
  reset. Replace the dark `background: #111` with the light palette from the spec's Style section.

Do **not** copy RTW's `.github/workflows/deploy.yml`. That deploys to GitHub Pages and is the
source of the bug in §6. Cloudflare's Git integration replaces it.

Icons: generate `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` from
`temperatura-icon-2048px.png`. The maskable variant needs the safe-zone inset — the dial fills
almost the whole square, so it will get cropped by Android's mask without padding.

`manifest.webmanifest`: follow RTW's, but `background_color` and `theme_color` come from the
light palette (`#B1DCED`–`#5CAADB`), `orientation: "portrait"`, `display: "standalone"`.
No shortcuts for the MVP.

---

## 2. Module split

The rule from RTW: everything decidable is a pure module under `src/lib/`, tested in Node with
injected dependencies; the browser-only surfaces are thin adapters behind the same seam pattern
as `IndexedDBBackend` / `MemoryBackend`. `App.jsx` holds the UI and calls a controller.

### Pure logic — no DOM, no clock, no BLE

- **`recipe.js`** — recipe and step schema, validation, JSON import/export shaping.
  Rejects invalid combinations, notably a duration marked *in temperature band* with no
  temperature band defined.
- **`instances.js`** — the instance state machine. Start / Pause / Resume / Restart / Complete /
  Duplicate, tag names, and the in-band accumulator. Every quantity derived from stored epoch
  timestamps (`startedAt`, `pausedAt`, `accumulatedInBandMs`, `lastSampleAt`), never a tick
  counter, so recovery after the app is killed is just arithmetic. Owns the claim: which
  instance holds it, auto-acquisition at Start, release on Complete, the toggle, transfer.
- **`alarms.js`** — the evaluator. Given instance state plus a sample, returns which alarms
  fire, which re-arm, and which are silenced. Owns the 2 °C deadband and its re-arm rule, the
  one-shot/repeating logic, and the earliest-first silence queue. **Highest-value test target
  in the project.**
- **`provenance.js`** *(or fold into `instances.js`)* — measured vs assumed, and the four
  progress-bar states. This is derived per tick from three inputs: does this instance hold the
  claim, how long since the last packet, is the reading valid. Only the latched estimate flag is
  persisted, and it must survive recovery.
- **`format.js`** — durations, temperatures, elapsed/remaining strings. Port RTW's shape.

### Seams — pure core, thin platform adapter

- **`storage.js`** — copy RTW's `Backend` split wholesale. Same two backends
  (`IndexedDBBackend`, `MemoryBackend`), same injected-op pattern. New stores:

  | Store | Contents |
  | --- | --- |
  | `recipes` | recipe records |
  | `instances` | running and paused instances, incl. `latchedEstimate` |
  | `openSet` | which recipes are open (must persist — spec, Storage) |
  | `alarmThemes` | theme metadata |
  | `sounds` | decoded MP3 as ArrayBuffer, keyed by theme |
  | `settings` | key–value |

- **`thermometer.js`** — `WebBluetoothBackend` + `FakeThermometer`. Parses the 8-byte
  MEASUREMENT packet: little-endian, `seq` uint16, `temp` int16 in 0.01 °C with `0x8000`
  meaning no reading, `battery` uint8, `pressCount` uint8, `flags` bit0 probe present /
  bit1 button held. Owns press-count baselining (seed on every connect and reconnect, diff only
  within an unbroken stream) and the 5 s data-loss watchdog. The fake is what makes
  `testalarms.mjs` possible.
- **`alarmPlayer.js`** — `decodeAudioData` on the keep-alive `AudioContext`, gain node with
  `linearRampToValueAtTime` on the first pass, buffer looping until silenced, fallback to the
  synthesised default tone on any decode failure.
- **`notify.js`** — the client half of the notification protocol: post to the SW when hidden,
  `navigator.vibrate` when visible, 5 s re-post loop with a stable per-alarm tag, and receive
  silence messages back from `notificationclick`.

### Ported almost as-is

- **`useKeepAlive.js`** — from RTW, unchanged. The audio + MediaSession + wake-lock trio, with
  its comments about gain `0.001` and resuming a suspended context. This is the single most
  load-bearing file in the project and it is already proven on this platform.
- **`backGuard.js`** — from RTW, unchanged in mechanism. Its sentinel-buffer design and the
  reason it refills on user gestures rather than inside `popstate` (Chrome's history
  intervention marks gesture-less entries "skip on back/forward" across the whole
  same-document history) both apply here identically. Only `resolveBackAction()`'s ordering
  is app-specific — see §7.
- **`app.js`** — controller, following RTW's `createAppController({ backend, now, ... })`
  signature so the whole thing can be driven from tests with a memory backend, a fake clock and
  a fake thermometer.

### UI

`App.jsx` plus the three pages (home, recipe, step) and the settings/help/about panels. RTW keeps
this as one large file; that is fine, but split the settings panel out if it grows past a few
hundred lines, as RTW did with `HelpPanel.jsx`.

---

## 3. What to lift from Manawa Pace specifically

RTW has no BLE and no notifications. These come from `ble-hr-tool`:

- **Three-tier connect**, in the `connectBtn` click handler: live connection → `getDevices()`
  with three `gatt.connect()` attempts at 3 s spacing → `requestDevice()` picker last. Also the
  detail where a stale non-connected device reference is nulled before calling the picker,
  because some browsers block it while an abandoned reference is held.
- **Reconnect loop** — `handleDisconnect` / `startReconnect` / `attemptReconnect`, a bounded
  retry budget with a 3 s interval, nulling the device reference when the budget is exhausted.
- **Watchdog** — `resetTimeout()` sets a timer on every packet and disconnects if it expires.
  Manawa uses 3 s for a heart rate strap; Temperatura uses 5 s per the spec.
- **Alert routing** — `triggerNotification()`'s visible/hidden split and `_postSwNotify()`.
- **SW notification handler** — the `message` listener in `sw.js`, including the `_notifToken`
  stale-timer guard so an older close timer cannot dismiss a newer notification.

Two things Manawa does that Temperatura must **not** copy:

- Its notifications auto-close after a few seconds and never persist. Temperatura's are
  `requireInteraction: true` and live until silenced or replaced.
- It has no `notificationclick` handler. Temperatura's silence-from-notification path is new
  work, and it must handle the case where no client is alive: record the silence in the SW so
  the client applies it on wake.

---

## 4. Test plan

Same style as RTW: plain `.mjs` files at the repo root, run by the shell loop, a hand-rolled
`ok(name, cond)` counter, no framework. Shims where a browser API is needed, as
`domshim.mjs` does for `DOMParser`.

Write in this order:

1. **`testalarms.mjs` first, before any UI.** Drive `alarms.js` with a synthetic temperature
   trace and a fake clock. Must cover: jitter across a threshold (proves the deadband), the
   re-arm at `T − 2` and its cooling mirror, a heating alarm whose step starts already above
   threshold (never fires), a data-loss gap, a claim handover mid-step, repeating alarms across
   a silence, and three simultaneous alarms silenced earliest-first by three presses.
2. `testinstances.mjs` — the state machine, pause/resume/restart arithmetic, in-band
   accumulation under every provenance state, Restart zeroing the accumulator and re-arming the
   duration-reached alarm, the latched estimate flag surviving a round trip through storage.
3. `testclaim.mjs` — the whole claim lifecycle table from the spec, including the unclaimed
   state after the holder completes, and the toggle.
4. `teststorage.mjs` — recipes, instances, the open set, import/export, backup/restore, cascade
   behaviour when a recipe with running instances is closed.
5. `testpress.mjs` — press-count baselining. Seeding on first connect, seeding again after a
   gap, diffs only within a stream, wrap and cold-restart handled as a single press, presses
   swallowed when nothing is sounding.
6. `testrecovery.mjs` — kill and restore mid-instance. Model it on RTW's
   `recording-recovery-spec.md` and `testrecovery.mjs`.
7. `testformat.mjs` — cheap, catches a lot.

---

## 5. Build order

1. Scaffold + deploy an empty shell to Cloudflare. Confirm the URL, HTTPS, install-to-home-screen
   and the manifest. Do this before writing any logic — it is ten minutes and it de-risks §6.
2. **Platform spike**, throwaway, on that deployment: keep-alive running, `FakeThermometer`
   firing a fake alarm, and the notification round trip. Background the app with the screen off
   and confirm the notification appears, vibrates, re-posts at 5 s, and that tapping Silence
   actually silences with the app hidden. This is the one thing neither reference project has
   done, so prove it before building on top of it.
3. `storage.js` + `recipe.js` + tests. No UI.
4. `instances.js` + `alarms.js` + provenance + tests. Still no UI.
5. `thermometer.js` against the real Feather. Verify packet parsing and press counting with a
   throwaway readout screen before wiring it to alarms.
6. `alarmPlayer.js` + `notify.js`, replacing the spike's stubs.
7. UI: home → recipe → step, then settings. Last, because by this point everything it calls is
   already tested.
8. `backGuard.js`, keep-awake wiring, offline shell.

---

## 6. Deploy notes

Deployment is Cloudflare Workers Builds off the GitHub repo: build command `npm run build`,
output directory `dist`, and `wrangler.jsonc` does the rest.

**Fix RTW's service-worker cache-busting bug rather than inheriting it.** In RTW, `public/sw.js`
computes `const VERSION = (self.__RTW_BUILD_ID__ || "dev")` and uses it as the shell cache key.
Nothing in the Vite build defines `__RTW_BUILD_ID__` — the value is substituted by a `sed` step
in `.github/workflows/deploy.yml`, which only runs on the GitHub Pages path. On a Cloudflare
build that step never runs, so `VERSION` stays `"dev"` forever and the shell cache key never
changes. It is close to harmless in RTW because only the manifest and two icons are pre-cached
and `index.html` is fetched network-first, but do not carry it over. Stamp the build id in
`generate-env.mjs` (write the value into `public/sw.js`, or emit it as a constant the SW
imports) so it works on whatever pipeline is in use.

**Gate the auto-reload.** RTW's `main.jsx` reloads the page on `controllerchange` so a new deploy
is picked up without a force-quit. In Temperatura that would reload the app in the middle of a
ferment, or while an alarm is sounding. Keep the update detection, but defer the reload until no
instance is running and no alarm is sounding — or at minimum, never reload while an alarm is
sounding.

`_headers` is not needed. Manawa Pace only has one to serve its README as markdown.

---

## 7. Decisions to confirm

Small things settled by writing them down rather than by explicit instruction:

1. **Claim transfer on an explicit tap.** Tapping the thermometer icon on an instance that does
   not hold the claim *transfers* the claim, on the reasoning that a deliberate tap means the
   user has physically moved the probe, and that "a new instance never takes the claim" governs
   automatic acquisition at Start only. The stricter alternative is to refuse and require a
   release on the holder's page first.
2. **Notification silencing is per-alarm.** Each sounding alarm gets its own notification and
   tag, so each can be silenced independently — unlike the thermometer button, which is always
   earliest-first. This asymmetry is deliberate but it is an asymmetry.
3. **Back-button action ordering.** `resolveBackAction()` needs an app-specific ordering, and the
   question is where a sounding alarm sits in it. Suggested: silence the earliest sounding alarm
   → close an open panel/editor → step page back to recipe → recipe back to home → confirm exit.
4. **Sound decode failure falls back to the synthesised default** rather than refusing to save
   the theme. An alarm must never fail silently, so the fallback is at play time as well as at
   pick time.
