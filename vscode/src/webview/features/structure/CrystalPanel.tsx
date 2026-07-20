import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IonicStep, Site } from "../../core/contracts.js";
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
import { buildCrystalFrame, parseIntegerDirection } from "./scene.js";
import { DataTableFallback } from "../fallback/DataTableFallback.js";

export interface CrystalPanelProps {
  readonly sites: readonly Site[];
  readonly selectedStep: IonicStep;
  readonly selectedSite: Site | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly onSelectSite: (siteIndex: number | null) => void;
  readonly rendererFactory: CrystalRendererFactory;
  readonly volumetricLayer?: VolumetricLayer | null;
}

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
}: CrystalPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<CrystalRendererFactory> | null>(null);
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
      const resizeObserver =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => invokeRenderer((current) => current.resize()));
      resizeObserver?.observe(container.current);
      return () => {
        resizeObserver?.disconnect();
        instance.dispose();
        renderer.current = null;
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
      instance.setStructure(frame);
      instance.setSupercell(repeat);
    });
  }, [frame, invokeRenderer, repeat]);
  useEffect(() => {
    const vectors: VectorGlyph[] = sites.map((site, position) => ({
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
    }));
    invokeRenderer((instance) =>
      instance.setForces(
        Object.freeze(vectors.map((vector) => Object.freeze(vector))),
      ),
    );
  }, [forceMode, invokeRenderer, selectedStep, sites]);
  useEffect(() => {
    invokeRenderer((instance) => instance.setForceScale(forceScale));
  }, [forceScale, invokeRenderer]);
  useEffect(() => {
    const focus = hovered ?? selectedSite?.siteIndex ?? null;
    const constraints: ConstraintGlyph[] = sites.map((site, position) => ({
      siteIndex: site.siteIndex,
      origin: selectedStep.cartesianPositions[position]!,
      states: [
        site.selectiveDynamics.x,
        site.selectiveDynamics.y,
        site.selectiveDynamics.z,
      ],
      emphasized: site.siteIndex === focus,
    }));
    invokeRenderer((instance) =>
      instance.setConstraints(
        Object.freeze(constraints.map((glyph) => Object.freeze(glyph))),
      ),
    );
  }, [hovered, invokeRenderer, selectedSite, selectedStep, sites]);
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
    <div className="crystal-panel">
      <div className="crystal-controls" aria-label="Crystal controls">
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
            {selectedStep.strongestFreeComponent.axis.toUpperCase()}
          </button>
        )}
      </div>
      {renderError ? (
        <DataTableFallback
          sites={sites}
          step={selectedStep}
          reason={renderError}
        />
      ) : (
        <>
          <div
            className="crystal-stage"
            ref={container}
            aria-label="Interactive crystal viewer"
          />
          {selectedSite ? (
            <AtomDetail
              site={selectedSite}
              sitePosition={sites.findIndex(
                (site) => site.siteIndex === selectedSite.siteIndex,
              )}
              step={selectedStep}
            />
          ) : (
            <aside className="atom-detail atom-detail-empty">
              Select an atom to inspect positions, forces, and constraints.
            </aside>
          )}
        </>
      )}
    </div>
  );
}
