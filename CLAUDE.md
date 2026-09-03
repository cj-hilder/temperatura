# Temperatura

Android-only PWA that manages recipe steps by time and temperature, reading from a
custom BLE thermometer (Adafruit ESP32-S3 Feather + DS18B20 probe). Deployed to
Cloudflare Workers off `main`.

## Read these before changing anything

- `docs/Temperatura.md` — the specification. **Authoritative on behaviour.**
- `docs/build-plan.md` — repo layout, module split, storage schema, test plan, build order.
  **Authoritative on structure.**
- `docs/FeatherThermometer.ino` — firmware. The BLE contract lives in the header comment
  block: packet layout, temperature encoding, button and press-count semantics.

Where the spec and the build plan disagree, the spec wins. Where either disagrees with
something you infer from the reference projects, the spec and build plan win.

Do not restate spec decisions back to me as if they were open questions. If the spec is
genuinely silent or self-contradictory on something you need, say so and stop — don't
invent a rule and build on it.

## Reference projects

`reference/` (gitignored) holds two of my other projects. Both are working, deployed, and
proven on this exact platform. **Read them rather than guessing at their contents.**

- `reference/ride-the-wind/` — the house style. Repo shape, test style, the storage
  Backend split, the keep-alive trio, the back-button guard.
- `reference/ble-hr-tool/` — Manawa Pace. Web Bluetooth connect and reconnect, the
  visible/hidden alert routing, service-worker notifications.

`docs/build-plan.md` §1–§3 lists exactly what to take from each. When you claim something
matches a reference project, cite `file:line`. Paraphrasing from memory is not acceptable
here — the details that matter in these files are the non-obvious ones.

Never modify anything under `reference/`.

## Stack

Vite 6, React 18, plain JavaScript (no TypeScript), no CSS framework.

**Do not add dependencies.** Not a test framework, not Tailwind, not a state library, not
a PWA plugin, not an IndexedDB wrapper, not a date library. If you think something is
genuinely unavoidable, ask first and say why. `package.json` should stay at
`react`, `react-dom`, `vite`, `@vitejs/plugin-react`.

## Architecture

Everything decidable is a pure module under `src/lib/`, tested in Node with injected
dependencies. Browser-only APIs sit behind a seam with a fake implementation alongside the
real one, following `IndexedDBBackend` / `MemoryBackend` in
`reference/ride-the-wind/src/lib/storage.js`. A controller (`src/lib/app.js`) is
constructed with its dependencies injected, as in
`reference/ride-the-wind/src/lib/app.js`'s `createAppController`. `App.jsx` holds UI and
calls the controller.

Consequence: if a module needs `Date.now()`, a BLE packet, an `AudioContext` or IndexedDB,
that comes in as a parameter. Tests must never need a browser shim for time, storage or
Bluetooth.

## Tests

Plain `.mjs` files at the repo root, run by `npm test`, which is a shell loop over
`test*.mjs`. Hand-rolled assertions in the style of
`reference/ride-the-wind/testexample.mjs` — a `pass`/`fail` counter and an
`ok(name, cond, detail)` helper. No framework, no runner, no config.

Run `npm test` and show me the output before telling me something works. "Should now
work" is not a result. If a test fails, fix the cause, not the assertion.

`docs/build-plan.md` §4 gives the test files to write and what each must cover. Write
`testalarms.mjs` before writing `alarms.js`'s UI callers.

## Comment style

Comments explain **why**, especially the platform quirk that forced the shape of the code.
The house standard is `reference/ride-the-wind/src/lib/useKeepAlive.js` (why all three of
audio, MediaSession and wake lock are needed, and why gain is `0.001` rather than `0`) and
`backGuard.js` (why the history buffer holds several sentinels, and why it refills on user
gestures rather than inside `popstate`). Match that: a future reader should not be able to
"simplify" the code without first reading why they can't.

Don't comment what the line already says.

## Four things that will be tempting and are wrong

These are all specified, and all four look like reasonable shortcuts:

1. **Alarm playback must go through `decodeAudioData` on the keep-alive `AudioContext`.**
   Not `new Audio()`, not an `<audio>` element. That context is the only audio path proven
   to survive backgrounding on this platform.
2. **Sound files are stored as an ArrayBuffer in IndexedDB**, not as a
   `FileSystemFileHandle`. An alarm must be playable while hidden, with no user gesture and
   no permission prompt available.
3. **The thermometer's press count is baselined, not subtracted.** Seed on every connect and
   every reconnect; apply differences only between consecutive packets in an unbroken
   stream. A raw `now - previous` silences several alarms at once after any gap.
4. **Elapsed and in-band time derive from stored epoch timestamps**, never from a tick
   counter or an interval that increments a total. Running instances must survive the app
   being killed and the phone rebooting. A tick counter passes every fast test and then
   fails after a reboot.

## Platform constraints worth knowing

- Web Bluetooth, Screen Wake Lock and Notifications all need a secure context. On a phone
  that means the deployed HTTPS URL, or `localhost` via Chrome DevTools port forwarding.
  A LAN IP over http gives you none of these APIs.
- `navigator.vibrate()` is ignored while the document is hidden, and a visibility change
  cancels a vibration in progress. Vibration while backgrounded is only reachable via the
  `vibrate` option on a service-worker notification. See the routing in
  `reference/ble-hr-tool/app.js` (`triggerNotification`) and `sw.js`.
- Timers, BLE event dispatch and audio are all throttled or suspended when the app is
  hidden unless it looks like an active media player. That is what the keep-alive is for.
- Only one central can connect to the Feather at a time, and it stops advertising while
  connected.

## Git

Commit when `npm test` is green, not before. Reference the build-plan phase in the message.
Don't commit `reference/`, `dist/`, `.env.production` or `.env.development`.

## Deploy

Cloudflare Workers Builds from `main`: build command `npm run build`, output `dist`,
config in `wrangler.jsonc`. There is deliberately no GitHub Actions workflow — see
`docs/build-plan.md` §6 for the service-worker build-id stamping this replaces, and the
reason RTW's version of it is broken on this pipeline.
