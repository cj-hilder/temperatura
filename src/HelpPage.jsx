import * as t from "./theme.js";

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      {children}
    </div>
  );
}

export default function HelpPage({ onClose }) {
  return (
    <div style={{ ...t.fullScreenOverlay, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <h1 style={{ marginTop: 0 }}>Help</h1>

        <Section title="Recipes and steps">
          <p>
            A recipe holds one or more steps. Tap <b>+</b> on Home to create a blank recipe, or
            <b> Open</b> to pick one you've already saved. Each step can have a duration, a
            temperature band, and any number of alarms — set these on the step's own page by
            tapping its ✎ edit icon.
          </p>
        </Section>

        <Section title="Starting and running a step">
          <p>
            Tap <b>Start</b> on a step to begin an instance of it. You can run the same step
            more than once at a time — for example two loaves rising in parallel — each gets
            its own progress and its own alarms. Use <b>Pause/Resume</b>, <b>Restart</b>,
            <b> Complete</b>, or <b>Duplicate</b> (start another instance of the same step) from
            the step page's controls.
          </p>
        </Section>

        <Section title="The thermometer and the claim">
          <p>
            Only one running instance can use the live thermometer reading at a time — that's
            the "claim." Starting the first instance takes it automatically; if you're running
            several steps at once, tap the 🌡️ icon on whichever step's page should have live
            temperature readings and alarms. Tapping it again releases the claim; tapping it on
            a different instance transfers the claim there, on the assumption you've physically
            moved the probe.
          </p>
        </Section>

        <Section title="Alarms">
          <p>
            A step can have time alarms (fire a set time into the step, once or repeating),
            temperature alarms (fire when the reading crosses a threshold you set, heating or
            cooling), and a duration-reached alarm. If a step has a temperature band, it always
            gets two automatic alarms at the band's edges — these can't be turned off, only
            themed. Each alarm can use its own sound, set up in <b>Settings</b>.
          </p>
          <p>
            The physical button on the thermometer silences whichever alarm fired earliest,
            across every recipe and step currently running — the same as the earliest "Silence"
            button in the app. Silencing from a notification or from a step page only silences
            that one alarm.
          </p>
        </Section>

        <Section title="Your data">
          <p>
            Everything — recipes, running instances, alarm themes — lives only on this device.
            Use <b>Backup</b>/<b>Restore</b> from this menu to save or bring back everything at
            once, or <b>Export</b>/<b>Import</b> for a single recipe, e.g. to share it or move it
            to another device.
          </p>
        </Section>
      </div>
      <div style={{ padding: 16, borderTop: `1px solid ${t.colors.border}` }}>
        <button style={{ ...t.primaryButton, width: "100%" }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
