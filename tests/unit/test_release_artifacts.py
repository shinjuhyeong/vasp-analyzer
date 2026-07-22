from pathlib import PurePosixPath

import pytest

from scripts.verify_release_artifacts import (
    ReleaseVerificationError,
    require_archive_assets,
    validate_runtime_url_policy,
)


@pytest.mark.parametrize(
    ("kind", "members"),
    [
        ("wheel", {"vasp_analyzer/web_assets/index.js"}),
        (
            "sdist",
            {
                "vasp-analyzer/vscode/dist/webview/index.js",
            },
        ),
        (
            "vsix",
            {
                "extension/dist/extension.cjs",
                "extension/dist/webview/index.js",
            },
        ),
    ],
)
def test_release_assets_reject_missing_required_css_or_entrypoints(
    kind: str, members: set[str]
) -> None:
    with pytest.raises(ReleaseVerificationError, match="missing"):
        require_archive_assets(kind, members)


def test_release_assets_accept_complete_kind_specific_surfaces() -> None:
    require_archive_assets(
        "wheel",
        {
            "vasp_analyzer/web_assets/index.js",
            "vasp_analyzer/web_assets/index.css",
        },
    )
    require_archive_assets(
        "sdist",
        {
            "vasp-analyzer/vscode/dist/webview/index.js",
            "vasp-analyzer/vscode/dist/webview/index.css",
        },
    )
    require_archive_assets(
        "vsix",
        {
            "extension/dist/extension.cjs",
            "extension/dist/webview/index.js",
            "extension/dist/webview/index.css",
        },
    )


def test_packaged_runtime_url_policy_rejects_application_external_endpoint() -> None:
    surfaces = {
        PurePosixPath("extension/dist/extension.cjs"): (
            'const api = "https://example.invalid/runtime"; '
            "const csp = \"connect-src 'none'\";"
        ),
    }

    with pytest.raises(ReleaseVerificationError, match="forbidden runtime URL"):
        validate_runtime_url_policy(surfaces)


def test_packaged_runtime_url_policy_allows_only_scoped_loopback_and_vendor_literals() -> None:
    surfaces = {
        PurePosixPath("vasp_analyzer/transport/web.py"): (
            'url = f"http://127.0.0.1:{port}"\n'
            'CSP = "connect-src \'self\'"'
        ),
        PurePosixPath("extension/dist/extension.cjs"): (
            "const csp = \"connect-src 'none'\";"
        ),
        PurePosixPath("extension/dist/webview/index.js"): (
            "// https://github.com/kosua20/Rendu\n"
            'const namespace = "http://www.w3.org/2000/svg";'
        ),
        PurePosixPath("extension/dist/webview/index.css"): "body{}",
    }

    validate_runtime_url_policy(surfaces)


def test_packaged_runtime_url_policy_does_not_allow_loopback_in_extension_code() -> None:
    surfaces = {
        PurePosixPath("extension/dist/extension.cjs"): (
            'const endpoint = "http://127.0.0.1:8000"; '
            "const csp = \"connect-src 'none'\";"
        ),
    }

    with pytest.raises(ReleaseVerificationError, match="forbidden runtime URL"):
        validate_runtime_url_policy(surfaces)
