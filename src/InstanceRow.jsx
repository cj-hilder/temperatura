import StepTimers from "./StepTimers.jsx";
import { computeStepProgress, progressBarStyle, provenanceLabel, stepTimers } from "./stepDisplay.js";
import * as t from "./theme.js";

// One running instance at a glance: progress bar (if the step has a
// duration) and the step timers. Shared by the Home page's recipe tiles and
// the Recipe page's step tiles, so the two can never drift apart. The Home
// page shows the step's name and description with it (`showStep`); inside a
// Recipe page step tile they are already the tile's own heading, so only the
// tag is repeated there.
export default function InstanceRow({ engine, step, instance, showStep = true, onOpen }) {
  const now = Date.now();
  const progress = computeStepProgress(instance, step, engine, now);
  const timers = stepTimers(instance, step, now);
  const paused = instance.status === "paused" ? " — paused" : "";
  return (
    <div
      style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.colors.border}`, cursor: "pointer" }}
      onClick={(e) => {
        // Inside a Recipe page step tile, the tile itself is clickable too.
        e.stopPropagation();
        onOpen();
      }}
    >
      {showStep ? (
        <>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {step.name}
            {instance.tag && <span style={{ color: t.colors.textMuted, fontWeight: 400 }}> — {instance.tag}</span>}
          </div>
          <div style={{ ...t.clamp(2), fontSize: 12.5, color: t.colors.textMuted }}>{step.description}</div>
        </>
      ) : (
        instance.tag && <div style={{ fontWeight: 600, fontSize: 13 }}>{instance.tag}</div>
      )}
      {progress ? (
        <ProgressBar progress={progress} timers={timers} paused={paused} />
      ) : (
        // No duration, so no bar — but the timers are still the most useful
        // thing to see at a glance (the same ones the step page shows).
        <StepTimers timers={timers} style={{ fontSize: 11.5, color: t.colors.textMuted, marginTop: 6 }}>
          {paused}
        </StepTimers>
      )}
    </div>
  );
}

function ProgressBar({ progress, timers, paused }) {
  const { advancing, fillStyle, trackStyle } = progressBarStyle(progress.provenance, t.colors);
  const label = provenanceLabel(progress.provenance);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 8, borderRadius: 4, background: trackStyle, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress.fraction * 100}%`, background: fillStyle }} />
      </div>
      <StepTimers timers={timers} style={{ fontSize: 11.5, color: t.colors.textMuted, marginTop: 2 }}>
        {!advancing && label ? ` — ${label}` : ""}
        {paused}
      </StepTimers>
    </div>
  );
}
