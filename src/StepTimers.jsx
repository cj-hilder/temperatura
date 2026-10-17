// Renders stepDisplay.js's stepTimers(): "12:30 elapsed · 8:10 since
// entering band · 6:45 in band", the duration's own timer in bold and an
// estimated figure marked "≈". `children` are extra segments for the same
// line (remaining time, a provenance note), so it wraps as one sentence on a
// narrow screen instead of stacking.
export default function StepTimers({ timers, style, children }) {
  return (
    <div style={style}>
      {timers.map((timer, i) => (
        <span key={timer.key}>
          {i > 0 ? " · " : ""}
          {timer.bold ? <b>{timer.text}</b> : timer.text}
          {timer.estimate ? " ≈" : ""}
        </span>
      ))}
      {children}
    </div>
  );
}
