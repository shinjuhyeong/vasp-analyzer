import { useMemo, useState, type ReactElement } from "react";

import type {
  ParameterOccurrence,
  ParameterValue,
} from "../../core/contracts.js";

type ParameterView = "interpreted" | "raw";

const CATEGORY_ORDER = [
  "electronic",
  "ionic",
  "spin",
  "symmetry",
  "kpoints",
  "output",
  "other",
] as const;

function categoryOf(parameter: ParameterOccurrence): string {
  return parameter.category?.trim().toLocaleLowerCase() || "other";
}

function categoryRank(category: string): number {
  const rank = CATEGORY_ORDER.indexOf(category as (typeof CATEGORY_ORDER)[number]);
  return rank < 0 ? CATEGORY_ORDER.length : rank;
}

function categoryLabel(category: string): string {
  return category === "kpoints"
    ? "K-points"
    : `${category.charAt(0).toLocaleUpperCase()}${category.slice(1)}`;
}

function formatParameterValue(value: ParameterValue): string {
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function searchableText(parameter: ParameterOccurrence): string {
  return [
    parameter.key,
    parameter.rawKey,
    parameter.rawValue,
    formatParameterValue(parameter.value),
    parameter.category ?? "other",
    parameter.description ?? "",
  ].join(" ").toLocaleLowerCase();
}

export function effectiveParameters(
  occurrences: readonly ParameterOccurrence[],
): readonly ParameterOccurrence[] {
  const latest = new Map<string, ParameterOccurrence>();
  for (const occurrence of occurrences) latest.set(occurrence.key, occurrence);
  return [...latest.values()].sort((left, right) => {
    const leftCategory = categoryOf(left);
    const rightCategory = categoryOf(right);
    return categoryRank(leftCategory) - categoryRank(rightCategory)
      || leftCategory.localeCompare(rightCategory)
      || left.key.localeCompare(right.key);
  });
}

export interface ParametersPanelProps {
  readonly parameters: readonly ParameterOccurrence[];
}

export function ParametersPanel({ parameters }: ParametersPanelProps): ReactElement {
  const [view, setView] = useState<ParameterView>("interpreted");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const effective = useMemo(() => effectiveParameters(parameters), [parameters]);
  const categories = useMemo(
    () => [...new Set(effective.map(categoryOf))].sort((left, right) =>
      categoryRank(left) - categoryRank(right) || left.localeCompare(right)),
    [effective],
  );
  const query = search.trim().toLocaleLowerCase();
  const interpreted = effective.filter((parameter) =>
    (category === "all" || categoryOf(parameter) === category)
    && (!query || searchableText(parameter).includes(query)),
  );
  const raw = [...parameters]
    .sort((left, right) => left.ordinal - right.ordinal)
    .filter((parameter) => !query || searchableText(parameter).includes(query));

  return (
    <section className="parameters-panel" aria-label="OUTCAR parameters">
      <div className="parameters-toolbar">
        <div className="parameters-view-picker" role="group" aria-label="Parameter view">
          <button
            type="button"
            aria-pressed={view === "interpreted"}
            onClick={() => setView("interpreted")}
          >
            Interpreted parameters
          </button>
          <button
            type="button"
            aria-pressed={view === "raw"}
            onClick={() => setView("raw")}
          >
            Raw parameters
          </button>
        </div>
        <label>
          Search
          <input
            type="search"
            aria-label="Search parameters"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {view === "interpreted" && (
          <label>
            Category
            <select
              aria-label="Parameter category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>{categoryLabel(item)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="parameters-origin-note">
        Values are reported by OUTCAR; this view does not infer whether values came from INCAR or VASP defaults.
      </p>
      {view === "raw" ? (
        <table className="detail-table parameters-table" aria-label="Raw OUTCAR parameters">
          <caption>Every parameter occurrence in OUTCAR source order</caption>
          <thead><tr><th scope="col">Occurrence</th><th scope="col">Key</th><th scope="col">Raw value</th><th scope="col">Line</th></tr></thead>
          <tbody>
            {raw.map((parameter) => (
              <tr key={`${parameter.ordinal}:${parameter.rawKey}`}>
                <td>{parameter.ordinal + 1}</td>
                <td>{parameter.rawKey}</td>
                <td>{parameter.rawValue}</td>
                <td>{parameter.lineNumber ?? "Unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="parameter-groups">
          {categories.map((item) => {
            const rows = interpreted.filter((parameter) => categoryOf(parameter) === item);
            if (!rows.length) return null;
            return (
              <section className="parameter-group" key={item}>
                <h3>{categoryLabel(item)}</h3>
                <table className="detail-table parameters-table" aria-label={`${categoryLabel(item)} effective parameters`}>
                  <caption>{categoryLabel(item)} effective values</caption>
                  <thead><tr><th scope="col">Key</th><th scope="col">Effective value</th><th scope="col">Unit</th><th scope="col">Description</th><th scope="col">Source</th></tr></thead>
                  <tbody>
                    {rows.map((parameter) => (
                      <tr key={parameter.key}>
                        <td>{parameter.rawKey}</td>
                        <td>{formatParameterValue(parameter.value)}</td>
                        <td>{parameter.unit ?? "—"}</td>
                        <td>{parameter.description ?? "Unrecognized OUTCAR parameter"}</td>
                        <td>{parameter.lineNumber === null ? `Occurrence ${parameter.ordinal + 1}` : `Line ${parameter.lineNumber}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}
      {(view === "raw" ? raw : interpreted).length === 0 && (
        <p className="empty-detail">No parameters match the current view.</p>
      )}
    </section>
  );
}
