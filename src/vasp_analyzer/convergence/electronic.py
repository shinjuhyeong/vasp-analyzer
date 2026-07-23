"""Electronic convergence helpers."""


def energy_deltas(energies: tuple[float | None, ...]) -> tuple[float | None, ...]:
    previous: float | None = None
    deltas: list[float | None] = []
    for energy in energies:
        deltas.append(None if energy is None or previous is None else energy - previous)
        if energy is not None:
            previous = energy
    return tuple(deltas)


__all__ = ["energy_deltas"]
