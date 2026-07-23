"""Immutable, versioned request and response contracts."""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import Field, TypeAdapter, ValidationError, model_validator

from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import AnalyzerError, CalculationDataset, FrozenModel, IonicStep


class DatasetParams(FrozenModel):
    """Parameters for a complete calculation snapshot."""


class StepParams(FrozenModel):
    step_index: Annotated[int, Field(strict=True, ge=0)]


class VolumetricParams(FrozenModel):
    source: str = Field(min_length=1, max_length=255)
    mode: Literal["isosurface", "slice"]


class NormalizationParams(FrozenModel):
    manifest_reference: str = Field(pattern=r"^[0-9a-f]{64}$")


RequestParams: TypeAlias = DatasetParams | StepParams | VolumetricParams | NormalizationParams
RequestId: TypeAlias = Annotated[int, Field(strict=True, ge=0)]
_REQUEST_ID_ADAPTER = TypeAdapter(RequestId)


class Request(FrozenModel):
    id: RequestId
    method: Literal[
        "getDataset",
        "getStep",
        "getVolumetric",
        "getNormalizationManifest",
        "getNormalizedOutcar",
    ]
    params: RequestParams = Field(default_factory=DatasetParams)

    @model_validator(mode="after")
    def require_method_params_pair(self) -> "Request":
        expected = {
            "getDataset": DatasetParams,
            "getStep": StepParams,
            "getVolumetric": VolumetricParams,
            "getNormalizationManifest": NormalizationParams,
            "getNormalizedOutcar": NormalizationParams,
        }[self.method]
        if not isinstance(self.params, expected):
            raise ValueError(f"params do not match method {self.method}")
        return self


class ProtocolError(FrozenModel):
    code: str
    message: str


class NormalizationChangeResult(FrozenModel):
    source_line: int
    rule_id: str
    original_excerpt: str
    emitted_excerpt: str


class NormalizationManifestResult(FrozenModel):
    manifest_reference: str
    normalizer_id: str
    display_name: str
    schema_version: int
    definition_sha256: str
    source_sha256: str
    source_size: int
    source_mtime_ns: int
    changed_line_count: int
    first_changed_line: int | None
    last_changed_line: int | None
    rule_changed_line_counts: dict[str, int]
    warnings: tuple[str, ...]
    changes: tuple[NormalizationChangeResult, ...]


class NormalizedOutcarResult(FrozenModel):
    manifest_reference: str
    content: str


class SuccessResponse(FrozenModel):
    id: int
    result: (
        CalculationDataset
        | IonicStep
        | NormalizationManifestResult
        | NormalizedOutcarResult
    )


class ErrorResponse(FrozenModel):
    id: int | None
    error: ProtocolError


Response: TypeAlias = SuccessResponse | ErrorResponse


def error_response(request_id: int | None, code: str, message: str) -> ErrorResponse:
    return ErrorResponse(id=request_id, error=ProtocolError(code=code, message=message))


def recover_request_id(value: object) -> int | None:
    """Apply the public Request ID contract to an otherwise invalid request."""

    try:
        return _REQUEST_ID_ADAPTER.validate_python(value)
    except ValidationError:
        return None


def dispatch(session: CalculationSession, request: Request) -> Response:
    """Dispatch one validated request without exposing parser implementation objects."""

    if request.method == "getVolumetric":
        assert isinstance(request.params, VolumetricParams)
        return error_response(
            request.id,
            "capability_unavailable",
            "Volumetric data is not available in this release",
        )

    if request.method in ("getNormalizationManifest", "getNormalizedOutcar"):
        assert isinstance(request.params, NormalizationParams)
        try:
            artifact = session.normalization_artifact(
                request.params.manifest_reference,
                include_content=request.method == "getNormalizedOutcar",
            )
        except AnalyzerError as exc:
            return error_response(request.id, exc.code, str(exc))
        if request.method == "getNormalizedOutcar":
            assert artifact.content is not None
            return SuccessResponse(
                id=request.id,
                result=NormalizedOutcarResult(
                    manifest_reference=artifact.manifest_reference,
                    content=artifact.content,
                ),
            )
        manifest = artifact.manifest
        return SuccessResponse(
            id=request.id,
            result=NormalizationManifestResult(
                manifest_reference=artifact.manifest_reference,
                normalizer_id=manifest.normalizer_id,
                display_name=manifest.display_name,
                schema_version=manifest.schema_version,
                definition_sha256=manifest.definition_sha256,
                source_sha256=manifest.source_sha256,
                source_size=manifest.source_size,
                source_mtime_ns=manifest.source_mtime_ns,
                changed_line_count=manifest.changed_line_count,
                first_changed_line=manifest.first_changed_line,
                last_changed_line=manifest.last_changed_line,
                rule_changed_line_counts=manifest.rule_changed_line_counts,
                warnings=manifest.warnings,
                changes=tuple(
                    NormalizationChangeResult(
                        source_line=change.source_line,
                        rule_id=change.rule_id,
                        original_excerpt=change.original_excerpt,
                        emitted_excerpt=change.emitted_excerpt,
                    )
                    for change in manifest.changes
                ),
            ),
        )

    try:
        dataset = session.refresh_if_changed()
    except AnalyzerError as exc:
        return error_response(request.id, exc.code, str(exc))

    if request.method == "getDataset":
        assert isinstance(request.params, DatasetParams)
        return SuccessResponse(id=request.id, result=dataset)

    assert isinstance(request.params, StepParams)
    step = next(
        (item for item in dataset.ionic_steps if item.index == request.params.step_index),
        None,
    )
    if step is None:
        return error_response(
            request.id,
            "step_not_found",
            f"Ionic step {request.params.step_index} is not available",
        )
    return SuccessResponse(id=request.id, result=step)


__all__ = [
    "DatasetParams",
    "ErrorResponse",
    "NormalizationManifestResult",
    "NormalizationParams",
    "NormalizedOutcarResult",
    "ProtocolError",
    "Request",
    "Response",
    "RequestId",
    "StepParams",
    "SuccessResponse",
    "VolumetricParams",
    "dispatch",
    "error_response",
    "recover_request_id",
]
