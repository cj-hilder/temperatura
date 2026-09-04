import { useState } from "react";
import { useAppEngine } from "./engine.js";
import HomePage from "./HomePage.jsx";
import RecipePage from "./RecipePage.jsx";
import StepPage from "./StepPage.jsx";
import * as t from "./theme.js";

export default function App() {
  const engine = useAppEngine();
  const [screen, setScreen] = useState({ view: "home" });

  if (!engine.keepAliveStarted) {
    return (
      <div style={{ ...t.page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <h1>Temperatura</h1>
        <p style={{ color: t.colors.textMuted, textAlign: "center", padding: "0 24px" }}>
          Tap to enable background alarms — this needs a tap to unlock audio and notifications.
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
