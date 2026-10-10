"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// Inline SVG charts sized to their container. Marks follow the app's chart
// specs: columns <= 24px with a 4px rounded top, 2px lines, >= 8px dots with a
// surface ring, hairline gridlines, one y-axis per chart.

export type ChartSeries = { key: string; label: string; color: string };
export type ChartDatum = { day: string; values: Record<string, number | null>; partial?: boolean };

export type ValueFormat = "steps" | "hours" | "integer" | "kcal";

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Formats are named so server components can choose one; functions can't
// cross the server/client boundary.
const FORMATTERS: Record<ValueFormat, (value: number) => string> = {
  steps: (value) => integerFormat.format(value),
  integer: (value) => integerFormat.format(value),
  kcal: (value) => `${integerFormat.format(value)} kcal`,
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
  x
}: {
  width: number;
  right?: number;
  ticks: number[];
  y: (value: number) => number;
  days: string[];
  x: (index: number) => number;
}) {
  const plotWidth = width - MARGIN.left - right;
  return (
    <g className="chart-axes" aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} x2={width - right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
          <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
            {tickFormat.format(tick)}
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
  label
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  format: ValueFormat;
  label: string;
}) {
  const format = FORMATTERS[formatName];
  const [active, setActive] = useState<number | null>(null);
  const totals = data.map((datum) =>
    series.reduce<number | null>((sum, item) => {
      const value = datum.values[item.key];
      return value == null ? sum : (sum ?? 0) + value;
    }, null)
  );
  const max = Math.max(0, ...totals.map((total) => total ?? 0));
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

// Small trend line for a tile: no axes, missing days break the line, and the
// latest value gets a dot.
export function Sparkline({ values, color, label }: { values: (number | null)[]; color: string; label: string }) {
  const width = 140;
  const height = 40;
  const pad = 5;
  const present = values.filter((value): value is number => value != null);
  if (!present.length) {
    return <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: no data`} />;
  }
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const x = (index: number) => pad + (index / Math.max(1, values.length - 1)) * (width - 2 * pad);
  const y = (value: number) => (hi === lo ? height / 2 : height - pad - ((value - lo) / (hi - lo)) * (height - 2 * pad));

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (current.length) {
        segments.push(current);
      }
      current = [];
    } else {
      current.push({ x: x(index), y: y(value) });
    }
  });
  if (current.length) {
    segments.push(current);
  }
  const lastIndex = values.length - 1;
  const last = values[lastIndex];

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {segments.map((points) =>
        points.length > 1 ? (
          <polyline
            key={`${points[0].x}`}
            points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <circle key={`${points[0].x}`} cx={points[0].x} cy={points[0].y} r="2" fill={color} />
        )
      )}
      {last != null ? <circle cx={x(lastIndex)} cy={y(last)} r="4" fill={color} stroke={SURFACE} strokeWidth="2" /> : null}
    </svg>
  );
}
