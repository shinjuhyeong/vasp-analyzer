import type { ReactElement } from "react";

import type {
  IonicStep,
  SelectiveMask,
  Site,
  Vec3,
} from "../../core/contracts.js";

export interface DataTableFallbackProps {
  readonly sites: readonly Site[];
  readonly step: IonicStep;
  readonly reason: string;
}

const vector = (value: Vec3 | undefined | null): string =>
  value
    ? value.map((component) => component.toFixed(6)).join(" ")
    : "Unavailable";
const constraints = ({ x, y, z }: SelectiveMask): string =>
  [x, y, z]
    .map((value) => (value === null ? "?" : value ? "T" : "F"))
    .join(" ");

export function DataTableFallback({
  sites,
  step,
  reason,
}: DataTableFallbackProps): ReactElement {
  return (
    <section className="data-fallback" aria-label="Structure data fallback">
      <p role="alert">3D view unavailable: {reason}</p>
      <div className="data-table-scroll">
        <table aria-label="Atomic positions and forces">
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Element</th>
              <th scope="col">Fractional</th>
              <th scope="col">Cartesian (angstrom)</th>
              <th scope="col">Raw force (eV/angstrom)</th>
              <th scope="col">Free force (eV/angstrom)</th>
              <th scope="col">Constraints</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site, position) => (
              <tr key={site.siteIndex}>
                <th scope="row">{site.siteIndex + 1}</th>
                <td>{site.element}</td>
                <td>{vector(step.fractionalPositions[position])}</td>
                <td>{vector(step.cartesianPositions[position])}</td>
                <td>{vector(step.rawForces[position])}</td>
                <td>{vector(step.freeForces?.[position])}</td>
                <td>{constraints(site.selectiveDynamics)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
