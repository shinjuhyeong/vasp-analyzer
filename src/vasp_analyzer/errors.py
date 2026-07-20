class AnalyzerError(RuntimeError):
    code = "analyzer_error"


class PoscarFormatError(AnalyzerError):
    code = "poscar_format"


class OutcarFormatError(AnalyzerError):
    code = "outcar_format"


class IncompleteIonicStep(OutcarFormatError):
    code = "incomplete_ionic_step"


class StructureMismatchError(AnalyzerError):
    code = "structure_mismatch"


class VolumetricAlignmentError(AnalyzerError):
    code = "volumetric_alignment"


class UnknownMethodError(AnalyzerError):
    code = "unknown_method"

    def __init__(self, method: str) -> None:
        super().__init__(f"Unknown method: {method}")
