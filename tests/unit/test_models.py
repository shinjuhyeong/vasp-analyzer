from vasp_analyzer.models import ForceComponent, SelectiveMask


def test_selective_mask_preserves_unknown_state() -> None:
    mask = SelectiveMask(x=True, y=False, z=None)
    assert mask.as_tuple() == (True, False, None)


def test_force_component_retains_signed_value() -> None:
    component = ForceComponent(site_index=4, axis="z", value=-0.61)
    assert component.magnitude == 0.61
