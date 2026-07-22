# SIESTA Cumulative Scans and Basis Enthalpy Design

## 1. Goal

Extend the three standalone utilities in `/home/emsl_intern/SIESTA` so a user can add calculations to an existing scan without losing metadata, then analyze and plot every compatible case together. Extend `energy_opt.py energy-shift` analysis to read SIESTA's basis enthalpy output, plot total energy and basis enthalpy together, and retain orbital volume and basis pressure in CSV output.

The affected scripts are `kpoints_opt.py`, `energy_opt.py`, and `eos_fitting.py`. They remain standalone and do not share a project-specific module.

## 2. Incremental Scan Behavior

Running a utility against an existing compatible scan extends it:

```bash
pyutility kpoints_opt --system slab --range 3:3:12 --mode local
pyutility kpoints_opt --system slab --range 15:3:24 --mode local
pyutility kpoints_opt --analyze
```

The final analysis covers `3, 6, 9, ..., 24`. The same behavior applies to EnergyShift, Mesh.Cutoff, and EOS scans.

Preparation follows these rules:

- Load existing metadata before generating cases.
- Validate that the new request is compatible with the existing scan.
- Merge requested values with existing values, remove duplicates, and sort numerically.
- Preserve every existing case directory by default.
- Skip overlapping values and print their case names.
- With `--overwrite`, regenerate and execute overlapping requested cases, but do not create duplicate metadata entries.
- Add only successfully prepared new cases to the manifest. If later execution or submission fails, retain the case and record the failure state.
- Write metadata atomically through a temporary sibling file and rename it only after the new state is complete.
- Rebuild analysis CSV and PNG files from all manifest cases every time `--analyze` runs.

## 3. Metadata Schema

New and migrated scans use schema version 2:

```json
{
  "schema_version": 2,
  "scan_type": "energy-shift",
  "compatibility": {
    "unit": "meV",
    "input_fingerprint": "sha256-value",
    "file_hashes": {
      "RUN.fdf": "sha256-value"
    }
  },
  "cases": [
    {
      "value": "20",
      "case_name": "energy_shift_20meV",
      "created_at": "ISO-8601 timestamp",
      "last_prepared_at": "ISO-8601 timestamp",
      "mode": "local",
      "execution_status": "prepared"
    }
  ]
}
```

Scan-specific compatibility data also records:

- K-point: `system`, `vacuum_axis`, and zero Monkhorst-Pack shift.
- Energy: scan kind and unit.
- EOS: `system`, `vacuum_axis`, and the unscaled reference structure.
- All scans: relevant execution-independent input hashes and a combined input fingerprint.

Case values remain strings for decimal EnergyShift and Mesh.Cutoff scans so decimal identity and directory names do not change. K-point values are integers and EOS scales use their stable four-decimal case identity.

## 4. Input Compatibility Fingerprints

Continuation is allowed only when physical calculation inputs match. The fingerprint includes all regular files and resolved symlink targets under the base `in/` directory, including pseudopotentials, with the scan-controlled value normalized out:

- K-point normalizes only the `kgrid.Monkhorst_Pack` block in `KPT.fdf`.
- EnergyShift normalizes only the active `PAO.EnergyShift` value and unit in `BASIS.fdf`.
- Mesh.Cutoff normalizes only the active `Mesh.Cutoff` value and unit in `RUN.fdf`.
- EOS does not normalize the reference `STRUCT.fdf`; the exact reference structure is part of compatibility.

Changing XC settings, basis options other than the scanned EnergyShift, mesh cutoff outside a Mesh.Cutoff scan, structure, k-grid outside a k-point scan, included files, or pseudopotentials causes continuation to fail. The error identifies every changed relative file instead of reporting only a generic fingerprint mismatch.

Unit changes are incompatible even when mathematically convertible. Slab/bulk mode and vacuum-axis changes are also incompatible.

## 5. Schema Version 1 Migration

When version 1 metadata is found, the utility performs one migration:

1. Parse the old `values` or `scales` and `case_names` fields.
2. Verify each referenced case directory exists.
3. Compare each case input to the current base input using the same scan-specific normalization.
4. Refuse migration if case inputs imply conflicting physical settings.
5. Save the original as `scan_metadata.v1.backup.json` without overwriting an existing backup.
6. Write schema version 2 atomically.

Migration does not regenerate, execute, or delete any case. A version 1 scan that cannot be proven compatible remains unchanged and produces an actionable error.

## 6. Basis Enthalpy Source and Parsing

SIESTA 5.4.2 defaults `BasisPressure` to `0.2 GPa`. The utilities do not add or override this input. Species-specific `BasisPressure.Specs`, if present, remains valid and is reflected in SIESTA's reported average pressure.

For every completed EnergyShift case, analysis reads `SystemLabel` case-insensitively from its `RUN.fdf`, then parses:

```text
out/<SystemLabel>.BASIS_ENTHALPY
```

The parser consumes the labeled SIESTA 5.4.2 fields:

- `Basis enthalpy [eV]`
- `Free energy [eV]`
- `Orbital volume [Ang**3]`
- `Average basis pressure [eV/Ang**3]`
- `Average basis pressure [GPa]`

The official SIESTA source defines basis enthalpy as free energy plus the orbital-volume contribution. The labeled output file is authoritative; analysis does not recompute basis enthalpy from rounded pressure and volume values.

Primary reference: `https://gitlab.com/siesta-project/siesta/-/raw/5.4.2/Src/basis_enthalpy.f90`.

## 7. EnergyShift CSV and Plot

`energy_opt/energy_shift/results.csv` includes:

```text
value
unit
status
total_energy_eV
basis_enthalpy_eV
orbital_volume_A3
basis_pressure_eV_A3
basis_pressure_GPa
case_name
```

The PNG contains a single energy axis and two labeled curves:

- Total energy.
- `E + p_basis * V_orbitals` basis enthalpy.

Orbital volume is not plotted. It remains available in CSV and the console summary so the user can inspect its change with EnergyShift.

All complete stdout energies appear in the total-energy curve. Only cases with valid basis output appear in the basis-enthalpy curve. The x-axis includes all plotted EnergyShift values and is sorted numerically.

## 8. Missing and Inconsistent Basis Data

EnergyShift analysis assigns these outcomes:

- `complete`: normal SIESTA completion, total energy, and all required basis fields are present.
- `basis-data-missing`: total energy is available but the basis file is absent or incomplete.
- Existing `missing`, `incomplete`, and `failed` states retain their meanings.

Missing basis data does not hide valid total-energy points. It leaves basis columns empty, omits only that point from the basis-enthalpy curve, and prints a case-specific warning.

All valid basis files in one plot must report the same average basis pressure within a strict absolute tolerance of `1e-9 GPa`. A larger difference stops analysis before replacing the existing CSV or plot, preventing incompatible basis enthalpies from being presented as one curve.

## 9. Analyze and Help Behavior

`--analyze` iterates all schema version 2 `cases`, not only the latest requested range. It rewrites CSV and PNG artifacts atomically so a failed parse or fit cannot destroy the last valid analysis.

Help for all three scripts states that:

- Re-running preparation with a compatible new range extends the scan.
- Duplicate values are skipped unless `--overwrite` is used.
- `--analyze` covers the cumulative manifest.
- Incompatible input changes require a new scan directory.
- EnergyShift plots total energy and basis enthalpy, while orbital volume is saved to CSV.

## 10. Error Handling and Safety

- Metadata JSON parse errors, unknown schema versions, duplicate case names with different values, and missing case directories stop continuation without rewriting metadata.
- Case preparation occurs in a temporary sibling directory and is renamed into place only when its input and runner are complete.
- Existing case results are never removed unless the user requests `--overwrite` for that exact value.
- Cleanup behavior remains scoped to the selected scan root.
- Analysis writes temporary CSV and PNG files, validates them, and then replaces final artifacts.
- No Git stage or commit is performed under `/home/emsl_intern`.

## 11. Testing and Acceptance Criteria

Tests are added before implementation and use temporary fixtures without launching SIESTA, MPI, or SLURM. Coverage includes:

- Two disjoint ranges produce a sorted union in metadata.
- Overlapping ranges skip duplicates and preserve existing files.
- `--overwrite` regenerates only explicitly requested overlapping cases.
- Compatible normalized fingerprints pass; changed physical inputs list changed files and fail.
- K-point, EnergyShift, Mesh.Cutoff, and EOS cumulative behavior.
- Successful and rejected schema version 1 migrations and backup preservation.
- Atomic metadata writes under a simulated preparation failure.
- Exact parsing of the labeled SIESTA 5.4.2 basis enthalpy format.
- SystemLabel-based basis filename discovery.
- Missing and incomplete basis-file status behavior.
- Total energy and basis enthalpy plotted together.
- Orbital volume and both pressure units written to CSV.
- Mixed basis pressures rejected before replacing prior analysis output.
- Updated no-argument and `--help` text.
- Existing local direct-SIESTA and SLURM MPI behavior remains unchanged.

Acceptance requires the complete remote test suite to pass, two sequential prepare-mode ranges for each scan to produce cumulative metadata, analysis to include all synthetic completed cases, and source fixture hashes to remain unchanged.
