# SIESTA Optimization Tools Design

## 1. Goal and Scope

Create three independent Python utilities under `/home/emsl_intern/SIESTA`:

- `kpoints_opt.py` for slab and bulk k-point scans.
- `energy_opt.py` for independent `PAO.EnergyShift` or `Mesh.Cutoff` scans.
- `eos_fitting.py` for slab and bulk equation-of-state scans and fitting.

The utilities follow the workflow of the existing VASP scripts and the input layout in `/home/emsl_intern/SIESTA/01_MoS2/01_ConvergenceTest`. They prepare calculations, optionally execute or submit them, collect final energies, write CSV data, and create plots. K-point and energy scans do not select or recommend an optimum. EOS fitting additionally writes a fitted structure.

The scripts are standalone and do not import a project-specific shared module. They may depend on the Python standard library plus NumPy, SciPy, and Matplotlib for numerical analysis and plotting.

## 2. Installation and Invocation

All three scripts live directly in `/home/emsl_intern/SIESTA`. The user's `pyutility` shell function searches the current directory and its ancestors for `<name>.py`, so calculations anywhere beneath `/home/emsl_intern/SIESTA` can invoke them as:

```bash
pyutility kpoints_opt ...
pyutility energy_opt ...
pyutility eos_fitting ...
```

Each script uses `argparse`. `-h`, `--help`, and the compatibility spelling `-help` display help. Invoking a script without arguments displays its top-level help instead of starting work or reporting a parser error.

In particular, `pyutility energy_opt --help` presents the complete usage for both scan types, their units, ranges, modes, analysis and cleanup commands, output files, and worked examples. Subcommand-specific help remains available but is not required to understand the utility.

## 3. Common Input and Output Layout

The base calculation directory is the current directory unless `--path DIRECTORY` is supplied. A valid base contains:

```text
base/
└── in/
    ├── RUN.fdf
    ├── STRUCT.fdf
    ├── KPT.fdf
    ├── BASIS.fdf
    └── other input assets, includes, and pseudopotentials
```

Each generated case contains an authoritative `in/` copy, an initially empty `out/`, and `run_siesta.sh`. Immediately before execution, the job script copies `in/.` into `out/` and runs from `out/` using:

```bash
source activate siesta
mpirun -np "$SLURM_NTASKS" siesta < RUN.fdf > stdout.txt
```

This preserves relative `%include` and pseudopotential lookup. Original base inputs are never modified.

Every scan root contains `scan_metadata.json`. It records scan type, system type where relevant, vacuum axis, requested values, units, execution settings, base path, and creation time. Analysis reads this metadata so structural options do not need to be repeated.

Common execution options are:

- `--mode slurm|local|prepare`, default `slurm`.
- `--ntasks INTEGER`, default `16`.
- `--partition NAME`, optional; when absent no `#SBATCH --partition` line is emitted.
- `--path DIRECTORY`, default current directory.
- `--overwrite`, which permits regeneration of an existing case input. Without it, existing case directories are preserved and reported.

`slurm` writes the job script and submits it with `sbatch`. `local` runs cases sequentially with the requested MPI task count. `prepare` writes inputs and scripts without running or submitting them.

## 4. K-Point Scan

Example commands:

```bash
pyutility kpoints_opt --system slab --range 3:2:15
pyutility kpoints_opt --system bulk --range 3:2:15 --mode prepare
pyutility kpoints_opt --analyze
```

`--range START:STEP:END` is integer-valued and inclusive of `END` when it lies on the sequence. `--system slab|bulk` is required when preparing a scan.

For bulk, each value `n` produces `n x n x n`. For a slab, the vacuum direction receives one point and the other directions receive `n`; `--vacuum-axis a|b|c` defaults to `c`. The Monkhorst-Pack shift is `0.0 0.0 0.0`.

The utility replaces exactly one `%block kgrid.Monkhorst_Pack` block in `KPT.fdf`. A missing or duplicate block is an error. Cases are stored under `kpoints_opt/kpoints_<n>/`.

Analysis extracts the final total energy from each completed `stdout.txt`, preserves missing and failed cases in `kpoints_opt/results.csv` with status values, and creates `kpoints_opt/kpoints_optimization.png`. It does not apply a convergence threshold or name an optimal grid.

## 5. Energy-Parameter Scan

Top-level and detailed help examples are:

```bash
pyutility energy_opt
pyutility energy_opt --help
pyutility energy_opt energy-shift --help
pyutility energy_opt mesh-cutoff --help
```

Execution and analysis examples are:

```bash
pyutility energy_opt energy-shift --range 20:20:200
pyutility energy_opt mesh-cutoff --range 200:50:600
pyutility energy_opt --analyze energy-shift
pyutility energy_opt --analyze mesh-cutoff
pyutility energy_opt --clean energy-shift
```

Only one parameter is scanned per invocation. Combined or Cartesian-product scans are not supported.

### 5.1 PAO.EnergyShift

`energy-shift` accepts a numeric `START:STEP:END` range. The default unit is `meV`, with `meV`, `eV`, and `Ry` accepted through `--unit`. The utility replaces exactly one active `PAO.EnergyShift` assignment in `BASIS.fdf`; a missing or duplicate active assignment is an error. Cases are stored under `energy_opt/energy_shift_<value><unit>/`.

### 5.2 Mesh.Cutoff

`mesh-cutoff` accepts a numeric `START:STEP:END` range. The default unit is `Ry`, with `Ry` and `eV` accepted through `--unit`. The utility replaces exactly one active `Mesh.Cutoff` assignment in `RUN.fdf`; a missing or duplicate active assignment is an error. Cases are stored under `energy_opt/mesh_cutoff_<value><unit>/`.

Each scan type writes its own CSV and PNG plot without selecting an optimum. Analysis never combines the two parameter scans.

## 6. EOS Scan and Fitting

Example commands:

```bash
pyutility eos_fitting --system bulk --range 0.94:1.06 --samples 7
pyutility eos_fitting --system slab --range 0.94:1.06 --samples 7
pyutility eos_fitting --analyze
```

`--range MIN:MAX` and `--samples N` generate `N` evenly spaced scale factors including both endpoints. At least five valid scale points are required for a bulk Birch-Murnaghan fit, and at least three are required for a slab quadratic fit. Cases are stored under `eos_fitting/scale_<factor>/`.

For bulk, all three lattice vectors are multiplied by the scale factor. Cartesian atomic coordinates are scaled in all three Cartesian directions. The analysis fits energy versus volume to a third-order Birch-Murnaghan equation of state and reports `E0`, `V0`, `B0` in GPa, and `B0'`.

For a slab, `--vacuum-axis a|b|c` defaults to `c`. The two non-vacuum lattice vectors are multiplied by the scale factor while the vacuum lattice vector is unchanged. Cartesian coordinates are transformed consistently by converting them through fractional coordinates, applying the scaled lattice, and converting back to the original coordinate unit. Fractional or scaled coordinates retain their numeric fractional values. The analysis fits a quadratic polynomial to energy versus in-plane cell area and reports the fitted minimum energy and area.

Both modes create `eos_fitting/results.csv` and `eos_fitting/eos_fitting.png`. If the fitted equilibrium lies outside the sampled range, the fit is reported but `STRUCT_eos_optimized.fdf` is not created. Otherwise:

- Bulk writes a structure whose lattice has been isotropically scaled to the fitted `V0`.
- Slab writes a structure whose non-vacuum lattice vectors have been isotropically scaled in-plane to the fitted equilibrium area; the vacuum vector is unchanged.
- Cartesian coordinates follow the same lattice transformation, while fractional coordinates remain numerically unchanged.

Only `STRUCT_eos_optimized.fdf` is generated. The utility does not modify the base `STRUCT.fdf` and does not create or submit an additional relaxation automatically.

## 7. Parsing and File-Safety Rules

FDF keyword matching is case-insensitive and ignores leading whitespace. Commented definitions are ignored. Keyword values retain explicit units. Replacements preserve unrelated lines and comments wherever possible.

The structure parser supports `LatticeConstant`, a single `%block LatticeVectors`, `AtomicCoordinatesFormat`, and a single `%block AtomicCoordinatesAndAtomicSpecies`. It handles Ang, Bohr, fractional/scaled, and Cartesian coordinate forms used by SIESTA 5.4.2. Unsupported or ambiguous coordinate formats fail before case generation rather than being guessed.

Before preparation, a utility validates all four required FDF files, the requested range, units, system type, and relevant target block or keyword. It prepares all case contents before submitting the first case, preventing a partially submitted scan caused by a later input-generation error.

Cleanup is limited to the selected generated scan directory. It requires interactive confirmation unless `--yes` is supplied. It never deletes unrelated files in the base directory.

## 8. Result Status and Error Handling

Each requested point appears in CSV with a status:

- `complete`: normal SIESTA termination and a parsed final energy.
- `incomplete`: output exists but lacks normal termination or final energy.
- `failed`: execution or scheduler submission returned a nonzero status, when known.
- `missing`: no output file exists.

Plots use only complete points. The command prints counts for every status so omitted points remain visible to the user. A missing executable, failed `sbatch`, failed `mpirun`, malformed output, missing metadata, or inconsistent scan directory produces a nonzero utility exit code and a case-specific message.

EOS fitting additionally refuses to write a fitted structure for insufficient valid points, a failed numerical fit, a non-positive fitted volume or area, or an equilibrium outside the sampled interval.

## 9. Testing and Acceptance Criteria

Automated tests use temporary synthetic fixtures and never submit real jobs. Each standalone script is tested directly.

Coverage includes:

- Inclusive integer and decimal range parsing and invalid ranges.
- Top-level `-h`, `--help`, `-help`, and no-argument help, especially the complete `energy_opt` help.
- Slab grids for each vacuum axis and cubic bulk grids.
- Exact replacement of the k-grid block, `PAO.EnergyShift`, and `Mesh.Cutoff` while preserving unrelated content.
- Detection of missing and duplicate definitions.
- Bulk and slab lattice scaling for Cartesian and fractional coordinates.
- SIESTA energy and normal-termination parsing for complete, incomplete, failed, and missing cases.
- CSV rows for every requested case and plots containing only complete points.
- Synthetic Birch-Murnaghan and quadratic datasets recovering known fitted parameters within numerical tolerances.
- Suppression of the fitted structure when the equilibrium is outside the sampled range.
- Safe cleanup boundaries.

Final server smoke tests run all help variants and one `--mode prepare` scan for each utility against a copied fixture. Acceptance requires the expected case layout, unchanged source inputs, valid metadata, no submitted calculations during smoke testing, and readable generated help.
