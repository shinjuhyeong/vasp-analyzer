import { useEffect, useMemo, useRef, useState } from "react";

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

function safeRepeat(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(8, Math.max(1, parsed)) : 1;
}

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
          : new ResizeObserver(() => instance.resize());
      resizeObserver?.observe(container.current);
      return () => {
        resizeObserver?.disconnect();
        instance.dispose();
        renderer.current = null;
      };
    } catch (reason) {
      setRenderError(
        reason instanceof Error ? reason.message : "WebGL renderer unavailable",
      );
    }
  }, [rendererFactory]);

  useEffect(() => {
    renderer.current?.setStructure(frame);
    renderer.current?.setSupercell(repeat);
  }, [frame, repeat]);
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
    renderer.current?.setForces(
      Object.freeze(vectors.map((vector) => Object.freeze(vector))),
    );
  }, [forceMode, selectedStep, sites]);
  useEffect(() => {
    renderer.current?.setForceScale(forceScale);
  }, [forceScale]);
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
    renderer.current?.setConstraints(
      Object.freeze(constraints.map((glyph) => Object.freeze(glyph))),
    );
  }, [hovered, selectedSite, selectedStep, sites]);
  useEffect(() => {
    renderer.current?.setSelectedSite(selectedSite?.siteIndex ?? null);
  }, [selectedSite]);
  useEffect(() => {
    renderer.current?.setOrthographic(orthographic);
  }, [orthographic]);
  useEffect(() => {
    for (const { name } of LAYERS)
      renderer.current?.setLayerVisible(name, layers[name]);
  }, [layers]);
  useEffect(() => {
    renderer.current?.setVolumetricLayer(volumetricLayer);
  }, [volumetricLayer]);

  const applyDirection = () => {
    try {
      const parsed = parseIntegerDirection(direction);
      renderer.current?.setViewDirection(parsed, semantics);
      setDirectionError(null);
    } catch (reason) {
      setDirectionError(
        reason instanceof Error ? reason.message : "Invalid direction",
      );
    }
  };
  const updateRepeat = (axis: number, value: string) =>
    setRepeat(
      (current) =>
        Object.freeze(
          current.map((item, index) =>
            index === axis ? safeRepeat(value) : item,
          ),
        ) as SupercellRepeat,
    );
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
                type="number"
                min="1"
                max="8"
                value={repeat[axis]}
                onChange={(event) => updateRepeat(axis, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
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
                renderer.current?.setViewDirection(preset, "direct")
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
          <button type="button" onClick={() => renderer.current?.resetView()}>
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
      <div
        className="crystal-stage"
        ref={container}
        aria-label="Interactive crystal viewer"
      >
        {renderError && (
          <div className="renderer-fallback" role="alert">
            3D view unavailable: {renderError}. Structure data remains available
            below.
          </div>
        )}
      </div>
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
    </div>
  );
}
