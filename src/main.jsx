import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

// Register the service worker (offline shell). We also watch for an
// updated worker and let it take control, so a new deploy is picked up
// without the user having to force-quit the app. The reload itself is NOT
// done here — this module has no view of running instances or sounding
// alarms, so it only announces "an update is ready"; App.jsx decides when
// it's actually safe to reload (build-plan §6: never mid-ferment or while an
// alarm is sounding — see lib/deploy.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js")
      .then((reg) => {
        // when an updated SW is found, let it activate immediately
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              // a new version is ready and an old one is in control
              nw.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
        // poll for updates when the app regains focus
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update();
        });
      })
      .catch(() => {});

    // when the controlling worker changes, the new shell is ready — tell
    // App.jsx, which reloads once it's actually safe to.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.dispatchEvent(new Event("sw-update-ready"));
    });
  });
}
