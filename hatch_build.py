"""Release-only inclusion of the prebuilt offline Webview."""

from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Keep editable Python installs independent of ignored JavaScript output."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if self.target_name != "wheel":
            return
        webview = Path(self.root) / "vscode" / "dist" / "webview"
        if webview.is_dir():
            build_data["force_include"][str(webview)] = "vasp_analyzer/web_assets"
        elif version != "editable":
            raise RuntimeError("build the VS Code Webview before creating release artifacts")
