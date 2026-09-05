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

        <Section title="Recipes and recipe steps">
          <p>
            A recipe holds one or more recipe steps. Tap <b>+</b> on Home to create a blank
            recipe, or <b>Open</b> to pick one you've already saved. Each recipe step can have
            a duration, a temperature band, and any number of alarms — set these on the recipe
            step's own page by tapping its ✎ edit icon.
          </p>
        </Section>

        <Section title="Starting and running a recipe step">
          <p>
            Tap <b>Start</b> on a recipe step to begin it. You can run the same recipe step more
            than once at a time — for example two loaves rising in parallel — each copy gets its
            own progress and its own alarms. Use <b>Pause/Resume</b>, <b>Restart</b>,
            <b> Complete</b>, or <b>Duplicate</b> (start another copy of the same recipe step)
            from the recipe step's page.
          </p>
        </Section>

        <Section title="The thermometer">
          <p>
            The thermometer can only be in one place, so it can only be allocated to one recipe
            step at a time, even if several are in progress at once. You can indicate which
            recipe step is using the thermometer by tapping the 🌡️ icon on that step's page.
            Starting your first recipe step allocates it there automatically. Tapping the icon
            again frees the thermometer; tapping it on a different recipe step moves it there
            instead, on the assumption you've physically moved the probe.
          </p>
        </Section>

        <Section title="Alarms">
          <p>
            A recipe step can have time alarms (fire a set time in, once or repeating),
            temperature alarms (fire when the reading crosses a threshold you set, heating or
            cooling), and a duration-reached alarm. If a recipe step has a temperature band, it
            always gets two automatic alarms at the band's edges — these can't be turned off,
            only themed. Each alarm can use its own sound, set up in <b>Settings</b>.
          </p>
          <p>
            The physical button on the thermometer silences whichever alarm fired earliest,
            across every recipe and recipe step currently running — the same as the earliest
            "Silence" button in the app. Silencing from a notification or from a recipe step's
            page only silences that one alarm.
          </p>
        </Section>

        <Section title="Your data">
          <p>
            Everything — recipes, recipe steps in progress, alarm themes — lives only on this
            device. Use <b>Backup</b>/<b>Restore</b> from this menu to save or bring back
            everything at once, or <b>Export</b>/<b>Import</b> for a single recipe, e.g. to
            share it or move it to another device.
          </p>
        </Section>
      </div>
      <div style={{ padding: 16, borderTop: `1px solid ${t.colors.border}` }}>
        <button style={{ ...t.primaryButton, width: "100%" }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
