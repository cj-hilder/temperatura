import { useCallback, useEffect, useRef, useState } from "react";
import { useAppEngine } from "./engine.js";
import { canApplyServiceWorkerUpdate } from "./lib/deploy.js";
import { installBackGuard, resolveBackAction, requestAppExit } from "./lib/backGuard.js";
import { backDismissRef, useBackDismiss } from "./useBackDismiss.js";
import HomePage from "./HomePage.jsx";
import RecipePage from "./RecipePage.jsx";
import StepPage from "./StepPage.jsx";
import HamburgerMenu from "./HamburgerMenu.jsx";
import SettingsPage from "./SettingsPage.jsx";
import HelpPage from "./HelpPage.jsx";
import AboutPage from "./AboutPage.jsx";
import * as t from "./theme.js";

export default function App() {
  const engine = useAppEngine();
  const [screen, setScreen] = useState({ view: "home" });

  // main.jsx announces a waiting service-worker update via this event; it has
  // no view of running instances or sounding alarms, so the actual reload
  // waits here until canApplyServiceWorkerUpdate agrees it's safe — re-checked
  // on every engine refresh (build-plan §6).
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const onReady = () => setUpdateReady(true);
    window.addEventListener("sw-update-ready", onReady);
    return () => window.removeEventListener("sw-update-ready", onReady);
  }, []);
  useEffect(() => {
    if (updateReady && canApplyServiceWorkerUpdate(engine.openRecipes)) {
      window.location.reload();
    }
  }, [updateReady, engine.openRecipes]);

  /* ── Android back button ──────────────────────────────────────────────────
   * Without a guard, back exits an installed PWA instantly from anywhere.
   * The guard intercepts every press and hands it here; resolveBackAction
   * (build-plan §7 decision 3) decides what it means: silence the earliest
   * sounding alarm, close an open editor/overlay, step back a screen, or ask
   * to quit.
   *
   * Arming is a callable rather than a bare mount effect because the Quit
   * path deliberately disarms (see confirmQuit) and a tap can bring it back.
   * The ref doubles as the "already armed" flag: every install pushes
   * history sentinels, so arming twice would stack two buffers. The handler
   * reads live state from a ref so re-arming isn't needed on every render —
   * see RTW's App.jsx:387-410 for the identical shape.
   */
  const anySounding = engine.openRecipes.some(({ instances }) =>
    instances.some((i) => Object.values(i.alarmState).some((s) => s.sounding))
  );

  // The quit prompt is itself a dismissable — back on it must be Stay, never
  // a second "ask to quit" that just re-shows the same prompt (build-plan
  // §7 decision 3 groups this with "close an open panel/editor").
  const [quitAsk, setQuitAsk] = useState(false);
  useBackDismiss(quitAsk, () => setQuitAsk(false));

  // The hamburger menu and each of its full-screen destinations are mutually
  // exclusive (opening one always closes whatever was open before), so they
  // never fight over the single back-dismiss slot. Back on any of them goes
  // to the menu, not straight through to whatever page is underneath — the
  // same "close the topmost thing first" rule as everything else back
  // dismisses.
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  useBackDismiss(menuOpen, () => setMenuOpen(false));
  useBackDismiss(settingsOpen, () => { setSettingsOpen(false); setMenuOpen(true); });
  useBackDismiss(helpOpen, () => { setHelpOpen(false); setMenuOpen(true); });
  useBackDismiss(aboutOpen, () => { setAboutOpen(false); setMenuOpen(true); });

  const backStateRef = useRef({});
  backStateRef.current = { anySounding, dismissable: !!backDismissRef.current, screen };

  const uninstallBackRef = useRef(null);
  const armBackGuard = useCallback(() => {
    if (typeof window === "undefined") return;
    if (uninstallBackRef.current) return; // already armed — don't stack buffers
    uninstallBackRef.current = installBackGuard({
      history: window.history,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      onBack: () => {
        const { screen: currentScreen } = backStateRef.current;
        switch (resolveBackAction(backStateRef.current)) {
          case "silenceEarliest": engine.silenceEarliestGlobal(); break;
          case "dismiss": backDismissRef.current?.(); break;
          case "toRecipe": setScreen({ view: "recipe", recipeId: currentScreen.recipeId }); break;
          case "toHome": setScreen({ view: "home" }); break;
          default: setQuitAsk(true); break;
        }
      },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    armBackGuard();
    return () => {
      const un = uninstallBackRef.current;
      uninstallBackRef.current = null;
      if (un) un();
    };
  }, [armBackGuard]);

  // Confirmed Quit. Stops intercepting, walks back out of the guard's history
  // entries, then asks the window to close. The hint waits for onReady, so
  // "press back once more" is only shown once we're actually at the floor —
  // see backGuard.js's requestAppExit for why there's no earlier signal.
  const [quitHint, setQuitHint] = useState(false);
  const confirmQuit = useCallback(() => {
    const uninstall = uninstallBackRef.current;
    uninstallBackRef.current = null;
    requestAppExit({ uninstall, win: window, onReady: () => setQuitHint(true) });
  }, []);

  // Changed your mind while the hint is showing: a tap re-arms the guard and
  // resets everything. Re-arming inside a real tap matters — a push made
  // during a user gesture is the only kind Chrome won't mark skippable.
  const cancelQuit = useCallback(() => {
    setQuitHint(false);
    setQuitAsk(false);
    armBackGuard();
  }, [armBackGuard]);

  if (!engine.keepAliveStarted) {
    return (
      <div style={{ ...t.page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <h1>Temperatura</h1>
        <p style={{ color: t.colors.textMuted, textAlign: "center", padding: "0 24px" }}>
          time x temperature
        </p>
        <button style={t.primaryButton} onClick={engine.startKeepAlive}>Start</button>
      </div>
    );
  }

  const onOpenMenu = () => setMenuOpen(true);
  const currentRecipeId = screen.view === "recipe" || screen.view === "step" ? screen.recipeId : null;
  const activeScreen =
    screen.view === "recipe" ? (
      <RecipePage engine={engine} recipeId={screen.recipeId} initialEditing={screen.editing} navigate={setScreen} onOpenMenu={onOpenMenu} />
    ) : screen.view === "step" ? (
      <StepPage engine={engine} recipeId={screen.recipeId} stepId={screen.stepId} navigate={setScreen} onOpenMenu={onOpenMenu} />
    ) : (
      <HomePage engine={engine} navigate={setScreen} onOpenMenu={onOpenMenu} />
    );

  return (
    <>
      {activeScreen}

      {menuOpen && (
        <HamburgerMenu
          engine={engine}
          currentRecipeId={currentRecipeId}
          navigate={setScreen}
          onClose={() => setMenuOpen(false)}
          onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
          onOpenHelp={() => { setMenuOpen(false); setHelpOpen(true); }}
          onOpenAbout={() => { setMenuOpen(false); setAboutOpen(true); }}
        />
      )}
      {settingsOpen && <SettingsPage engine={engine} onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpPage onClose={() => setHelpOpen(false)} />}
      {aboutOpen && <AboutPage onClose={() => setAboutOpen(false)} />}

      {quitAsk && (
        <div
          // While the hint is up the guard is disarmed, so this overlay is
          // what tap-to-stay listens on. pointerdown, not click, so the tap
          // that cancels is the same gesture that re-arms the history buffer.
          onPointerDown={quitHint ? cancelQuit : undefined}
          style={t.overlay}
        >
          <div style={{ ...t.overlayCard, textAlign: "center" }} onClick={(e) => quitHint && e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Quit this app?</h3>
            {quitHint ? (
              <p style={{ fontSize: 13.5, color: t.colors.textMuted }}>Press back once more to leave</p>
            ) : (
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button style={{ ...t.secondaryButton, flex: 1 }} onClick={() => setQuitAsk(false)}>Stay</button>
                <button style={{ ...t.dangerButton, flex: 1 }} onClick={confirmQuit}>Quit</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
