import os
import stat
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from vasp_analyzer.calculation import cache as cache_module
from vasp_analyzer.calculation.cache import CacheStore, cache_key
from vasp_analyzer.core import SourceFile
from vasp_analyzer.parsing.profiles import CompatibilityProfile


def test_default_cache_uses_private_user_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    variable = "LOCALAPPDATA" if os.name == "nt" else "XDG_CACHE_HOME"
    monkeypatch.setenv(variable, str(tmp_path / "xdg"))
    store = CacheStore.default()
    assert store.root == tmp_path / "xdg" / "vasp-analyzer"
    store.ensure_private_root()
    if os.name == "posix":
        assert stat.S_IMODE(store.root.stat().st_mode) == 0o700


def test_cache_refuses_symlink_root(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    link = tmp_path / "link"
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(OSError):
        CacheStore(link).ensure_private_root()


def test_cache_atomic_writers_do_not_share_tmp_name(tmp_path: Path) -> None:
    store = CacheStore(tmp_path / "cache")
    # Invalid payloads still exercise unique temp creation and cleanup through put_raw.
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda value: store.put_raw("same", f'{{"writer":{value}}}'), range(20)))
    assert not list(store.root.glob("*.tmp"))


def test_cache_schema_4_uses_a_new_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    source = SourceFile(path="/calc", size=10, mtime_ns=20, fingerprint="abc")
    profile = CompatibilityProfile(schema_version=1, id="standard", display_name="Standard")
    assert cache_module._CACHE_SCHEMA_VERSION == 4
    monkeypatch.setattr(cache_module, "_CACHE_SCHEMA_VERSION", 3)
    legacy = cache_key(source, "standard", profile)
    monkeypatch.setattr(cache_module, "_CACHE_SCHEMA_VERSION", 4)
    current = cache_key(source, "standard", profile)

    assert current != legacy
