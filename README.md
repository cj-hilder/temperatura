# Temperatura

Android-only PWA that manages recipe steps by time and temperature, reading from a custom BLE
thermometer (Adafruit ESP32-S3 Feather + DS18B20 probe). Deployed to Cloudflare Workers off
`main` at [temperatura.hilderbuild.com](https://temperatura.hilderbuild.com).

This file documents how the project is built and how to work on it. For how to *use* the app,
see the in-app Help (hamburger menu → Help). For the behavioral specification, see
[`docs/Temperatura.md`](docs/Temperatura.md); for the structural build plan, see
[`docs/build-plan.md`](docs/build-plan.md).

## Stack

Vite 6, React 18, plain JavaScript (no TypeScript), no CSS framework, no state library. The only
dependencies are `react`, `react-dom`, `vite`, and `@vitejs/plugin-react` — deliberately kept that
way; nothing (a test framework, an IndexedDB wrapper, a date library) has been added beyond them.

## Setup

```bash
npm install
npm run dev      # Vite dev server
npm test         # run every test*.mjs file in Node
npm run build    # production build to dist/
```

`npm run dev` and `npm run build` both run `generate-env.mjs` first, which writes
`.env.development`/`.env.production` (app version and build metadata, read via
`import.meta.env`) and stamps the service worker's cache-busting build id into
`public/build-id.js` — see that script's own comments for why this replaces a `sed` step that
only exists in a GitHub Actions pipeline this project doesn't have.

Web Bluetooth, the Screen Wake Lock API, and Notifications all require a secure context. Over
plain `npm run dev` on a LAN IP that means none of them work — test those specifically against
the deployed HTTPS URL, or `localhost` via Chrome DevTools port forwarding from an Android device.

## Architecture

Everything decidable is a pure module under `src/lib/`, tested in Node with injected dependencies
— no DOM, no real clock, no Bluetooth in any of them. Browser-only APIs sit behind a seam with a
fake implementation alongside the real one (`MemoryBackend`/`IndexedDBBackend` in
`src/lib/storage.js`; `FakeThermometer`/`createWebBluetoothBackend` in `src/lib/thermometer.js`).
A controller (`src/lib/app.js`, `createAppController({backend, now, thermometer})`) is constructed
with its dependencies injected and wires the pure modules together; `src/engine.js`
(`useAppEngine()`) is the one React hook that drives it — a shared 1-second tick loop over every
running instance, thermometer connect/reconnect, and the keep-alive/notification plumbing. Page
components (`App.jsx`, `HomePage.jsx`, `RecipePage.jsx`, `StepPage.jsx`, and their `*Editor.jsx`/
`*Page.jsx` siblings) hold UI state and call the engine; they carry no business logic of their own.

Consequence: if a module needs `Date.now()`, a BLE packet, an `AudioContext`, or IndexedDB, that
comes in as a parameter. Every timestamp-derived quantity (elapsed time, in-band accumulation) is
computed fresh from stored epoch timestamps rather than a tick counter, so recovering a running
instance after the app is killed or the phone reboots is the same arithmetic as a normal tick with
a larger gap — not a separate code path.

No CSS files anywhere — every page is inline `style={{}}` objects built from the shared constants
in `src/theme.js`.

Several house patterns (the storage `Backend`/`Store` split, the `useKeepAlive` background-audio
trio, the Android back-button guard's sentinel-buffer history trick) were ported from prior
personal PWA projects on this same platform, adapted to this app's own domain.

## Tests

Plain `.mjs` files at the repo root (`test*.mjs`), run by `npm test` — a shell loop that runs each
one with `node` and stops at the first failure. No framework, no runner, no config: each file is a
`pass`/`fail` counter and an `ok(name, condition, detail)` assertion helper. UI has no automated
coverage by design — pure logic is unit tested exhaustively; the UI itself is verified visually.

## Deploy

Cloudflare Workers Builds from `main`: build command `npm run build`, output directory `dist`,
routing and config in `wrangler.jsonc`. There is deliberately no GitHub Actions workflow. The
service worker (`public/sw.js`) serves the HTML document network-first (so a fresh deploy is
picked up immediately) and hashed build assets cache-first (safe forever, since Vite changes the
filename whenever the content does); its update-detection reload is gated in `App.jsx` to never
fire while an instance is running or an alarm is sounding (`src/lib/deploy.js`).
