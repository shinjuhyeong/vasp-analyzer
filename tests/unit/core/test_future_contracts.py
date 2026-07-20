import pytest

from vasp_analyzer.core import VolumetricAlignmentError
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
