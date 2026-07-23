export const CALCULATION_OPEN_DIALOG_OPTIONS = {
  canSelectFiles: true,
  canSelectFolders: true,
  canSelectMany: false,
  openLabel: "Open VASP Calculation",
} as const;

export function calculationPanelKey(root: string, profilePath: string | null): string {
  return JSON.stringify([root, profilePath]);
}
