"""Typer entry point for standalone VASP analysis."""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path

import typer
from click import Context
from typer.core import TyperGroup

from vasp_analyzer.calculation.dataset import detect_path_dialect
from vasp_analyzer.calculation.discovery import discover_calculation
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import AnalyzerError, FrozenModel
from vasp_analyzer.parsing.profiles import CompatibilityProfile, load_profile
from vasp_analyzer.transport.handoff import (
    EndpointSender,
    canonical_calculation_path,
    default_endpoint_sender,
    try_extension_handoff,
)
from vasp_analyzer.transport.stdio import serve_stdio

from .corpus import validate_corpus
from .normalizer import list_normalizers, test_normalizer, validate_normalizer


class WebLaunchRequest(FrozenModel):
    path: Path
    profile: CompatibilityProfile | None = None
    port: int | None = None
    open_browser: bool = True


class DialectValidationResult(FrozenModel):
    schema_version: int = 1
    dialect: str
    profile_id: str | None = None
    normalization_rules: tuple[str, ...] = ()


WebLauncher = Callable[[WebLaunchRequest], None]


class _OptionalPathGroup(TyperGroup):
    """Resolve the otherwise ambiguous optional path before nested commands."""

    _ROOT_VALUE_OPTIONS = frozenset({"--profile", "--port"})
    _ROOT_FLAG_OPTIONS = frozenset({"--web", "--no-open"})

    def parse_args(self, ctx: Context, args: list[str]) -> list[str]:
        if args and args[0] in self.commands:
            args = [".", *args]
        elif args and not any(argument in self.commands for argument in args):
            options: list[str] = []
            positional: list[str] = []
            index = 0
            while index < len(args):
                argument = args[index]
                if argument in self._ROOT_VALUE_OPTIONS and index + 1 < len(args):
                    options.extend((argument, args[index + 1]))
                    index += 2
                elif argument in self._ROOT_FLAG_OPTIONS:
                    options.append(argument)
                    index += 1
                else:
                    positional.append(argument)
                    index += 1
            args = [*options, *positional]
        return super().parse_args(ctx, args)


def _lazy_web_launcher(_request: WebLaunchRequest) -> None:
    try:
        from vasp_analyzer.transport.web import launch_web
    except ImportError as exc:
        raise AnalyzerError("browser fallback is not available in this build") from exc
    launch_web(_request)


def validate_path_dialect(
    path: Path, profile: CompatibilityProfile | None = None
) -> DialectValidationResult:
    discovered = discover_calculation(path)
    dialect = detect_path_dialect(discovered, profile)
    selected_profile = profile or dialect.profile
    rules = (
        (
            f"drop {selected_profile.poscar.drop_exact_line!r} after "
            f"{selected_profile.poscar.drop_exact_line_after!r}"
        )
        if selected_profile is not None
        and selected_profile.poscar.drop_exact_line is not None
        else None
    )
    return DialectValidationResult(
        dialect=dialect.id,
        profile_id=selected_profile.id if selected_profile is not None else None,
        normalization_rules=(rules,) if rules is not None else (),
    )


def _emit_error(exc: Exception) -> None:
    typer.echo(str(exc), err=True)
    raise typer.Exit(code=2)


def create_app(
    *,
    web_launcher: WebLauncher | None = None,
    endpoint_sender: EndpointSender = default_endpoint_sender,
    environ: Mapping[str, str] | None = None,
) -> typer.Typer:
    launcher = web_launcher or _lazy_web_launcher
    application = typer.Typer(
        cls=_OptionalPathGroup,
        no_args_is_help=False,
        invoke_without_command=True,
    )
    corpus_app = typer.Typer()
    dialect_app = typer.Typer()
    normalizer_app = typer.Typer()
    application.add_typer(corpus_app, name="corpus")
    application.add_typer(dialect_app, name="dialect")
    application.add_typer(normalizer_app, name="normalizer")

    @application.callback()
    def root(
        ctx: typer.Context,
        path: Path | None = typer.Argument(None),
        profile: Path | None = typer.Option(None, "--profile"),
        web: bool = typer.Option(False, "--web"),
        port: int | None = typer.Option(None, "--port", min=0, max=65535),
        no_open: bool = typer.Option(False, "--no-open"),
    ) -> None:
        if ctx.invoked_subcommand is not None:
            return
        try:
            calculation_path = canonical_calculation_path(path or Path.cwd())
            selected_profile = load_profile(profile) if profile is not None else None
            browser_requested = web or port is not None or no_open
            if not browser_requested:
                environment = os.environ if environ is None else environ
                if try_extension_handoff(
                    calculation_path,
                    profile_path=profile,
                    environ=environment,
                    sender=endpoint_sender,
                ):
                    return
                raise AnalyzerError(
                    "VS Code extension handoff unavailable; install or reload the Remote SSH "
                    "workspace extension, then open a new integrated terminal. Use --web only "
                    "for explicit browser mode."
                )
            launcher(
                WebLaunchRequest(
                    path=calculation_path,
                    profile=selected_profile,
                    port=port,
                    open_browser=not no_open,
                )
            )
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    @application.command("serve")
    def serve(
        path: Path,
        stdio: bool = typer.Option(False, "--stdio"),
        profile: Path | None = typer.Option(None, "--profile"),
    ) -> None:
        if not stdio:
            _emit_error(AnalyzerError("serve currently requires --stdio"))
        try:
            selected_profile = load_profile(profile) if profile is not None else None
            session = CalculationSession(path, profile=selected_profile)
            serve_stdio(session, sys.stdin, sys.stdout)
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    @corpus_app.command("validate")
    def corpus_validate(path: Path) -> None:
        try:
            typer.echo(validate_corpus(path).model_dump_json(by_alias=True, indent=2))
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    @dialect_app.command("validate")
    def dialect_validate(
        path: Path,
        profile: Path | None = typer.Option(None, "--profile"),
    ) -> None:
        try:
            selected_profile = load_profile(profile) if profile is not None else None
            result = validate_path_dialect(path, selected_profile)
            typer.echo(result.model_dump_json(by_alias=True, indent=2))
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    @normalizer_app.command("list")
    def normalizer_list() -> None:
        try:
            environment = os.environ if environ is None else environ
            typer.echo(list_normalizers(environment, Path.home()))
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    @normalizer_app.command("validate")
    def normalizer_validate(path: Path) -> None:
        try:
            environment = os.environ if environ is None else environ
            typer.echo(validate_normalizer(path, environment, Path.home()))
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    @normalizer_app.command("test")
    def normalizer_test(path: Path, outcar: Path) -> None:
        try:
            typer.echo(test_normalizer(path, outcar))
        except (AnalyzerError, OSError, ValueError) as exc:
            _emit_error(exc)

    return application


app = create_app(environ=os.environ)


__all__ = [
    "DialectValidationResult",
    "WebLaunchRequest",
    "WebLauncher",
    "app",
    "create_app",
    "validate_path_dialect",
]
