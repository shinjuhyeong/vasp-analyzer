# KBLOCK Inline Annotation Parsing Design

## Problem

VASP can emit an effective-parameter line such as:

```text
NBLOCK = 1; KBLOCK = 3000    inner block; outer block
```

`KBLOCK` is an integer, while `inner block; outer block` is explanatory output. The current parser rejects the line because it forbids every semicolon inside a sliced assignment value.

## Design

Keep assignment discovery based on the existing bounded `KEY =` grammar. For known integer tags `NBLOCK` and `KBLOCK`, accept a finite integer token followed by whitespace-delimited explanatory text. Expose the integer as `ParameterOccurrence.value` while retaining the complete source text in `ParameterOccurrence.raw_value`.

Unknown tags remain conservative: mixed numeric/text values stay strings. Empty values, repeated separators, additional equals signs, and malformed assignments remain errors. No public model or transport schema changes are required.

## Verification

Add a regression test using the exact reported OUTCAR line. Retain malformed-input coverage, run the parameter-parser unit tests, then run the complete Python suite and Ruff.
