"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// Inline SVG charts sized to their container. Marks follow the app's chart
// specs: columns <= 24px with a 4px rounded top, 2px lines, >= 8px dots with a
// surface ring, hairline gridlines, one y-axis per chart.

export type ChartSeries = { key: string; label: string; color: string };
export type ChartDatum = { day: string; values: Record<string, number | null>; partial?: boolean };

export type ValueFormat = "steps" | "hours" | "integer" | "decimal" | "kcal" | "grams" | "mg";

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Formats are named so server components can choose one; functions can't
// cross the server/client boundary.
const FORMATTERS: Record<ValueFormat, (value: number) => string> = {
  steps: (value) => integerFormat.format(value),
  integer: (value) => integerFormat.format(value),
  decimal: (value) => value.toFixed(1),
  kcal: (value) => `${integerFormat.format(value)} kcal`,
  grams: (value) => `${integerFormat.format(value)} g`,
  mg: (value) => `${integerFormat.format(value)} mg`,
  hours: (value) => {
    const minutes = Math.round(value * 60);
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
};

const HEIGHT = 180;
const MARGIN = { top: 14, right: 14, bottom: 26, left: 44 };
const SURFACE = "#ffffff";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function niceDomain(min: number, max: number, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = niceStep((max - min) / count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { lo, hi, ticks };
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

function formatDay(day: string, long = false) {
  return (long ? longDayFormat : dayFormat).format(new Date(`${day}T00:00:00Z`));
}

// Evenly spaced x labels, always including the first and last day.
function xTickIndexes(count: number, plotWidth: number) {
  const slots = Math.max(2, Math.min(count, Math.floor(plotWidth / 64)));
  if (count <= slots) {
    return Array.from({ length: count }, (_, index) => index);
  }
  return Array.from({ length: slots }, (_, index) => Math.round((index * (count - 1)) / (slots - 1)));
}

const tickFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function Axes({
  width,
  right = MARGIN.right,
  ticks,
  y,
  days,
  x,
  suffix = "",
  formatTick = (tick: number) => tickFormat.format(tick)
}: {
  width: number;
  right?: number;
  ticks: number[];
  y: (value: number) => number;
  days: string[];
  x: (index: number) => number;
  suffix?: string; // after each y tick, e.g. "%"
  formatTick?: (tick: number) => string;
}) {
  const plotWidth = width - MARGIN.left - right;
  return (
    <g className="chart-axes" aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} x2={width - right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
          <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
            {formatTick(tick)}
            {suffix}
          </text>
        </g>
      ))}
      {xTickIndexes(days.length, plotWidth).map((index) => (
        <text
          key={days[index]}
          x={x(index)}
          y={HEIGHT - 6}
          textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
          className="chart-tick"
        >
          {formatDay(days[index])}
        </text>
      ))}
    </g>
  );
}

type TooltipRow = { color: string; label: string; value: string };

function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: TooltipRow[] }) {
  const left = Math.min(Math.max(x, 80), width - 80);
  return (
    <div className="chart-tooltip" style={{ left }} role="status">
      <span className="chart-tooltip-title">{title}</span>
      {rows.map((row) => (
        <span key={row.label} className="chart-tooltip-row">
          <i style={{ background: row.color }} aria-hidden="true" />
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </span>
      ))}
    </div>
  );
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="chart-legend">
      {series.map((item) => (
        <span key={item.key}>
          <i style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartFrame({ label, children }: { label: string; children: (width: number) => ReactNode }) {
  const { ref, width } = useWidth();
  return (
    <div ref={ref} className="chart-frame" aria-label={label} role="group">
      {width > 0 ? children(width) : <div style={{ height: HEIGHT }} />}
    </div>
  );
}

// Rect with rounded top corners and a square base.
function roundedTop(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

export function ColumnChart({
  data,
  series,
  format: formatName,
  label,
  reference
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  format: ValueFormat;
  label: string;
  // A dashed line across the plot, e.g. the usual level ("usual 9.5").
  reference?: { value: number; label: string };
}) {
  const format = FORMATTERS[formatName];
  const [active, setActive] = useState<number | null>(null);
  const totals = data.map((datum) =>
    series.reduce<number | null>((sum, item) => {
      const value = datum.values[item.key];
      return value == null ? sum : (sum ?? 0) + value;
    }, null)
  );
  const max = Math.max(0, reference?.value ?? 0, ...totals.map((total) => total ?? 0));
  const { hi, ticks } = niceDomain(0, max || 1);

  return (
    <ChartFrame label={label}>
      {(width) => {
        const plotWidth = width - MARGIN.left - MARGIN.right;
        const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
        const band = plotWidth / data.length;
        const barWidth = Math.max(2, Math.min(24, band - 2));
        const x = (index: number) => MARGIN.left + band * index + band / 2;
        const y = (value: number) => MARGIN.top + plotHeight - (value / hi) * plotHeight;
        const activeDatum = active == null ? null : data[active];

        return (
          <>
            <svg width={width} height={HEIGHT}>
              <Axes width={width} ticks={ticks} y={y} days={data.map((datum) => datum.day)} x={x} />
              {reference ? (
                <g aria-hidden="true">
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(reference.value)} y2={y(reference.value)} className="chart-reference" />
                  <text x={width - MARGIN.right} y={y(reference.value) - 4} textAnchor="end" className="chart-reference-label">
                    {reference.label}
                  </text>
                </g>
              ) : null}
              {data.map((datum, index) => {
                let base = y(0);
                const segments = series.filter((item) => datum.values[item.key] != null);
                return (
                  <g
                    key={datum.day}
                    opacity={(datum.partial ? 0.45 : 1) * (active != null && active !== index ? 0.55 : 1)}
                  >
                    {segments.map((item, segmentIndex) => {
                      const height = ((datum.values[item.key] as number) / hi) * plotHeight;
                      const top = base - height;
                      const isTop = segmentIndex === segments.length - 1;
                      // 2px surface gap above every segment but the top one.
                      const drawnHeight = Math.max(0, isTop ? height : height - 2);
                      const path = isTop
                        ? roundedTop(x(index) - barWidth / 2, top, barWidth, drawnHeight, 4)
                        : `M${x(index) - barWidth / 2},${top + 2}h${barWidth}v${drawnHeight}h${-barWidth}Z`;
                      base = top;
                      return <path key={item.key} d={path} fill={item.color} />;
                    })}
                  </g>
                );
              })}
              {data.map((datum, index) => (
                <rect
                  key={datum.day}
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatDay(datum.day, true)}: ${totals[index] == null ? "no data" : format(totals[index] as number)}`}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              ))}
            </svg>
            {activeDatum && active != null ? (
              <Tooltip
                x={x(active)}
                width={width}
                title={`${formatDay(activeDatum.day, true)}${activeDatum.partial ? " · so far" : ""}`}
                rows={
                  totals[active] == null
                    ? [{ color: "transparent", label: "", value: "No data" }]
                    : [...series].reverse().map((item) => {
                        const value = activeDatum.values[item.key];
                        return { color: item.color, label: item.label, value: value == null ? "–" : format(value) };
                      })
                }
              />
            ) : null}
          </>
        );
      }}
    </ChartFrame>
  );
}

// Each night as a bar from bedtime (top) to wake time (bottom) on a clock
// axis, so its length is time in bed, over a band for the usual night.
// Missing nights are gaps.
export type SleepNight = { date: string; bedtime: string | null; wakeTime: string | null; minutes: number | null };

// Clock "HH:MM" as minutes after 6 pm, so 1 am sorts after 11 pm.
const eveningOf = (time: string) => (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - 18 * 60 + 1440) % 1440;

function clockLabel(evening: number, withMinutes = false) {
  const total = Math.round(evening + 18 * 60) % 1440;
  const hour = Math.floor(total / 60);
  const minutes = total % 60;
  const h12 = hour % 12 || 12;
  return `${h12}${withMinutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hour < 12 ? "am" : "pm"}`;
}

export function SleepWindowChart({
  nights,
  usual,
  color,
  label
}: {
  nights: SleepNight[];
  usual: { bedtime: string; wakeTime: string } | null;
  color: string;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const spans = nights.map((night) => {
    if (!night.bedtime || !night.wakeTime) return null;
    const start = eveningOf(night.bedtime);
    let end = eveningOf(night.wakeTime);
    if (end < start) end += 1440;
    return { start, end };
  });
  const band = usual ? { start: eveningOf(usual.bedtime), end: eveningOf(usual.wakeTime) } : null;
  const edges = [...spans.flatMap((span) => (span ? [span.start, span.end] : [])), ...(band ? [band.start, band.end] : [])];
  if (!edges.length) return null;
  const range = Math.max(...edges) - Math.min(...edges);
  const step = range > 6 * 60 ? 120 : 60;
  const lo = Math.floor((Math.min(...edges) - 20) / step) * step;
  const hi = Math.ceil((Math.max(...edges) + 20) / step) * step;
  const ticks = Array.from({ length: (hi - lo) / step + 1 }, (_, index) => lo + index * step);

  return (
    <ChartFrame label={label}>
      {(width) => {
        const plotWidth = width - MARGIN.left - MARGIN.right;
        const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
        const slot = plotWidth / nights.length;
        const barWidth = Math.max(2, Math.min(24, slot - 2));
        const x = (index: number) => MARGIN.left + slot * index + slot / 2;
        const y = (value: number) => MARGIN.top + ((value - lo) / (hi - lo)) * plotHeight;
        const activeNight = active == null ? null : nights[active];

        return (
          <>
            <svg width={width} height={HEIGHT}>
              {band ? (
                <rect
                  x={MARGIN.left}
                  y={y(band.start)}
                  width={plotWidth}
                  height={Math.max(0, y(band.end) - y(band.start))}
                  fill={color}
                  opacity={0.1}
                  aria-hidden="true"
                />
              ) : null}
              <Axes width={width} ticks={ticks} y={y} days={nights.map((night) => night.date)} x={x} formatTick={(tick) => clockLabel(tick)} />
              {spans.map((span, index) =>
                span ? (
                  <rect
                    key={nights[index].date}
                    x={x(index) - barWidth / 2}
                    y={y(span.start)}
                    width={barWidth}
                    height={Math.max(2, y(span.end) - y(span.start))}
                    rx={4}
                    fill={color}
                    opacity={active != null && active !== index ? 0.55 : 1}
                  />
                ) : null
              )}
              {nights.map((night, index) => (
                <rect
                  key={night.date}
                  x={MARGIN.left + slot * index}
                  y={MARGIN.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatDay(night.date, true)}: ${
                    night.bedtime && night.wakeTime ? `${clockLabel(eveningOf(night.bedtime), true)} to ${clockLabel(eveningOf(night.wakeTime), true)}` : "no data"
                  }`}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              ))}
            </svg>
            {activeNight && active != null ? (
              <Tooltip
                x={x(active)}
                width={width}
                title={formatDay(activeNight.date, true)}
                rows={
                  activeNight.bedtime && activeNight.wakeTime
                    ? [
                        {
                          color,
                          label: "in bed",
                          value: `${clockLabel(eveningOf(activeNight.bedtime), true)} – ${clockLabel(eveningOf(activeNight.wakeTime), true)}`
                        },
                        { color: "transparent", label: "asleep", value: activeNight.minutes == null ? "–" : FORMATTERS.hours(activeNight.minutes / 60) }
                      ]
                    : [{ color: "transparent", label: "", value: "No data" }]
                }
              />
            ) : null}
            {usual ? (
              <p className="chart-note">
                Shaded: your usual night, {clockLabel(eveningOf(usual.bedtime), true)} – {clockLabel(eveningOf(usual.wakeTime), true)}
              </p>
            ) : null}
          </>
        );
      }}
    </ChartFrame>
  );
}

// Bars and a line on one axis, each as a percent of its own goal, so two
// measures of different size (calories, protein grams) share the one y-axis.
// The dashed line is the goal; the tooltip shows the real values.
export type GoalSeries = { label: string; color: string; goal: number; format: ValueFormat; values: (number | null)[] };

export function GoalComboChart({
  days,
  bars,
  line,
  partialDay,
  label
}: {
  days: string[];
  bars: GoalSeries;
  line: GoalSeries;
  partialDay?: string | null;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const pct = (series: GoalSeries, index: number) => {
    const value = series.values[index];
    return value == null || series.goal <= 0 ? null : (value / series.goal) * 100;
  };
  const barPcts = days.map((_, index) => pct(bars, index));
  const linePcts = days.map((_, index) => pct(line, index));
  const max = Math.max(100, ...barPcts.map((value) => value ?? 0), ...linePcts.map((value) => value ?? 0));
  const { hi, ticks } = niceDomain(0, max);

  return (
    <>
      <ChartLegend
        series={[
          { key: "bars", label: bars.label, color: bars.color },
          { key: "line", label: line.label, color: line.color }
        ]}
      />
      <ChartFrame label={label}>
        {(width) => {
          const plotWidth = width - MARGIN.left - MARGIN.right;
          const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
          const band = plotWidth / days.length;
          const barWidth = Math.max(2, Math.min(24, band - 2));
          const x = (index: number) => MARGIN.left + band * index + band / 2;
          const y = (value: number) => MARGIN.top + plotHeight - (value / hi) * plotHeight;
          // Missing days break the line into runs.
          const runs: number[][] = [];
          linePcts.forEach((value, index) => {
            if (value == null) return;
            const last = runs.at(-1);
            if (last && last.at(-1) === index - 1) last.push(index);
            else runs.push([index]);
          });
          const row = (series: GoalSeries, index: number) => {
            const value = series.values[index];
            const percent = pct(series, index);
            return {
              color: series.color,
              label: series.label,
              value: value == null ? "–" : `${FORMATTERS[series.format](value)} · ${Math.round(percent ?? 0)}%`
            };
          };
          return (
            <>
              <svg width={width} height={HEIGHT}>
                <Axes width={width} ticks={ticks} y={y} days={days} x={x} suffix="%" />
                <g aria-hidden="true">
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(100)} y2={y(100)} className="chart-reference" />
                  <text x={width - MARGIN.right} y={y(100) - 4} textAnchor="end" className="chart-reference-label">
                    goal
                  </text>
                </g>
                {barPcts.map((value, index) =>
                  value == null || value <= 0 ? null : (
                    <path
                      key={days[index]}
                      d={roundedTop(x(index) - barWidth / 2, y(value), barWidth, y(0) - y(value), 4)}
                      fill={bars.color}
                      opacity={(days[index] === partialDay ? 0.45 : 1) * (active != null && active !== index ? 0.55 : 1)}
                    />
                  )
                )}
                {runs.map((run) =>
                  run.length === 1 ? null : (
                    <path
                      key={run[0]}
                      d={run.map((index, step) => `${step ? "L" : "M"}${x(index)},${y(linePcts[index]!)}`).join("")}
                      fill="none"
                      stroke={line.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  )
                )}
                {linePcts.map((value, index) =>
                  value == null ? null : (
                    <circle key={days[index]} cx={x(index)} cy={y(value)} r={4} fill={line.color} stroke={SURFACE} strokeWidth={2} />
                  )
                )}
                {days.map((day, index) => (
                  <rect
                    key={day}
                    x={MARGIN.left + band * index}
                    y={MARGIN.top}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${formatDay(day, true)}: ${bars.label} ${row(bars, index).value}, ${line.label} ${row(line, index).value}`}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                  />
                ))}
              </svg>
              {active != null ? (
                <Tooltip
                  x={x(active)}
                  width={width}
                  title={`${formatDay(days[active], true)}${days[active] === partialDay ? " · so far" : ""}`}
                  rows={[row(bars, active), row(line, active)]}
                />
              ) : null}
            </>
          );
        }}
      </ChartFrame>
    </>
  );
}

export function LineChart({
  data,
  series,
  format: formatName,
  label
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  format: ValueFormat;
  label: string;
}) {
  const format = FORMATTERS[formatName];
  const [active, setActive] = useState<number | null>(null);
  const values = data.flatMap((datum) =>
    series.map((item) => datum.values[item.key]).filter((value): value is number => value != null)
  );
  if (!values.length) {
    return <p className="muted chart-empty">No data in this range.</p>;
  }
  const { lo, hi, ticks } = niceDomain(Math.min(...values), Math.max(...values));
  const lastIndexes = series.map((item) => data.map((datum) => datum.values[item.key] != null).lastIndexOf(true));
  const lastIndex = Math.max(...lastIndexes);

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((current) => Math.min(data.length - 1, Math.max(0, (current ?? lastIndex) + step)));
  }

  return (
    <ChartFrame label={label}>
      {(width) => {
        const margin = { ...MARGIN, right: 44 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = HEIGHT - margin.top - margin.bottom;
        const x = (index: number) =>
          margin.left + (data.length === 1 ? plotWidth / 2 : (plotWidth * index) / (data.length - 1));
        const y = (value: number) => margin.top + plotHeight - ((value - lo) / (hi - lo)) * plotHeight;
        const activeDatum = active == null ? null : data[active];

        // End labels only when they don't collide; otherwise legend + tooltip carry the values.
        const endLabels = series
          .map((item, seriesIndex) => {
            const index = lastIndexes[seriesIndex];
            return index < 0 ? null : { item, index, y: y(data[index].values[item.key] as number) };
          })
          .filter((entry): entry is { item: ChartSeries; index: number; y: number } => entry != null);
        const labelsFit = endLabels.every((entry, index) =>
          endLabels.every((other, otherIndex) => otherIndex === index || Math.abs(other.y - entry.y) >= 14)
        );

        return (
          <>
            <svg
              width={width}
              height={HEIGHT}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - bounds.left - margin.left) / plotWidth;
                setActive(Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1)))));
              }}
              onPointerLeave={() => setActive(null)}
            >
              <Axes width={width} right={margin.right} ticks={ticks} y={y} days={data.map((datum) => datum.day)} x={x} />
              {series.map((item) => {
                // Break the line at missing days rather than bridging them.
                const runs: number[][] = [];
                data.forEach((datum, index) => {
                  if (datum.values[item.key] == null) {
                    return;
                  }
                  const previous = runs[runs.length - 1];
                  if (previous && previous[previous.length - 1] === index - 1) {
                    previous.push(index);
                  } else {
                    runs.push([index]);
                  }
                });
                const point = (index: number) => y(data[index].values[item.key] as number);
                return (
                  <g key={item.key}>
                    {runs.map((run) =>
                      run.length === 1 ? (
                        <circle key={run[0]} cx={x(run[0])} cy={point(run[0])} r={3} fill={item.color} />
                      ) : (
                        <polyline
                          key={run[0]}
                          points={run.map((index) => `${x(index)},${point(index)}`).join(" ")}
                          fill="none"
                          stroke={item.color}
                          strokeWidth={2}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      )
                    )}
                  </g>
                );
              })}
              {activeDatum ? (
                <line
                  x1={x(active as number)}
                  x2={x(active as number)}
                  y1={margin.top}
                  y2={margin.top + plotHeight}
                  className="chart-crosshair"
                />
              ) : null}
              {series.flatMap((item, seriesIndex) =>
                [active, lastIndexes[seriesIndex]]
                  .filter((index): index is number => index != null && index >= 0)
                  .filter((index) => data[index].values[item.key] != null)
                  .map((index) => (
                    <circle
                      key={`${item.key}-${index}`}
                      cx={x(index)}
                      cy={y(data[index].values[item.key] as number)}
                      r={4}
                      fill={item.color}
                      stroke={SURFACE}
                      strokeWidth={2}
                    />
                  ))
              )}
              {labelsFit
                ? endLabels.map((entry) => (
                    <text key={entry.item.key} x={x(entry.index) + 8} y={entry.y} dy="0.32em" className="chart-end-label">
                      {format(data[entry.index].values[entry.item.key] as number)}
                    </text>
                  ))
                : null}
            </svg>
            {activeDatum && active != null ? (
              <Tooltip
                x={x(active)}
                width={width}
                title={`${formatDay(activeDatum.day, true)}${activeDatum.partial ? " · so far" : ""}`}
                rows={series.map((item) => {
                  const value = activeDatum.values[item.key];
                  return { color: item.color, label: item.label, value: value == null ? "No data" : format(value) };
                })}
              />
            ) : null}
          </>
        );
      }}
    </ChartFrame>
  );
}

export type VitalPanel = {
  key: string;
  label: string; // "Resting HR"
  unit: string; // "bpm"
  values: (number | null)[];
  usual: number | null;
  off: boolean[]; // past the vital's threshold that day
  color: string;
};

const PANEL_HEIGHT = 92;
const PANEL_MARGIN = { top: 18, right: 14, bottom: 8, left: 36 };

// Two or more vitals over the same days as small charts stacked on one
// timeline, each with its own y-axis (one axis per chart), a dashed usual
// line, and red dots on days off the usual. Touching shows every vital for
// that day.
export function VitalsChart({ days, panels, label }: { days: string[]; panels: VitalPanel[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const axisHeight = 20;
  const height = panels.length * PANEL_HEIGHT + axisHeight;
  return (
    <ChartFrame label={label}>
      {(width) => {
        const plotWidth = width - PANEL_MARGIN.left - PANEL_MARGIN.right;
        const x = (index: number) => PANEL_MARGIN.left + (days.length === 1 ? plotWidth / 2 : (plotWidth * index) / (days.length - 1));
        const pick = (clientX: number, left: number) =>
          setActive(Math.min(days.length - 1, Math.max(0, Math.round(((clientX - left - PANEL_MARGIN.left) / plotWidth) * (days.length - 1)))));
        return (
          <>
            <svg
              width={width}
              height={height}
              onPointerMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect().left)}
              onPointerDown={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect().left)}
              onPointerLeave={() => setActive(null)}
            >
              {panels.map((panel, panelIndex) => {
                const top = panelIndex * PANEL_HEIGHT;
                const plotHeight = PANEL_HEIGHT - PANEL_MARGIN.top - PANEL_MARGIN.bottom;
                const known = panel.values.filter((value): value is number => value != null);
                const { lo, hi, ticks } = niceDomain(
                  Math.min(...known, panel.usual ?? Infinity),
                  Math.max(...known, panel.usual ?? -Infinity),
                  2
                );
                const y = (value: number) => top + PANEL_MARGIN.top + plotHeight - ((value - lo) / (hi - lo || 1)) * plotHeight;
                const runs: number[][] = [];
                panel.values.forEach((value, index) => {
                  if (value == null) return;
                  const previous = runs[runs.length - 1];
                  if (previous && previous[previous.length - 1] === index - 1) previous.push(index);
                  else runs.push([index]);
                });
                const last = panel.values.map((value) => value != null).lastIndexOf(true);
                return (
                  <g key={panel.key}>
                    <text x={PANEL_MARGIN.left} y={top + 11} className="chart-panel-label">
                      {panel.label} <tspan className="chart-panel-unit">{panel.unit}</tspan>
                    </text>
                    {ticks.map((tick) => (
                      <g key={tick} aria-hidden="true">
                        <line x1={PANEL_MARGIN.left} x2={width - PANEL_MARGIN.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
                        <text x={PANEL_MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
                          {tickFormat.format(tick)}
                        </text>
                      </g>
                    ))}
                    {panel.usual != null ? (
                      <g aria-hidden="true">
                        <line x1={PANEL_MARGIN.left} x2={width - PANEL_MARGIN.right} y1={y(panel.usual)} y2={y(panel.usual)} className="chart-reference" />
                        <text x={width - PANEL_MARGIN.right} y={y(panel.usual) - 4} textAnchor="end" className="chart-reference-label">
                          usual {Math.round(panel.usual)}
                        </text>
                      </g>
                    ) : null}
                    {runs.map((run) =>
                      run.length > 1 ? (
                        <polyline
                          key={run[0]}
                          points={run.map((index) => `${x(index)},${y(panel.values[index] as number)}`).join(" ")}
                          fill="none"
                          stroke={panel.color}
                          strokeWidth={2}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      ) : null
                    )}
                    {panel.values.map((value, index) =>
                      value == null ? null : (
                        <circle
                          key={index}
                          cx={x(index)}
                          cy={y(value)}
                          r={index === last || index === active ? 4.5 : 3}
                          fill={panel.off[index] ? "var(--status-low)" : panel.color}
                          stroke={SURFACE}
                          strokeWidth={index === last || index === active ? 2 : 1}
                        />
                      )
                    )}
                  </g>
                );
              })}
              {active != null ? (
                <line x1={x(active)} x2={x(active)} y1={0} y2={panels.length * PANEL_HEIGHT} className="chart-crosshair" />
              ) : null}
              {days.map((day, index) => (
                <text
                  key={day}
                  x={x(index)}
                  y={height - 6}
                  textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
                  className="chart-tick"
                >
                  {new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}
                </text>
              ))}
            </svg>
            {active != null ? (
              <Tooltip
                x={x(active)}
                width={width}
                title={formatDay(days[active], true)}
                rows={panels.map((panel) => ({
                  color: panel.off[active] ? "var(--status-low)" : panel.color,
                  label: panel.label,
                  value: panel.values[active] == null ? "No data" : `${Math.round(panel.values[active] as number)} ${panel.unit}`
                }))}
              />
            ) : null}
          </>
        );
      }}
    </ChartFrame>
  );
}
