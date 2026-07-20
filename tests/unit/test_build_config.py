from pathlib import Path
import tomllib


def test_sdist_declares_ignored_webview_as_build_artifact() -> None:
    project_root = Path(__file__).resolve().parents[2]
    configuration = tomllib.loads((project_root / "pyproject.toml").read_text(encoding="utf8"))

    sdist = configuration["tool"]["hatch"]["build"]["targets"]["sdist"]

    assert "/vscode/dist/webview" in sdist["artifacts"]
