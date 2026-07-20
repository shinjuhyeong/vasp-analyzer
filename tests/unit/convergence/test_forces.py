from vasp_analyzer.convergence.electronic import energy_deltas


def test_delta_energy_bridges_only_present_energy_values() -> None:
    assert energy_deltas((-10.0, None, -10.25, -10.5)) == (None, None, -0.25, -0.25)
