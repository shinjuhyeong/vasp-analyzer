import type { IonicStep, Site } from "../../core/contracts.js";

interface AtomDetailProps {
  readonly site: Site;
  readonly step: IonicStep;
  readonly sitePosition: number;
}

const format = (value: number): string => value.toFixed(6);
const maskSymbol = (value: boolean | null): string =>
  value === null ? "?" : value ? "T" : "F";

export function AtomDetail({ site, step, sitePosition }: AtomDetailProps) {
  const index = site.siteIndex;
  const fractional = step.fractionalPositions[sitePosition];
  const cartesian = step.cartesianPositions[sitePosition];
  const raw = step.rawForces[sitePosition];
  const free = step.freeForces?.[sitePosition] ?? null;
  const states = site.selectiveDynamics;
  if (!fractional || !cartesian || !raw)
    return (
      <aside className="atom-detail" role="status">
        Atom data unavailable for this step
      </aside>
    );
  const rawNorm = Math.hypot(...raw);
  const freeNorm = free ? Math.hypot(...free) : null;
  const strongest =
    step.strongestFreeComponent?.siteIndex === index
      ? step.strongestFreeComponent
      : null;
  return (
    <aside className="atom-detail" aria-label="Selected atom details">
      <header>
        <strong>
          {site.element} {index + 1}
        </strong>
        <span>siteIndex {index}</span>
      </header>
      <p>Fractional {fractional.map(format).join(" ")}</p>
      <p>Cartesian {cartesian.map(format).join(" ")} angstrom</p>
      <p>Fx {format(raw[0])} eV/angstrom</p>
      <p>Fy {format(raw[1])} eV/angstrom</p>
      <p>Fz {format(raw[2])} eV/angstrom</p>
      <p>|F| {format(rawNorm)} eV/angstrom</p>
      <p>
        Free force{" "}
        {free
          ? `${free.map(format).join(" ")} eV/angstrom; norm ${format(freeNorm!)}`
          : "unknown"}
      </p>
      <p>
        Selective Dynamics {maskSymbol(states.x)} {maskSymbol(states.y)}{" "}
        {maskSymbol(states.z)}
      </p>
      {strongest && (
        <p className="strongest-component">
          Strongest free component: {strongest.axis.toUpperCase()}{" "}
          {format(strongest.value)} eV/angstrom
        </p>
      )}
    </aside>
  );
}
