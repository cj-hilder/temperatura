import { useState } from "react";
import { graphView } from "./lib/graphHistory.js";
import { formatDuration } from "./lib/format.js";
import * as t from "./theme.js";

// The step page's live temperature–time graph: plain SVG, no charting
// library. Each stored point is a bucket with a lowest and highest reading
// (lib/graphHistory.js), so the data is drawn as a thin band between them
// with a line through the middle — a merged bucket that held a spike still
// shows it. Gaps (no data) break the line; nothing is drawn across them.
//
// Tapping toggles between the whole run (rescaling as it grows) and the last
// 10 minutes, for close-up detail late in a long step.
const W = 320;
const H = 140;
const PAD = { left: 34, right: 8, top: 8, bottom: 18 };
const RECENT_MS = 10 * 60_000;

export default function TemperatureGraph({ history, startedAt, step, liveTempC, now }) {
  const [recent, setRecent] = useState(false);
  const from = recent ? now - RECENT_MS : startedAt;
  const to = Math.max(now, from + 60_000);
  const thresholds = step.tempAlarms.map((a) => a.thresholdC);
  const marks = [...(step.tempBand ? [step.tempBand.lowC, step.tempBand.highC] : []), ...thresholds, ...(liveTempC != null ? [liveTempC] : [])];
  const { runs, yMin, yMax } = graphView(history, { from, to }, marks);

  const x = (time) => PAD.left + ((time - from) / (to - from)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const mid = (p) => (p.lo + p.hi) / 2;
  const lastRun = runs[runs.length - 1];
  const lastPoint = lastRun?.[lastRun.length - 1];
  // The newest bucket is placed at its own start time, up to 10 s back, so
  // the line is carried on to "now" at the live reading.
  const liveTail = liveTempC != null && lastPoint ? `M${x(lastPoint.t)},${y(mid(lastPoint))} L${x(now)},${y(liveTempC)}` : null;

  return (
    <div style={{ margin: "12px 0" }} onClick={() => setRecent(!recent)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", cursor: "pointer" }} role="img" aria-label="Temperature over time">
        <rect x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} fill="#fff" stroke={t.colors.border} />
        {step.tempBand && (
          <rect
            x={PAD.left}
            width={W - PAD.left - PAD.right}
            y={y(step.tempBand.highC)}
            height={Math.max(0, y(step.tempBand.lowC) - y(step.tempBand.highC))}
            fill={t.colors.gradientStart}
            opacity={0.45}
          />
        )}
        {thresholds.map((c, i) => (
          <line key={i} x1={PAD.left} x2={W - PAD.right} y1={y(c)} y2={y(c)} stroke={t.colors.accentRed} strokeDasharray="4 3" strokeWidth={1} opacity={0.7} />
        ))}
        {runs.map((run, i) => (
          <g key={i}>
            <polygon
              points={[...run.map((p) => `${x(p.t)},${y(p.hi)}`), ...run.slice().reverse().map((p) => `${x(p.t)},${y(p.lo)}`)].join(" ")}
              fill={t.colors.gradientEnd}
              opacity={0.25}
            />
            <polyline points={run.map((p) => `${x(p.t)},${y(mid(p))}`).join(" ")} fill="none" stroke={t.colors.gradientEnd} strokeWidth={1.6} strokeLinejoin="round" />
          </g>
        ))}
        {liveTail && <path d={liveTail} fill="none" stroke={t.colors.gradientEnd} strokeWidth={1.6} />}
        <text x={PAD.left - 4} y={PAD.top + 8} fontSize={9} textAnchor="end" fill={t.colors.textMuted}>{yMax.toFixed(1)}°</text>
        <text x={PAD.left - 4} y={H - PAD.bottom} fontSize={9} textAnchor="end" fill={t.colors.textMuted}>{yMin.toFixed(1)}°</text>
        <text x={PAD.left} y={H - 5} fontSize={9} fill={t.colors.textMuted}>{recent ? "−10:00" : "start"}</text>
        <text x={W - PAD.right} y={H - 5} fontSize={9} textAnchor="end" fill={t.colors.textMuted}>
          {recent ? "now" : formatDuration(now - startedAt)}
        </text>
      </svg>
      <div style={{ fontSize: 11.5, color: t.colors.textMuted, marginTop: 2 }}>
        {recent ? "Last 10 minutes · tap for the whole run" : "Whole run · tap for the last 10 minutes"}
      </div>
    </div>
  );
}
