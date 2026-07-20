import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import type { PlotPoint, PlotSeries } from "./analysisSeries.js";

export interface ChartRendererContract {
  readonly series: readonly PlotSeries[];
  readonly selectedIndex: number;
  readonly onSelect: (arrayIndex: number) => void;
}

export interface SeriesChartProps extends ChartRendererContract {
  readonly ariaLabel: string;
}

const WIDTH = 640;
const HEIGHT = 190;
const LEFT = 54;
const RIGHT = 16;
const TOP = 18;
const BOTTOM = 34;

function finiteRange(series: readonly PlotSeries[]): readonly [number, number] {
  const values = series.flatMap(({ points }) =>
    points.flatMap(({ value }) => (value === null ? [] : [value])),
  );
  if (values.length === 0) return [0, 1];
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.1, 1e-6);
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.08;
  return [minimum - padding, maximum + padding];
}

function xFor(point: PlotPoint, count: number): number {
  if (count <= 1) return (LEFT + WIDTH - RIGHT) / 2;
  return LEFT + (point.arrayIndex / (count - 1)) * (WIDTH - LEFT - RIGHT);
}

function yFor(value: number, range: readonly [number, number]): number {
  return (
    TOP +
    ((range[1] - value) / (range[1] - range[0])) *
      (HEIGHT - TOP - BOTTOM)
  );
}

function segments(
  points: readonly PlotPoint[],
): readonly (readonly PlotPoint[])[] {
  const result: PlotPoint[][] = [];
  let current: PlotPoint[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(point);
  }
  if (current.length) result.push(current);
  return result;
}

function choose(
  event: KeyboardEvent<SVGGElement>,
  point: PlotPoint,
  onSelect: (arrayIndex: number) => void,
): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect(point.arrayIndex);
}

/** Renderer-agnostic offline SVG chart seam; a canvas backend can replace it later. */
export function SeriesChart({
  ariaLabel,
  series,
  selectedIndex,
  onSelect,
}: SeriesChartProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [, resized] = useReducer((value: number) => value + 1, 0);
  const range = useMemo(() => finiteRange(series), [series]);
  const count = Math.max(0, ...series.map(({ points }) => points.length));
  const xPoints = series[0]?.points ?? [];
  const ticks = xPoints.filter(
    (point) =>
      point.arrayIndex === 0 ||
      point.arrayIndex === selectedIndex ||
      point.arrayIndex === xPoints.length - 1,
  );
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => resized());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="convergence-chart"
      ref={container}
      data-chart-backend="svg"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <line
          className="chart-axis"
          x1={LEFT}
          x2={LEFT}
          y1={TOP}
          y2={HEIGHT - BOTTOM}
        />
        <line
          className="chart-axis"
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={HEIGHT - BOTTOM}
          y2={HEIGHT - BOTTOM}
        />
        <text className="chart-tick" x={LEFT - 5} y={TOP + 4}>
          {range[1].toPrecision(4)}
        </text>
        <text className="chart-tick" x={LEFT - 5} y={HEIGHT - BOTTOM}>
          {range[0].toPrecision(4)}
        </text>
        <text
          className="chart-axis-label"
          x={(LEFT + WIDTH - RIGHT) / 2}
          y={HEIGHT - 8}
        >
          Ionic step
        </text>
        {ticks.map((point) => (
          <text
            key={point.arrayIndex}
            className="chart-x-tick"
            x={xFor(point, count)}
            y={HEIGHT - BOTTOM + 13}
          >
            {point.displayedStep}
          </text>
        ))}
        {series.map((item, seriesIndex) => (
          <g key={item.id} data-series={seriesIndex}>
            {segments(item.points).map((segment, segmentIndex) => (
              <polyline
                key={segmentIndex}
                className="chart-line"
                points={segment
                  .map(
                    (point) =>
                      `${xFor(point, count)},${yFor(point.value!, range)}`,
                  )
                  .join(" ")}
              />
            ))}
            {item.points
              .filter((point) => point.value !== null)
              .map((point) => (
              <g
                key={point.arrayIndex}
                role="button"
                tabIndex={0}
                aria-label={point.ariaLabel}
                aria-pressed={point.arrayIndex === selectedIndex}
                onClick={() => onSelect(point.arrayIndex)}
                onKeyDown={(event) => choose(event, point, onSelect)}
              >
                <circle
                  className="chart-hit-target"
                  cx={xFor(point, count)}
                  cy={yFor(point.value!, range)}
                  r="9"
                />
                <circle
                  className="chart-point"
                  data-selected={point.arrayIndex === selectedIndex}
                  cx={xFor(point, count)}
                  cy={yFor(point.value!, range)}
                  r={point.arrayIndex === selectedIndex ? 5 : 3}
                />
              </g>
              ))}
          </g>
        ))}
      </svg>
      <ul className="chart-legend" aria-label={`${ariaLabel} legend`}>
        {series.map((item, index) => (
          <li key={item.id} data-series={index}>
            {item.label} ({item.unit})
          </li>
        ))}
      </ul>
      {series.every(({ points }) =>
        points.every(({ value }) => value === null),
      ) && <p className="chart-unavailable">No values available</p>}
    </div>
  );
}
