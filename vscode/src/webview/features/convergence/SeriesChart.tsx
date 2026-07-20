import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";

export interface ChartPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number | null;
  readonly ariaLabel: string;
  readonly displayLabel?: string;
  readonly selectionIndex?: number;
}

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly ChartPoint[];
}

export interface AxisDescriptor {
  readonly label: string;
  readonly unit?: string;
}

export interface ChartRendererContract {
  readonly series: readonly ChartSeries[];
  readonly xAxis: AxisDescriptor;
  readonly yAxis: AxisDescriptor;
  readonly selectedIndex?: number;
  readonly onSelect?: (selectionIndex: number) => void;
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

function numericDomain(values: readonly number[]): readonly [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  const minimum = Math.min(...finite),
    maximum = Math.max(...finite);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.1, 1e-6);
    return [minimum - padding, maximum + padding];
  }
  return [minimum, maximum];
}

function yDomain(series: readonly ChartSeries[]): readonly [number, number] {
  const values = series.flatMap(({ points }) =>
    points.flatMap(({ y }) => (y === null ? [] : [y])),
  );
  const [minimum, maximum] = numericDomain(values);
  if (values.length === 0) return [minimum, maximum];
  const padding = (maximum - minimum) * 0.08;
  return [minimum - padding, maximum + padding];
}

function xFor(x: number, domain: readonly [number, number]): number {
  return LEFT + ((x - domain[0]) / (domain[1] - domain[0])) * (WIDTH - LEFT - RIGHT);
}

function yFor(y: number, domain: readonly [number, number]): number {
  return TOP + ((domain[1] - y) / (domain[1] - domain[0])) * (HEIGHT - TOP - BOTTOM);
}

function segments(points: readonly ChartPoint[]): readonly (readonly ChartPoint[])[] {
  const result: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(point);
  }
  if (current.length) result.push(current);
  return result;
}

const axisTitle = ({ label, unit }: AxisDescriptor): string =>
  unit ? `${label} (${unit})` : label;

/** Renderer-agnostic offline SVG chart seam; analysis-specific adapters provide selection metadata. */
export function SeriesChart({
  ariaLabel,
  series,
  xAxis,
  yAxis,
  selectedIndex,
  onSelect,
}: SeriesChartProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [, resized] = useReducer((value: number) => value + 1, 0);
  const xRange = useMemo(
    () =>
      numericDomain(
        series.flatMap(({ points }) => points.map(({ x }) => x)),
      ),
    [series],
  );
  const yRange = useMemo(() => yDomain(series), [series]);
  const tickPoints = (series[0]?.points ?? []).filter(
    (point, position, points) =>
      position === 0 ||
      position === points.length - 1 ||
      (point.selectionIndex !== undefined &&
        point.selectionIndex === selectedIndex),
  );
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => resized());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="convergence-chart" ref={container} data-chart-backend="svg">
      <svg
        data-testid={`${ariaLabel}-visual`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <line className="chart-axis" x1={LEFT} x2={LEFT} y1={TOP} y2={HEIGHT - BOTTOM} />
        <line className="chart-axis" x1={LEFT} x2={WIDTH - RIGHT} y1={HEIGHT - BOTTOM} y2={HEIGHT - BOTTOM} />
        <text className="chart-tick" x={LEFT - 5} y={TOP + 4}>{yRange[1].toPrecision(4)}</text>
        <text className="chart-tick" x={LEFT - 5} y={HEIGHT - BOTTOM}>{yRange[0].toPrecision(4)}</text>
        <text className="chart-axis-label" x={(LEFT + WIDTH - RIGHT) / 2} y={HEIGHT - 8}>{axisTitle(xAxis)}</text>
        <text className="chart-y-label" x={LEFT + 4} y={TOP + 10}>{axisTitle(yAxis)}</text>
        {tickPoints.map((point) => (
          <text key={point.id} className="chart-x-tick" x={xFor(point.x, xRange)} y={HEIGHT - BOTTOM + 13}>
            {point.displayLabel ?? point.x}
          </text>
        ))}
        {series.map((item, seriesIndex) => (
          <g key={item.id} data-series={seriesIndex}>
            {segments(item.points).map((segment, segmentIndex) => (
              <polyline
                key={segmentIndex}
                className="chart-line"
                points={segment.map((point) => `${xFor(point.x, xRange)},${yFor(point.y!, yRange)}`).join(" ")}
              />
            ))}
            {item.points.filter((point) => point.y !== null && Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => {
              const selected = point.selectionIndex !== undefined && point.selectionIndex === selectedIndex;
              return (
              <circle
                key={point.id}
                className="chart-point"
                data-selected={selected}
                cx={xFor(point.x, xRange)}
                cy={yFor(point.y!, yRange)}
                r={selected ? 5 : 3}
              />
              );
            })}
          </g>
        ))}
      </svg>
      <ul className="chart-legend" aria-label={`${ariaLabel} legend`}>
        {series.map((item, index) => (
          <li key={item.id} data-series={index}>
            {yAxis.unit ? `${item.label} (${yAxis.unit})` : item.label}
          </li>
        ))}
      </ul>
      {onSelect && (
        <div className="chart-point-controls" aria-label={`${ariaLabel} data points`}>
          {series.flatMap((item) => item.points).filter((point) => point.selectionIndex !== undefined).map((point) => (
            <button
              key={point.id}
              type="button"
              aria-label={point.ariaLabel}
              aria-pressed={point.selectionIndex === selectedIndex}
              aria-current={point.selectionIndex === selectedIndex ? "true" : undefined}
              onClick={() => onSelect(point.selectionIndex!)}
            >
              {point.displayLabel ?? point.x}
            </button>
          ))}
        </div>
      )}
      {series.every(({ points }) => points.every(({ y }) => y === null)) && <p className="chart-unavailable">No values available</p>}
    </div>
  );
}
