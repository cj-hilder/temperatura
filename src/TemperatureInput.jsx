import { useState } from "react";
import { parseTemperatureText } from "./lib/format.js";
import * as t from "./theme.js";

// The temperature entry box (band edges, alarm thresholds), made to behave
// like TimeInput's boxes: `type="text"` rather than `type="number"`, and
// focusing selects the contents so a tap-and-type replaces the value.
//
// While focused it shows a local draft of exactly what was typed, and only
// commits once the draft is a number. The old box committed Number(text) on
// every keystroke, so emptying it committed 0, the box then displayed "0",
// and the next digit typed landed after it ("05"). Leaving the box with an
// unfinished draft ("", "-") just drops back to the last committed value.
export default function TemperatureInput({ valueC, onChangeC, width = 80 }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      style={{ ...t.input, width }}
      value={draft ?? String(valueC)}
      onFocus={(e) => {
        setDraft(String(valueC));
        e.target.select();
      }}
      onChange={(e) => {
        const { text, value } = parseTemperatureText(e.target.value);
        setDraft(text);
        if (value != null) onChangeC(value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
