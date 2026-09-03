import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

// Register the service worker (offline shell). We also watch for an
// updated worker and reload once it takes control, so a new deploy is picked
// up without the user having to force-quit the app.
//
// TODO(build-plan §6): once instances/alarms exist, gate this reload so it
// never fires mid-ferment or while an alarm is sounding.
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

    // when the controlling worker changes, reload once to get the fresh shell
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}
