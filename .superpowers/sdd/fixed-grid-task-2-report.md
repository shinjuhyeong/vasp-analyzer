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
