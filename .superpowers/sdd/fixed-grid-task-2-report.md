# Fixed-grid Task 2 report

## Scope

- Added a Chromium-only Playwright coordinate regression command at `pnpm --dir vscode test:layout`.
- The harness renders the production `CompactToolbar` and imports production `styles.css`; it does not duplicate toolbar JSX.
- Replaced intrinsic primary-row flex sizing with the required `200px minmax(0, 1fr) auto` grid.
- Preserved the fixed secondary dock.

## RED: existing flex layout

Chromium coordinate assertions failed before the production CSS change:

| Viewport | Initial slider x | After Select Initial | After Compare | Row height | Expand right |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280 | 842.875 | 812.46875 | 812.46875 | 38 | 1270 |
| 640 | 202.875 | 172.46875 | 172.46875 | 38 | 630 |

At both widths, selecting Initial shifted the ionic slider left by `30.40625px`. The comparison state retained that shifted coordinate, so both equality assertions against the initial coordinate failed for the expected behavior.

## GREEN: fixed 200px grid

After the production CSS grid change:

| Viewport | Initial slider x | After Select Initial | After Compare | Row height | Expand right |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280 | 339.046875 | 339.046875 | 339.046875 | 38 | 1270 |
| 640 | 339.046875 | 339.046875 | 339.046875 | 38 | 630 |

The slider coordinate and primary-row height remain exact across both state transitions. The Expand button remains within each viewport.

## Verification

- `pnpm --dir vscode test:layout`: 2 passed.
- `pnpm --dir vscode test`: 32 files passed, 334 tests passed.
- `pnpm --dir vscode typecheck`: exit 0.
- `pnpm --dir vscode build`: exit 0.

## Review follow-up: rendered geometry mutation check

The coordinate spec now reads Chromium `boundingBox()` geometry at both
viewports and asserts:

- `.toolbar-primary-grid > .title-group` renders at exactly `200px` wide.
- The primary toolbar row renders at exactly `38px` high before and after the
  Initial/Compare state transitions, proving that the primary row does not wrap.

### Mutation RED

Temporary, uncommitted production CSS mutations changed the title
`width`/`min-width` from `200px` to `201px` and the toolbar
`grid-template-rows` primary value from `38px` to `40px`.

Exact command:

```powershell
$env:PATH='C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;'+$env:PATH; pnpm --dir vscode test:layout
```

Result: exit `1`; 2 tests failed. At both `1280` and `640`, Chromium reported:

```text
Expected: 200
Received: 201
Expected: 38
Received: 40
```

The post-transition row-height assertion also reported `Expected: 38`,
`Received: 40` at both widths. The CSS mutations were then restored and are
absent from the committed diff.

### Restored GREEN

Exact command:

```powershell
$env:PATH='C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;'+$env:PATH; pnpm --dir vscode test:layout
```

Result: exit `0`; 2 tests passed.

```json
{"width":1280,"initialX":339.046875,"selectedInitialX":339.046875,"comparisonX":339.046875,"titleWidth":200,"primaryRowHeight":38,"expandRight":1270}
{"width":640,"initialX":339.046875,"selectedInitialX":339.046875,"comparisonX":339.046875,"titleWidth":200,"primaryRowHeight":38,"expandRight":630}
```
