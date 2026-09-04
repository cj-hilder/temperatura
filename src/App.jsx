import { useEffect, useState } from "react";
import { useAppEngine } from "./engine.js";
import { canApplyServiceWorkerUpdate } from "./lib/deploy.js";
import HomePage from "./HomePage.jsx";
import RecipePage from "./RecipePage.jsx";
import StepPage from "./StepPage.jsx";
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

  if (screen.view === "recipe") {
    return <RecipePage engine={engine} recipeId={screen.recipeId} initialEditing={screen.editing} navigate={setScreen} />;
  }
  if (screen.view === "step") {
    return <StepPage engine={engine} recipeId={screen.recipeId} stepId={screen.stepId} navigate={setScreen} />;
  }
  return <HomePage engine={engine} navigate={setScreen} />;
}
