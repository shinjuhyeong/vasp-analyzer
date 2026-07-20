from math import sqrt

from vasp_analyzer.convergence.forces import force_metrics
from vasp_analyzer.core import ForceComponent, SelectiveMask
from vasp_analyzer.structure.constraints import apply_constraints


def test_fixed_largest_component_is_excluded() -> None:
    masks = (SelectiveMask(x=True, y=False, z=True),)
    metrics = force_metrics(((0.4, 9.0, -0.6),), masks)
    assert metrics.strongest == ForceComponent(site_index=0, axis="z", value=-0.6)
    assert metrics.free_forces == ((0.4, 0.0, -0.6),)
    assert metrics.rms == sqrt((0.4**2 + 0.6**2) / 2)


def test_unknown_mask_makes_constraint_results_unknown() -> None:
    masks = (SelectiveMask(x=True, y=None, z=True),)
    assert apply_constraints(((1.0, 2.0, 3.0),), masks) is None
    metrics = force_metrics(((1.0, 2.0, 3.0),), masks)
    assert metrics.free_forces is None
    assert metrics.free_force_norms is None
    assert metrics.strongest is None
    assert metrics.rms is None


def test_rms_none_when_all_components_are_fixed() -> None:
    masks = (SelectiveMask(x=False, y=False, z=False),)
    metrics = force_metrics(((1.0, 2.0, 3.0),), masks)
    assert metrics.free_forces == ((0.0, 0.0, 0.0),)
    assert metrics.rms is None
