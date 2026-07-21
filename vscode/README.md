# VASP Analyzer for VS Code

This workspace extension opens VASP calculations in a port-free Webview. It is designed for local and Remote SSH extension hosts and communicates with the Python `analyzer serve --stdio` process using typed newline-delimited JSON.

For a Remote SSH window:

1. Install the wheel in the remote Python environment with `python3 -m pip install --user --force-reinstall ./vasp_analyzer-0.1.0-py3-none-any.whl`.
2. Install the packaged VSIX on that same remote extension host with `code --install-extension ./vasp-analyzer-0.1.0.vsix --force`.
3. Reload the Remote SSH window and open a **new integrated terminal**.
4. Run `command -v analyzer`; it must print the remote executable path.
5. Run `analyzer OUTCAR`, use `VASP Analyzer: Open Calculation`, or right-click an extensionless file named `OUTCAR` in Explorer.

The default `analyzer OUTCAR` flow opens only the VS Code editor Webview. Browser mode is explicit: use `analyzer OUTCAR --web`. A parser profile can be handed to the editor flow with `analyzer OUTCAR --profile ~/profiles/home.toml`.

The extension defaults to the console executable `analyzer serve --stdio <path>`, which directly supports a `pipx` install. Set `vaspAnalyzer.executablePath` for another executable location. Set `vaspAnalyzer.pythonPath` only as an explicit module-launch override; it takes precedence and runs `<python> -m vasp_analyzer.cli serve --stdio <path>`. Both forms pass paths as non-shell arguments. The Webview bundle contains React and 3Dmol locally; strict CSP prevents network access. If WebGL initialization fails, the synchronized accessible data table remains available.

The extension validates public dataset/wire schema 2 before rendering. The structure toolbar and convergence workspace control the same ionic step through synchronized slider and number inputs. Convergence initially shows Energy only; Energy, Force, and Cell & Stress may be selected together, share the lower area equally, and independently use Graph or detailed selected-step Table mode. Atom rows select the corresponding crystal site. Cell/stress values retain VASP's kB sign convention and label `1 kB = 0.1 GPa`.

The Parameters tab reports effective values echoed by OUTCAR in categorized and ordered raw views. Repeated and unknown home-version keys are preserved, and the UI does not infer whether a value was explicitly supplied in INCAR or selected as a VASP default.

Browser fallback, parser profiles, recovery rules, privacy, and future DOS/band/charge/isosurface scope are documented in the repository `README.md`. This extension is UNLICENSED.
