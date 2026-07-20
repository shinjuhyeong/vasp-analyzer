from math import sqrt

import numpy as np
import pytest

from vasp_analyzer.convergence.forces import force_metrics
from vasp_analyzer.core import ForceComponent, SelectiveMask
from vasp_analyzer.structure.constraints import apply_constraints


def test_fixed_largest_component_is_excluded() -> None:
    masks = (SelectiveMask(a=True, b=False, c=True),)
    metrics = force_metrics(((0.4, 9.0, -0.6),), masks, ((1, 0, 0), (0, 1, 0), (0, 0, 1)))
    assert metrics.strongest == ForceComponent(site_index=0, axis="c", value=-0.6)
    assert metrics.free_forces == ((0.4, 0.0, -0.6),)
    assert metrics.rms == sqrt((0.4**2 + 0.6**2) / 2)


def test_unknown_mask_makes_constraint_results_unknown() -> None:
    masks = (SelectiveMask(a=True, b=None, c=True),)
    assert apply_constraints(((1.0, 2.0, 3.0),), masks, ((1, 0, 0), (0, 1, 0), (0, 0, 1))) is None
    metrics = force_metrics(((1.0, 2.0, 3.0),), masks, ((1, 0, 0), (0, 1, 0), (0, 0, 1)))
    assert metrics.free_forces is None
    assert metrics.free_force_norms is None
    assert metrics.strongest is None
    assert metrics.rms is None


def test_rms_none_when_all_components_are_fixed() -> None:
    masks = (SelectiveMask(a=False, b=False, c=False),)
    metrics = force_metrics(((1.0, 2.0, 3.0),), masks, ((1, 0, 0), (0, 1, 0), (0, 0, 1)))
    assert metrics.free_forces == ((0.0, 0.0, 0.0),)
    assert metrics.rms is None


def test_skew_constraints_use_orthogonal_projection_onto_direct_vector_span() -> None:
    lattice = ((1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 0.0, 2.0))
    metrics = force_metrics(((0.0, 1.0, 3.0),), (SelectiveMask(a=False, b=True, c=False),), lattice)
    assert metrics.free_forces is not None
    assert np.allclose(metrics.free_forces[0], (0.5, 0.5, 0.0))
    assert metrics.strongest is not None
    assert (metrics.strongest.site_index, metrics.strongest.axis) == (0, "b")
    assert metrics.strongest.value == pytest.approx(2**-0.5)
    projected = np.asarray(metrics.free_forces[0])
    allowed = np.asarray(lattice[1])
    assert np.allclose(np.cross(projected, allowed), 0.0)
    assert np.isclose(np.dot(np.asarray((0.0, 1.0, 3.0)) - projected, allowed), 0.0)


def test_all_true_projection_is_identity_and_all_false_is_zero() -> None:
    lattice = ((2.0, 0.0, 0.0), (0.5, 1.5, 0.0), (0.2, 0.3, 2.0))
    force = ((1.0, -2.0, 3.0),)
    all_true = force_metrics(force, (SelectiveMask(a=True, b=True, c=True),), lattice)
    all_false = force_metrics(force, (SelectiveMask(a=False, b=False, c=False),), lattice)
    assert all_true.free_forces is not None and np.allclose(all_true.free_forces, force)
    assert all_false.free_forces == ((0.0, 0.0, 0.0),)


def test_two_direction_skew_projection_is_idempotent_and_residual_is_orthogonal() -> None:
    lattice = ((1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.2, 0.3, 1.0))
    mask = (SelectiveMask(a=True, b=False, c=True),)
    first = apply_constraints(((0.0, 2.0, 3.0),), mask, lattice)
    assert first is not None
    second = apply_constraints(first, mask, lattice)
    assert second is not None and np.allclose(second, first)
    residual = np.asarray((0.0, 2.0, 3.0)) - np.asarray(first[0])
    assert np.isclose(np.dot(residual, lattice[0]), 0.0)
    assert np.isclose(np.dot(residual, lattice[2]), 0.0)


def test_strongest_tie_uses_first_site_then_a_b_c_order() -> None:
    metrics = force_metrics(
        ((1.0, -1.0, 0.0), (1.0, 0.0, 0.0)),
        (SelectiveMask(a=True, b=True, c=False), SelectiveMask(a=True, b=False, c=False)),
        ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    )
    assert metrics.strongest == ForceComponent(site_index=0, axis="a", value=1.0)


@pytest.mark.parametrize(
    ("forces", "lattice"),
    [
        (((float("nan"), 0.0, 0.0),), ((1, 0, 0), (0, 1, 0), (0, 0, 1))),
        (((1.0, 0.0, 0.0),), ((float("inf"), 0, 0), (0, 1, 0), (0, 0, 1))),
        (((1.0, 0.0, 0.0),), ((1, 0, 0), (2, 0, 0), (0, 0, 1))),
    ],
)
def test_projection_rejects_nonfinite_or_singular_inputs(forces, lattice) -> None:
    with pytest.raises(ValueError, match="finite|nonsingular"):
        force_metrics(forces, (SelectiveMask(a=True, b=True, c=True),), lattice)
