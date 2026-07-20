# VASP Analyzer for VS Code

This workspace extension opens VASP calculations in a port-free Webview. It is designed for local and Remote SSH extension hosts and communicates with the Python `analyzer serve --stdio` process using typed newline-delimited JSON.

1. Install `vasp-analyzer` in the workspace/remote Python environment.
2. Install the packaged VSIX on that same workspace/remote extension host.
3. Reload the window and open a **new integrated terminal**.
4. Run `analyzer`, use `VASP Analyzer: Open Calculation`, or right-click an extensionless file named `OUTCAR` in Explorer.

Set `vaspAnalyzer.pythonPath` when the extension host should use a non-default interpreter. The Webview bundle contains React and 3Dmol locally; strict CSP prevents network access. If WebGL initialization fails, the synchronized accessible data table remains available.

Browser fallback, parser profiles, recovery rules, privacy, and future DOS/band/charge/isosurface scope are documented in the repository `README.md`. This extension is UNLICENSED.
