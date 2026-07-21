import pytest
from pydantic import ValidationError

from vasp_analyzer.core import ParameterOccurrence, VolumetricAlignmentError
from vasp_analyzer.core.models import VolumetricDescriptor, VolumetricRequest

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def test_volumetric_contract_rejects_mismatched_lattice() -> None:
    field = VolumetricDescriptor(source="CHGCAR", lattice=IDENTITY, dimensions=(8, 8, 8), kind="charge", units="e/angstrom^3", value_range=(-0.2, 0.5))
    with pytest.raises(VolumetricAlignmentError):
        field.require_compatible_structure(((2.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))


def test_volumetric_request_identity_includes_render_parameters() -> None:
    base = VolumetricRequest(fingerprint="abc", isovalue=0.2, downsample=2, repeat=(1, 1, 1))
    assert len({
        base.identity,
        base.model_copy(update={"isovalue": 0.3}).identity,
        base.model_copy(update={"downsample": 3}).identity,
        base.model_copy(update={"repeat": (2, 1, 1)}).identity,
    }) == 4


@pytest.mark.parametrize("kwargs", [{"dimensions": (0, 8, 8)}, {"value_range": (1.0, -1.0)}, {"source": " "}, {"kind": ""}, {"units": "\t"}])
def test_volumetric_descriptor_rejects_invalid_contract_values(kwargs) -> None:
    values = dict(source="CHGCAR", lattice=IDENTITY, dimensions=(8, 8, 8), kind="charge", units="e/A^3", value_range=(-1.0, 1.0))
    values.update(kwargs)
    with pytest.raises(ValidationError):
        VolumetricDescriptor(**values)


@pytest.mark.parametrize("kwargs", [{"downsample": 0}, {"repeat": (1, 0, 1)}, {"isovalue": float("nan")}, {"fingerprint": " "}])
def test_volumetric_request_rejects_invalid_contract_values(kwargs) -> None:
    values = dict(fingerprint="abc", isovalue=0.2, downsample=2, repeat=(1, 1, 1))
    values.update(kwargs)
    with pytest.raises(ValidationError):
        VolumetricRequest(**values)


def test_parameter_occurrence_is_a_public_immutable_contract() -> None:
    parameter = ParameterOccurrence(
        key="encut",
        raw_key="ENCUT",
        raw_value="520",
        value=520,
        ordinal=0,
    )

    with pytest.raises(ValidationError):
        parameter.value = 400
