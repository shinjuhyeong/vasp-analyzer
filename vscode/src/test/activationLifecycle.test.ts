import { describe, expect, it, vi } from "vitest";

import { ActivationCoordinator, type ActivationResource } from "../activationLifecycle.js";

interface FakeEndpoint extends ActivationResource {
  readonly id: string;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function endpoint(id: string): FakeEndpoint {
  return { id, close: vi.fn(async () => undefined) };
}

describe("ActivationCoordinator", () => {
  it("aborts a pending endpoint factory without installing late side effects", async () => {
    const coordinator = new ActivationCoordinator<FakeEndpoint>();
    let resolveFactory!: (value: FakeEndpoint) => void;
    const deferred = new Promise<FakeEndpoint>((resolve) => {
      resolveFactory = resolve;
    });
    const install = vi.fn(() => vi.fn());
    const stale = endpoint("stale");

    const activating = coordinator.activate(async () => await deferred, install);
    const deactivating = coordinator.deactivate();
    resolveFactory(stale);

    await Promise.all([activating, deactivating]);
    expect(stale.close).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(coordinator.hasActiveGeneration).toBe(false);
  });

  it("does not let stale cleanup clear or close a newer activation", async () => {
    const coordinator = new ActivationCoordinator<FakeEndpoint>();
    let resolveOld!: (value: FakeEndpoint) => void;
    const oldFactory = new Promise<FakeEndpoint>((resolve) => {
      resolveOld = resolve;
    });
    const oldEndpoint = endpoint("old");
    const newEndpoint = endpoint("new");
    const installed: string[] = [];

    const oldActivation = coordinator.activate(async () => await oldFactory, (resource) => {
      installed.push(resource.id);
      return () => undefined;
    });
    const oldDeactivation = coordinator.deactivate();
    const newFactory = vi.fn(async () => newEndpoint);
    const newActivation = coordinator.activate(newFactory, (resource) => {
      installed.push(resource.id);
      return () => undefined;
    });
    expect(newFactory).not.toHaveBeenCalled();
    resolveOld(oldEndpoint);
    await Promise.all([oldActivation, oldDeactivation, newActivation]);

    expect(installed).toEqual(["new"]);
    expect(oldEndpoint.close).toHaveBeenCalledOnce();
    expect(newEndpoint.close).not.toHaveBeenCalled();
    expect(coordinator.hasActiveGeneration).toBe(true);

    await coordinator.deactivate();
    expect(newEndpoint.close).toHaveBeenCalledOnce();
  });

  it("starts one endpoint and performs cleanup once for idempotent calls", async () => {
    const coordinator = new ActivationCoordinator<FakeEndpoint>();
    const activeEndpoint = endpoint("active");
    const factory = vi.fn(async () => activeEndpoint);
    const cleanup = vi.fn();
    const install = vi.fn(() => cleanup);

    const first = coordinator.activate(factory, install);
    const second = coordinator.activate(factory, install);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await Promise.all([coordinator.deactivate(), coordinator.deactivate()]);

    expect(factory).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(activeEndpoint.close).toHaveBeenCalledOnce();
  });
});
