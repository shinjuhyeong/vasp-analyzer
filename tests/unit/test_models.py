from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

import vasp_analyzer.core as core_module

from vasp_analyzer.core.models import (
    CalculationDataset,
    EnergyTerm,
    ForceComponent,
    IonicStep,
    InitialStructure,
    ParameterOccurrence,
    SelectiveMask,
    Site,
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
        initial_structure=None,
        ionic_steps=(),
        capabilities=(),
    )
    with pytest.raises(ValidationError):
        dataset.source_files = ()


def test_dataset_v4_preserves_energy_stress_and_parameter_occurrences() -> None:
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
        initial_structure=None,
        ionic_steps=(step,),
        parameters=(parameter,),
        capabilities=(),
    )

    assert dataset.schema_version == 4
    assert dataset.ionic_steps[0].energy_terms[0].raw_label == "Ewald energy"
    assert dataset.parameters[0].value == 520.0
    assert dataset.model_dump(mode="json")["schemaVersion"] == 4
    assert dataset.model_dump(mode="json")["initialStructure"] is None


def test_initial_structure_serializes_camel_case_coordinates() -> None:
    structure = InitialStructure(
        lattice=IDENTITY,
        fractional_positions=((0.0, 0.0, 0.0),),
        cartesian_positions=((0.0, 0.0, 0.0),),
    )

    assert structure.model_dump(mode="json") == {
        "source": "POSCAR",
        "lattice": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        "fractionalPositions": [[0.0, 0.0, 0.0]],
        "cartesianPositions": [[0.0, 0.0, 0.0]],
    }


def test_initial_structure_rejects_coordinate_length_mismatch() -> None:
    with pytest.raises(ValidationError, match="coordinate counts"):
        InitialStructure(
            lattice=IDENTITY,
            fractional_positions=((0.0, 0.0, 0.0),),
            cartesian_positions=(),
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("lattice", ((float("nan"), 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))),
        ("fractional_positions", ((float("inf"), 0.0, 0.0),)),
        ("cartesian_positions", ((0.0, float("-inf"), 0.0),)),
    ],
)
def test_initial_structure_rejects_non_finite_geometry(field: str, value: object) -> None:
    values = {
        "lattice": IDENTITY,
        "fractional_positions": ((0.0, 0.0, 0.0),),
        "cartesian_positions": ((0.0, 0.0, 0.0),),
    }
    values[field] = value

    with pytest.raises(ValidationError, match="finite"):
        InitialStructure(**values)


def test_initial_structure_rejects_finite_singular_lattice() -> None:
    with pytest.raises(ValidationError, match="non-singular"):
        InitialStructure(
            lattice=((1.0, 0.0, 0.0), (2.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
            fractional_positions=(),
            cartesian_positions=(),
        )


def test_calculation_dataset_requires_explicit_nullable_initial_structure() -> None:
    payload = {
        "schemaVersion": 4,
        "root": "/calculation",
        "sourceFiles": [],
        "sites": [],
        "ionicSteps": [],
        "parameters": [],
        "capabilities": [],
        "warnings": [],
        "provenance": None,
    }

    with pytest.raises(ValidationError, match="initialStructure"):
        CalculationDataset.model_validate(payload)
    assert CalculationDataset.model_validate({**payload, "initialStructure": None}).initial_structure is None


def test_calculation_dataset_rejects_initial_coordinate_count_mismatch_with_sites() -> None:
    initial = InitialStructure(
        lattice=IDENTITY,
        fractional_positions=(),
        cartesian_positions=(),
    )
    site = Site(
        site_index=0,
        element="H",
        initial_fractional_position=(0.0, 0.0, 0.0),
        initial_cartesian_position=(0.0, 0.0, 0.0),
        selective_dynamics=SelectiveMask(a=True, b=True, c=True),
    )

    with pytest.raises(ValidationError, match="initial structure coordinate counts.*sites"):
        CalculationDataset(
            root="/calculation",
            source_files=(),
            sites=(site,),
            initial_structure=initial,
            ionic_steps=(),
            capabilities=(),
        )


def test_initial_structure_is_exported_as_a_public_core_contract() -> None:
    assert getattr(core_module, "InitialStructure", None) is InitialStructure


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
        (Decimal("0.1"),),
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


@pytest.mark.parametrize("value", [(1.0, 2.0), ()])
def test_parameter_occurrence_float_tuple_round_trips_through_json(value) -> None:
    parameter = ParameterOccurrence(
        key="custom",
        raw_key="CUSTOM",
        raw_value=str(value),
        value=value,
        ordinal=0,
    )

    restored = ParameterOccurrence.model_validate_json(parameter.model_dump_json())

    assert restored == parameter
    assert restored.value == value
    assert type(restored.value) is tuple


def test_parameter_occurrence_losslessly_normalizes_float_list() -> None:
    parameter = ParameterOccurrence(
        key="custom",
        raw_key="CUSTOM",
        raw_value="1.0 2.0",
        value=[1.0, 2.0],
        ordinal=0,
    )

    assert parameter.value == (1.0, 2.0)
    assert type(parameter.value) is tuple


@pytest.mark.parametrize("encoded_value", ["[1,2.0]", "[true]", '["1.0"]'])
def test_parameter_occurrence_json_rejects_non_float_array_members(
    encoded_value: str,
) -> None:
    payload = (
        '{"key":"custom","rawKey":"CUSTOM","rawValue":"raw",'
        f'"value":{encoded_value},"ordinal":0}}'
    )

    with pytest.raises(ValidationError):
        ParameterOccurrence.model_validate_json(payload)


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
