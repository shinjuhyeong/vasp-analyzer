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


RequestParams: TypeAlias = DatasetParams | StepParams | VolumetricParams
RequestId: TypeAlias = Annotated[int, Field(strict=True, ge=0)]
_REQUEST_ID_ADAPTER = TypeAdapter(RequestId)


class Request(FrozenModel):
    id: RequestId
    method: Literal["getDataset", "getStep", "getVolumetric"]
    params: RequestParams = Field(default_factory=DatasetParams)

    @model_validator(mode="after")
    def require_method_params_pair(self) -> "Request":
        expected = {
            "getDataset": DatasetParams,
            "getStep": StepParams,
            "getVolumetric": VolumetricParams,
        }[self.method]
        if not isinstance(self.params, expected):
            raise ValueError(f"params do not match method {self.method}")
        return self


class ProtocolError(FrozenModel):
    code: str
    message: str


class SuccessResponse(FrozenModel):
    id: int
    result: CalculationDataset | IonicStep


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
