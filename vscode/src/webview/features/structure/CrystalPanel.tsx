import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { InitialStructure, IonicStep, Site } from "../../core/contracts.js";
import type {
  CrystalRendererFactory,
  DirectionSemantics,
  LayerName,
  SupercellRepeat,
  VectorGlyph,
  ConstraintGlyph,
  VolumetricLayer,
} from "../../renderers/CrystalRenderer.js";
import { AtomDetail } from "./AtomDetail.js";
import { buildComparisonScene, buildCrystalFrame, elementLegend, parseIntegerDirection } from "./scene.js";
import { compareStructures, type StructureComparison } from "./comparison.js";
import { ComparisonInspector } from "./ComparisonInspector.js";
import { DataTableFallback } from "../fallback/DataTableFallback.js";
import {
  DraggableCrystalPalette,
  type PalettePosition,
} from "../layout/DraggableCrystalPalette.js";
import { ResizableAtomInspector } from "../layout/ResizableAtomInspector.js";

export interface CrystalPanelProps {
  readonly sites: readonly Site[];
  readonly selectedStep: IonicStep;
  readonly selectedSite: Site | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly onSelectSite: (siteIndex: number | null) => void;
  readonly rendererFactory: CrystalRendererFactory;
  readonly volumetricLayer?: VolumetricLayer | null;
  readonly palettePosition?: Readonly<PalettePosition>;
  readonly paletteCollapsed?: boolean;
  readonly onPalettePositionChange?: (position: Readonly<PalettePosition>) => void;
  readonly onPaletteCollapsedChange?: (collapsed: boolean) => void;
  readonly onResetLayout?: () => void;
  readonly inspectorWidth?: number;
  readonly inspectorCollapsed?: boolean;
  readonly onInspectorWidthChange?: (width: number) => void;
  readonly onInspectorCollapsedChange?: (collapsed: boolean) => void;
  readonly structureFullScreen?: boolean;
  readonly initialStructure?: InitialStructure | null;
  readonly comparisonTarget?: IonicStep | null;
  readonly displacementScale?: number;
}

const DEFAULT_PALETTE_POSITION = Object.freeze({ x: 10, y: 10 });
const ignorePosition = (): void => undefined;
const ignoreCollapsed = (): void => undefined;
const ignoreReset = (): void => undefined;
const ignoreWidth = (): void => undefined;

const LAYERS: readonly {
  readonly name: LayerName;
  readonly label: string;
  readonly initial: boolean;
}[] = [
  { name: "cell", label: "cell", initial: true },
  { name: "axes", label: "axes", initial: true },
  { name: "bonds", label: "bonds", initial: true },
  { name: "forces", label: "forces", initial: true },
  { name: "constraints", label: "constraints", initial: true },
  { name: "volumetric", label: "volumetric", initial: false },
];

const validRepeat = (value: string): boolean => /^[1-8]$/.test(value);

export function CrystalPanel({
  sites,
  selectedStep,
  selectedSite,
  forceMode,
  forceScale,
  onSelectSite,
  rendererFactory,
  volumetricLayer = null,
  palettePosition = DEFAULT_PALETTE_POSITION,
  paletteCollapsed = true,
  onPalettePositionChange = ignorePosition,
  onPaletteCollapsedChange = ignoreCollapsed,
  onResetLayout = ignoreReset,
  inspectorWidth = 280,
  inspectorCollapsed = false,
  onInspectorWidthChange = ignoreWidth,
  onInspectorCollapsedChange = ignoreCollapsed,
  structureFullScreen = false,
  initialStructure = null,
  comparisonTarget = null,
  displacementScale = 10,
}: CrystalPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<CrystalRendererFactory> | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const selectHandler = useRef(onSelectSite);
  const [repeat, setRepeat] = useState<SupercellRepeat>([1, 1, 1]);
  const [repeatInputs, setRepeatInputs] = useState<
    readonly [string, string, string]
  >(["1", "1", "1"]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [orthographic, setOrthographic] = useState(false);
  const [direction, setDirection] = useState("1 0 0");
  const [semantics, setSemantics] = useState<DirectionSemantics>("direct");
  const [directionError, setDirectionError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Readonly<Record<LayerName, boolean>>>(
    () =>
      Object.fromEntries(
        LAYERS.map(({ name, initial }) => [name, initial]),
      ) as Record<LayerName, boolean>,
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const failRenderer = useCallback((reason: unknown) => {
    resizeObserver.current?.disconnect();
    resizeObserver.current = null;
    const failed = renderer.current;
    renderer.current = null;
    try {
      failed?.dispose();
    } catch {
      // The fallback must survive teardown failures.
    }
    setRenderError(
      (current) =>
        current ??
        (reason instanceof Error
          ? reason.message
          : "WebGL renderer unavailable"),
    );
  }, []);
  const invokeRenderer = useCallback(
    (operation: (instance: NonNullable<typeof renderer.current>) => void) => {
      const instance = renderer.current;
      if (!instance) return;
      try {
        operation(instance);
      } catch (reason) {
        failRenderer(reason);
      }
    },
    [failRenderer],
  );

  const sceneInputs = useMemo(
    () =>
      sites.map((site, position) => ({
        siteIndex: site.siteIndex,
        element: site.element,
        fractionalPosition: selectedStep.fractionalPositions[position]!,
        cartesianPosition: selectedStep.cartesianPositions[position]!,
      })),
    [sites, selectedStep],
  );
  const frame = useMemo(
    () => buildCrystalFrame(sceneInputs, selectedStep.lattice, repeat),
    [sceneInputs, selectedStep.lattice, repeat],
  );
  const comparisonResult = useMemo<Readonly<{ value: StructureComparison | null; scene: ReturnType<typeof buildComparisonScene> | null; error: unknown }>>(() => {
    if (!initialStructure || !comparisonTarget) return { value: null, scene: null, error: null };
    try {
      const value = compareStructures(initialStructure, comparisonTarget);
      const scene = buildComparisonScene(
        sites.map((site, position) => ({ siteIndex: site.siteIndex, element: site.element, fractionalPosition: initialStructure.fractionalPositions[position]!, cartesianPosition: initialStructure.cartesianPositions[position]! })),
        sites.map((site, position) => ({ siteIndex: site.siteIndex, element: site.element, fractionalPosition: comparisonTarget.fractionalPositions[position]!, cartesianPosition: comparisonTarget.cartesianPositions[position]! })),
        initialStructure.lattice, comparisonTarget.lattice, value, repeat, displacementScale);
      return { value, scene, error: null };
    }
    catch (error) { return { value: null, scene: null, error }; }
  }, [comparisonTarget, displacementScale, initialStructure, repeat, sites]);
  const comparison = comparisonResult.value;
  useEffect(() => { if (comparisonResult.error) failRenderer(comparisonResult.error); }, [comparisonResult, failRenderer]);
  const comparisonScene = comparisonResult.scene;
  const legend = useMemo(() => elementLegend(sites), [sites]);
  const vectors = useMemo(
    () =>
      Object.freeze(
        sites.map((site, position) =>
          Object.freeze({
            siteIndex: site.siteIndex,
            origin: selectedStep.cartesianPositions[position]!,
            vector:
              forceMode === "free"
                ? (selectedStep.freeForces?.[position] ?? null)
                : (selectedStep.rawForces[position] ?? null),
            strongestAxis:
              selectedStep.strongestFreeComponent?.siteIndex === site.siteIndex
                ? selectedStep.strongestFreeComponent.axis
                : null,
            strongestValue:
              selectedStep.strongestFreeComponent?.siteIndex === site.siteIndex
                ? selectedStep.strongestFreeComponent.value
                : null,
          } satisfies VectorGlyph),
        ),
      ),
    [forceMode, selectedStep, sites],
  );
  const constraints = useMemo(() => {
    const focus = hovered ?? selectedSite?.siteIndex ?? null;
    return Object.freeze(
      sites.map((site, position) =>
        Object.freeze({
          siteIndex: site.siteIndex,
          origin: selectedStep.cartesianPositions[position]!,
          states: [
            site.selectiveDynamics.a,
            site.selectiveDynamics.b,
            site.selectiveDynamics.c,
          ],
          directions: selectedStep.lattice.map((vector) => {
            const length = Math.hypot(...vector);
            return vector.map((value) => value / length) as [number, number, number];
          }) as [[number, number, number], [number, number, number], [number, number, number]],
          emphasized: site.siteIndex === focus,
        } satisfies ConstraintGlyph),
      ),
    );
  }, [hovered, selectedSite, selectedStep, sites]);

  useEffect(() => {
    selectHandler.current = onSelectSite;
  }, [onSelectSite]);

  useEffect(() => {
    if (!container.current) return;
    try {
      const instance = rendererFactory(container.current);
      renderer.current = instance;
      instance.onSelectSite((siteIndex) => selectHandler.current(siteIndex));
      instance.onHoverSite(setHovered);
      instance.onError?.(failRenderer);
      resizeObserver.current =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => invokeRenderer((current) => current.resize()));
      resizeObserver.current?.observe(container.current);
      return () => {
        resizeObserver.current?.disconnect();
        resizeObserver.current = null;
        if (renderer.current !== instance) return;
        renderer.current = null;
        try {
          instance.dispose();
        } catch {
          // Cleanup must remain non-throwing after renderer failure.
        }
      };
    } catch (reason) {
      failRenderer(reason);
    }
  }, [failRenderer, invokeRenderer, rendererFactory]);

  useEffect(() => {
    const query =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const update = () =>
      invokeRenderer((instance) =>
        instance.setTransitionDuration?.(query?.matches ? 0 : 150),
      );
    update();
    query?.addEventListener?.("change", update);
    return () => query?.removeEventListener?.("change", update);
  }, [invokeRenderer]);

  useEffect(() => {
    invokeRenderer((instance) => {
      if (instance.setScene)
        instance.setScene({
          frame,
          forces: vectors,
          forceScale,
          constraints,
          supercell: repeat,
          comparison: comparisonScene,
        });
      else {
        instance.setStructure(frame);
        instance.setForces(vectors);
        instance.setForceScale(forceScale);
        instance.setConstraints(constraints);
        instance.setSupercell(repeat);
      }
    });
  }, [comparisonScene, constraints, forceScale, frame, invokeRenderer, repeat, vectors]);
  useEffect(() => {
    invokeRenderer((instance) =>
      instance.setSelectedSite(selectedSite?.siteIndex ?? null),
    );
  }, [invokeRenderer, selectedSite]);
  useEffect(() => {
    invokeRenderer((instance) => instance.setOrthographic(orthographic));
  }, [invokeRenderer, orthographic]);
  useEffect(() => {
    for (const { name } of LAYERS)
      invokeRenderer((instance) =>
        instance.setLayerVisible(name, layers[name]),
      );
  }, [invokeRenderer, layers]);
  useEffect(() => {
    invokeRenderer((instance) => instance.setVolumetricLayer(volumetricLayer));
  }, [invokeRenderer, volumetricLayer]);

  const applyDirection = () => {
    try {
      const parsed = parseIntegerDirection(direction);
      invokeRenderer((instance) => instance.setViewDirection(parsed, semantics));
      setDirectionError(null);
    } catch (reason) {
      setDirectionError(
        reason instanceof Error ? reason.message : "Invalid direction",
      );
    }
  };
  const repeatInvalid = repeatInputs.some((value) => !validRepeat(value));
  const updateRepeat = (axis: number, value: string) => {
    const next = repeatInputs.map((item, index) =>
      index === axis ? value : item,
    ) as [string, string, string];
    setRepeatInputs(Object.freeze(next));
    if (next.every(validRepeat))
      setRepeat(Object.freeze(next.map(Number)) as SupercellRepeat);
  };
  return (
    <div className="crystal-panel" ref={panel}>
      {!renderError && (
        <DraggableCrystalPalette
          viewportRef={panel}
          position={palettePosition}
          collapsed={paletteCollapsed}
          onPositionChange={onPalettePositionChange}
          onCollapsedChange={onPaletteCollapsedChange}
          onReset={onResetLayout}
        >
        <fieldset>
          <legend>Supercell</legend>
          {(["a", "b", "c"] as const).map((label, axis) => (
            <label key={label}>
              {label}
              <input
                aria-label={`Supercell ${label}`}
                className="supercell-input"
                type="text"
                inputMode="numeric"
                aria-invalid={!validRepeat(repeatInputs[axis]!)}
                value={repeatInputs[axis]}
                onChange={(event) => updateRepeat(axis, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
        {repeatInvalid && (
          <p className="control-error" role="alert">
            Supercell repeats must be explicit integers from 1 to 8.
          </p>
        )}
        <fieldset>
          <legend>Layers</legend>
          {LAYERS.map(({ name, label }) => (
            <label key={name}>
              <input
                aria-label={`Show ${label}`}
                type="checkbox"
                checked={layers[name]}
                onChange={(event) =>
                  setLayers((current) => ({
                    ...current,
                    [name]: event.target.checked,
                  }))
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="view-controls">
          {(
            [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ] as const
          ).map((preset) => (
            <button
              key={preset.join()}
              type="button"
              onClick={() =>
                invokeRenderer((instance) =>
                  instance.setViewDirection(preset, "direct"),
                )
              }
            >
              View [{preset.join("")}]
            </button>
          ))}
          <label>
            Direction semantics
            <select
              aria-label="Direction semantics"
              value={semantics}
              onChange={(event) =>
                setSemantics(event.target.value as DirectionSemantics)
              }
            >
              <option value="direct">[uvw] direct direction</option>
              <option value="plane-normal">
                (hkl) reciprocal plane normal
              </option>
            </select>
          </label>
          <label>
            Integer direction
            <input
              aria-label="Integer direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            />
          </label>
          <button type="button" onClick={applyDirection}>
            Apply direction
          </button>
          <label>
            <input
              aria-label="Orthographic projection"
              type="checkbox"
              checked={orthographic}
              onChange={(event) => setOrthographic(event.target.checked)}
            />
            Orthographic
          </label>
          <button
            type="button"
            onClick={() => invokeRenderer((instance) => instance.resetView())}
          >
            Reset view
          </button>
        </div>
        {directionError && (
          <p className="control-error" role="alert">
            {directionError}
          </p>
        )}
        {selectedStep.strongestFreeComponent && (
          <button
            className="strongest-focus"
            type="button"
            onClick={() =>
              onSelectSite(selectedStep.strongestFreeComponent!.siteIndex)
            }
          >
            Focus strongest: site{" "}
            {selectedStep.strongestFreeComponent.siteIndex + 1}{" "}
            {selectedStep.strongestFreeComponent.axis}
          </button>
        )}
        </DraggableCrystalPalette>
      )}
      {renderError ? (
        <DataTableFallback
          sites={sites}
          step={selectedStep}
          reason={renderError}
        />
      ) : (
        <ResizableAtomInspector
          width={inspectorWidth}
          collapsed={inspectorCollapsed}
          onWidthChange={onInspectorWidthChange}
          onCollapsedChange={onInspectorCollapsedChange}
          inspector={
            selectedSite ? (
              comparison && initialStructure && comparisonTarget ? <ComparisonInspector site={selectedSite} sitePosition={sites.findIndex((site) => site.siteIndex === selectedSite.siteIndex)} initial={initialStructure} target={comparisonTarget} comparison={comparison} multiplier={displacementScale} /> : <AtomDetail
                site={selectedSite}
                sitePosition={sites.findIndex(
                  (site) => site.siteIndex === selectedSite.siteIndex,
                )}
                step={selectedStep}
              />
            ) : null
          }
          splitterHidden={structureFullScreen}
        >
          {(selectedStep.externalPressureKb !== null
            || selectedStep.pulayStressKb !== null
            || selectedStep.cellVolume !== null) && (
            <div
              className="cell-status atom-overlay"
              role="status"
              aria-label="Cell and stress status"
            >
              <span>External pressure {selectedStep.externalPressureKb === null ? "Unavailable" : `${selectedStep.externalPressureKb} kB`}</span>
              <span>Pulay stress {selectedStep.pulayStressKb === null ? "Unavailable" : `${selectedStep.pulayStressKb} kB`}</span>
              <span>Volume {selectedStep.cellVolume === null ? "Unavailable" : `${selectedStep.cellVolume} Å³`}</span>
            </div>
          )}
          <ul className="element-legend atom-overlay" aria-label="Elements in structure">
            {legend.map((item) => (
              <li key={item.element} aria-label={`${item.element}, atom color ${item.color}, display radius ${item.radius.toFixed(2)} angstrom`}>
                <span aria-hidden="true" style={{ backgroundColor: item.color }} />{item.element}
              </li>
            ))}
          </ul>
          <div
            className="crystal-stage"
            ref={container}
            aria-label="Interactive crystal viewer"
          />
        </ResizableAtomInspector>
      )}
    </div>
  );
}
