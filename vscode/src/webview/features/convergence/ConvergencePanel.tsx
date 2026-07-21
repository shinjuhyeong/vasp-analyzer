import type { ReactElement } from "react";

import {
  ConvergenceWorkspace,
  type ConvergenceWorkspaceProps,
} from "./ConvergenceWorkspace.js";

/** Stable analysis-region boundary retained while module bodies evolve independently. */
export function ConvergencePanel(props: ConvergenceWorkspaceProps): ReactElement {
  return <ConvergenceWorkspace {...props} />;
}
