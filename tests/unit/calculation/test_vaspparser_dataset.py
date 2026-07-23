from __future__ import annotations

from pathlib import Path
from io import BytesIO

import pytest

from vasp_analyzer.calculation import dataset as dataset_module
from vasp_analyzer.calculation import session as session_module
from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.cache import cache_key
from vasp_analyzer.calculation.dataset import load_dataset
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import OutcarFormatError
from vasp_analyzer.parsing.adapters.vaspparser_outcar import ParsedTrajectory
from vasp_analyzer.normalizers import NormalizerMatch
from vasp_analyzer.normalizers.models import NormalizerDefinition


def _write_poscar(root: Path) -> None:
    (root / "POSCAR").write_text(
        "fixture\n1\n3 0 0\n0 3 0\n0 0 3\nH\n2\nSelective dynamics\nDirect\n"
        "0 0 0 T F T\n0.5 0.5 0.5 F F F\n",
        encoding="utf-8",
    )


def _calculation(tmp_path: Path, marker: bytes = b"vasp.6") -> Path:
    tmp_path.mkdir()
    (tmp_path / "OUTCAR").write_bytes(
        marker + b"\n VRHFIN =H: s1\n ions per type = 2\n"
    )
    _write_poscar(tmp_path)
    return tmp_path


def _trajectory(
    sites,
    provenance,
    energy: float = -1.0,
    energy_components=None,
    pressures=None,
    stresses=None,
) -> ParsedTrajectory:
    return ParsedTrajectory(
        step_indices=(0,),
        sites=sites,
        provenance=provenance,
        energies=(energy,),
        energy_components=energy_components,
        positions=(((0.0, 0.0, 0.0), (1.5, 1.5, 1.5)),),
        fractional_positions=(((0.0, 0.0, 0.0), (0.5, 0.5, 0.5)),),
        forces=(((1.0, 2.0, 3.0), (4.0, 5.0, 6.0)),),
        cells=(((3.0, 0.0, 0.0), (0.0, 3.0, 0.0), (0.0, 0.0, 3.0)),),
        stresses=stresses,
        pressures=pressures,
        scf_energies=None,
        fermi_level=None,
        fermi_levels=None,
        vbm=None,
        cbm=None,
    )


def test_pipeline_reads_bounded_prefix_and_passes_only_normalized_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc", b"vasp.5.4.1-barrier")
    outcar = root / "OUTCAR"
    outcar.write_bytes(
        b"vasp.5.4.1-barrier\n VRHFIN =H: s1\n ions per type = 2\n"
        b" NIONS = 2 ions\n POSITION TOTAL-FORCE\n"
        b" --------------------------\n"
        b"H_ 1 0 0 0 1 2 3\nH_ 2 1.5 1.5 1.5 4 5 6\n"
        + (b"x" * 1023 + b"\n") * 2048
    )
    seen: dict[str, object] = {}

    def parse(path, sites, provenance):
        seen["path"] = path
        seen["provenance"] = provenance
        return _trajectory(sites, provenance)

    monkeypatch.setattr(dataset_module, "parse_vaspparser_outcar", parse)
    dataset = load_dataset(root)

    assert Path(seen["path"]) != outcar
    assert dataset.provenance is not None
    assert dataset.provenance.normalizer_id == "home-barrier"
    assert dataset.provenance.normalizer_definition_sha256
    assert dataset.sites[0].selective_dynamics.as_tuple() == (True, False, True)


def test_normalizer_detection_requests_at_most_one_mib(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(b"unused")
    requested: list[int] = []

    class Guarded(BytesIO):
        def read(self, size: int = -1) -> bytes:
            requested.append(size)
            assert 0 <= size <= 1024 * 1024
            return super().read(size)

    monkeypatch.setattr(Path, "open", lambda *_args, **_kwargs: Guarded(b"x" * 20))
    assert dataset_module._read_normalizer_prefix(path) == b"x" * 20
    assert requested == [1024 * 1024]


def test_parser_failure_has_no_scanner_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")

    def fail(*_args):
        raise OutcarFormatError("authoritative failure")

    monkeypatch.setattr(dataset_module, "parse_vaspparser_outcar", fail)
    with pytest.raises(OutcarFormatError, match="authoritative failure"):
        load_dataset(root)


def test_outcar_only_sites_use_first_parsed_frame_positions(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    (root / "POSCAR").unlink()
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda _path, sites, provenance: _trajectory(sites, provenance),
    )

    dataset = load_dataset(root)

    assert dataset.sites[1].initial_fractional_position == (0.5, 0.5, 0.5)
    assert dataset.sites[1].initial_cartesian_position == (1.5, 1.5, 1.5)
    assert dataset.sites[1].selective_dynamics.as_tuple() == (None, None, None)


def test_energy_components_use_final_electronic_iteration(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    components = tuple((float(index), float(index + 100)) for index in range(11))
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda _path, sites, provenance: _trajectory(
            sites, provenance, energy_components=(components,)
        ),
    )

    step = load_dataset(root).ionic_steps[0]

    assert len(step.energy_terms) == 11
    assert step.energy_terms[1].key == "ewald"
    assert step.energy_terms[1].value == 101.0
    assert step.energy_terms[5].key == "paw_double_counting_1"


def test_pressure_vector_maps_to_hydrostatic_kb_and_cell_volume(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda _path, sites, provenance: _trajectory(
            sites,
            provenance,
            pressures=((0.100, 0.200, 0.300),),
            stresses=(
                ((0.001, 0.009, 0.008), (0.009, 0.002, 0.007), (0.008, 0.007, 0.003)),
            ),
        ),
    )

    step = load_dataset(root).ionic_steps[0]

    assert step.external_pressure_kb == pytest.approx(
        0.002 * dataset_module._EV_PER_ANGSTROM3_TO_KB
    )
    assert step.cell_volume == pytest.approx(27.0)


def test_session_retains_success_skips_same_failed_fingerprint_and_recovers(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    calls = 0

    def parse(_path, sites, provenance):
        nonlocal calls
        calls += 1
        content = (root / "OUTCAR").read_bytes()
        if b"broken" in content:
            raise OutcarFormatError("incomplete")
        return _trajectory(sites, provenance, energy=float(-calls))

    monkeypatch.setattr(dataset_module, "parse_vaspparser_outcar", parse)
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    first = session.load()
    (root / "OUTCAR").write_bytes(
        b"vasp.6\n VRHFIN =H: s1\n ions per type = 2\nbroken\n"
    )

    retained = session.refresh_if_changed()
    retained_again = session.refresh_if_changed()

    assert retained.ionic_steps == first.ionic_steps
    assert retained_again == retained
    assert calls == 2
    assert retained.warnings[-1].category == "GrowingFileParseFailure"
    (root / "OUTCAR").write_bytes(
        b"vasp.6\n VRHFIN =H: s1\n ions per type = 2\nrecovered\n"
    )
    recovered = session.refresh_if_changed()
    assert recovered.ionic_steps != first.ionic_steps
    assert calls == 3


def test_session_without_success_propagates_parser_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda *_args: (_ for _ in ()).throw(OutcarFormatError("bad initial file")),
    )
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    with pytest.raises(OutcarFormatError, match="bad initial file"):
        session.load()


def _standard_like_match(identifier: str) -> NormalizerMatch:
    return NormalizerMatch.from_definition(
        NormalizerDefinition.model_validate(
            {
                "schemaVersion": 1,
                "id": identifier,
                "displayName": identifier,
                "priority": 0,
                "detect": {"all": [], "any": [], "none": []},
                "rules": [],
            }
        )
    )


def test_session_caches_under_definition_selected_by_successful_assembly(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    first = _standard_like_match("standard")
    assembled = _standard_like_match("assembled")
    matches = iter((first, assembled, assembled))
    monkeypatch.setattr(
        dataset_module, "_select_outcar_normalizer", lambda _path: next(matches)
    )
    monkeypatch.setattr(
        session_module, "_select_outcar_normalizer", lambda _path: next(matches)
    )
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda _path, sites, provenance: _trajectory(sites, provenance),
    )
    cache = CacheStore(tmp_path / "cache")
    session = CalculationSession(root, cache=cache)

    session.load()

    source = dataset_module.inspect_calculation(
        dataset_module.discover_calculation(root)
    )
    dialect = dataset_module.detect_path_dialect(
        dataset_module.discover_calculation(root)
    )
    expected = cache_key(source, dialect.id, dialect.profile, assembled.definition_hash)
    assert (cache.root / f"{expected}.json").is_file()


def test_source_change_during_identity_is_not_cached_under_old_fingerprint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    match = _standard_like_match("standard")
    calls = 0

    def mutate_once(path: Path):
        nonlocal calls
        calls += 1
        if calls == 1:
            path.write_bytes(path.read_bytes() + b"changed between identity and assembly\n")
        return match

    monkeypatch.setattr(dataset_module, "_select_outcar_normalizer", mutate_once)
    monkeypatch.setattr(session_module, "_select_outcar_normalizer", mutate_once)
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda _path, sites, provenance: _trajectory(sites, provenance),
    )
    cache = CacheStore(tmp_path / "cache")
    before = dataset_module.inspect_calculation(dataset_module.discover_calculation(root))

    dataset = CalculationSession(root, cache=cache).load()

    after = dataset_module.inspect_calculation(dataset_module.discover_calculation(root))
    assert after != before
    dialect = dataset_module.detect_path_dialect(dataset_module.discover_calculation(root))
    expected = cache_key(after, dialect.id, dialect.profile, match.definition_hash)
    stale = cache_key(before, dialect.id, dialect.profile, match.definition_hash)
    assert (cache.root / f"{expected}.json").is_file()
    assert not (cache.root / f"{stale}.json").exists()
    assert dataset.ionic_steps
