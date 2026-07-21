from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.core.models import (
    CalculationDataset,
    EnergyTerm,
    ForceComponent,
    IonicStep,
    ParameterOccurrence,
    SelectiveMask,
    SourceFile,
)

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def test_selective_mask_preserves_unknown_state() -> None:
    mask = SelectiveMask(a=True, b=False, c=None)
    assert mask.as_tuple() == (True, False, None)
    assert mask.model_dump(mode="json", by_alias=True) == {"a": True, "b": False, "c": None}


def test_force_component_retains_signed_value() -> None:
    component = ForceComponent(site_index=4, axis="c", value=-0.61)
    assert component.magnitude == 0.61


def test_source_files_are_deeply_immutable(tmp_path: Path) -> None:
    source = SourceFile(path=str(tmp_path / "OUTCAR"), size=7, mtime_ns=11, fingerprint="abc")
    dataset = CalculationDataset(
        root=str(tmp_path),
        source_files=(source,),
        sites=(),
        ionic_steps=(),
        capabilities=(),
    )
    with pytest.raises(ValidationError):
        dataset.source_files = ()


def test_dataset_v2_preserves_energy_stress_and_parameter_occurrences() -> None:
    term = EnergyTerm(
        key="ewald",
        raw_label="Ewald energy",
        value=-123.5,
        unit="eV",
        kind="contribution",
    )
    parameter = ParameterOccurrence(
        key="encut",
        raw_key="ENCUT",
        raw_value="520.0",
        value=520.0,
        unit="eV",
        category="electronic",
        description="Plane-wave cutoff",
        ordinal=0,
        line_number=12,
    )
    step = IonicStep(
        index=0,
        lattice=IDENTITY,
        fractional_positions=(),
        cartesian_positions=(),
        raw_forces=(),
        free_forces=(),
        free_force_norms=(),
        total_energy=-123.5,
        energy_terms=(term,),
        external_pressure_kb=-3.2,
        pulay_stress_kb=0.4,
        stress_tensor_kb=((1.0, 0.1, 0.2), (0.1, 2.0, 0.3), (0.2, 0.3, 3.0)),
        cell_volume=173.0,
        delta_energy=None,
        scf_iterations=None,
        electronic_converged=None,
        ionic_converged=None,
        strongest_free_component=None,
        rms_free_force=None,
    )
    dataset = CalculationDataset(
        root="/calculation",
        source_files=(),
        sites=(),
        ionic_steps=(step,),
        parameters=(parameter,),
        capabilities=(),
    )

    assert dataset.schema_version == 2
    assert dataset.ionic_steps[0].energy_terms[0].raw_label == "Ewald energy"
    assert dataset.parameters[0].value == 520.0
    assert dataset.model_dump(mode="json")["schemaVersion"] == 2


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_new_scientific_values_reject_non_finite_numbers(value: float) -> None:
    with pytest.raises(ValidationError):
        EnergyTerm(
            key="ewald", raw_label="Ewald", value=value, unit="eV", kind="contribution"
        )

    with pytest.raises(ValidationError):
        IonicStep(
            index=0,
            lattice=IDENTITY,
            fractional_positions=(),
            cartesian_positions=(),
            raw_forces=(),
            free_forces=None,
            free_force_norms=None,
            total_energy=None,
            external_pressure_kb=value,
            delta_energy=None,
            scf_iterations=None,
            electronic_converged=None,
            ionic_converged=None,
            strongest_free_component=None,
            rms_free_force=None,
        )

    with pytest.raises(ValidationError):
        ParameterOccurrence(
            key="mixing",
            raw_key="MIXING",
            raw_value=str(value),
            value=(1.0, value),
            ordinal=0,
        )


@pytest.mark.parametrize(
    ("model", "kwargs"),
    [
        (EnergyTerm, {"key": " ", "raw_label": "Ewald", "value": 1.0, "kind": "contribution"}),
        (EnergyTerm, {"key": "ewald", "raw_label": "\t", "value": 1.0, "kind": "contribution"}),
        (
            ParameterOccurrence,
            {"key": "", "raw_key": "ENCUT", "raw_value": "520", "value": 520, "ordinal": 0},
        ),
        (
            ParameterOccurrence,
            {"key": "encut", "raw_key": " ", "raw_value": "520", "value": 520, "ordinal": 0},
        ),
        (
            ParameterOccurrence,
            {"key": "encut", "raw_key": "ENCUT", "raw_value": "", "value": 520, "ordinal": 0},
        ),
        (
            ParameterOccurrence,
            {"key": "encut", "raw_key": "ENCUT", "raw_value": "520", "value": 520, "ordinal": -1},
        ),
    ],
)
def test_new_detail_models_reject_invalid_contract_values(model, kwargs) -> None:
    with pytest.raises(ValidationError):
        model(**kwargs)


@pytest.mark.parametrize(
    "value",
    [
        [1, "2"],
        (True,),
        Decimal("0.1"),
        b"abc",
        (2**53 + 1,),
    ],
)
def test_parameter_occurrence_rejects_lossy_typed_value_coercion(value) -> None:
    with pytest.raises(ValidationError):
        ParameterOccurrence(
            key="custom",
            raw_key="CUSTOM",
            raw_value=str(value),
            value=value,
            ordinal=0,
        )


@pytest.mark.parametrize(
    ("value", "expected_type"),
    [
        (True, bool),
        (7, int),
        (7.5, float),
        ("unknown", str),
        ((1.0, 2.0), tuple),
    ],
)
def test_parameter_occurrence_preserves_strict_supported_value_types(
    value, expected_type
) -> None:
    parameter = ParameterOccurrence(
        key="custom",
        raw_key="CUSTOM",
        raw_value=str(value),
        value=value,
        ordinal=0,
    )

    assert type(parameter.value) is expected_type
    assert parameter.value == value


@pytest.mark.parametrize(
    "kwargs",
    [
        {"cell_volume": 0.0},
        {"cell_volume": -1.0},
        {"stress_tensor_kb": ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0))},
        {"stress_tensor_kb": ((1.0, 0.0, 0.0), (0.0, float("nan"), 0.0), (0.0, 0.0, 1.0))},
    ],
)
def test_ionic_step_rejects_invalid_cell_details(kwargs) -> None:
    values = dict(
        index=0,
        lattice=IDENTITY,
        fractional_positions=(),
        cartesian_positions=(),
        raw_forces=(),
        free_forces=None,
        free_force_norms=None,
        total_energy=None,
        delta_energy=None,
        scf_iterations=None,
        electronic_converged=None,
        ionic_converged=None,
        strongest_free_component=None,
        rms_free_force=None,
    )
    values.update(kwargs)
    with pytest.raises(ValidationError):
        IonicStep(**values)
