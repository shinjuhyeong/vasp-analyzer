export interface ActivationResource {
  close(): void | Promise<void>;
}

export type ActivationCleanup = () => void | Promise<void>;

interface Generation<Resource extends ActivationResource> {
  readonly controller: AbortController;
  start: Promise<void>;
  resource?: Resource;
  cleanup?: ActivationCleanup;
  cleanupIssued: boolean;
  closeIssued: boolean;
}

export class ActivationCoordinator<Resource extends ActivationResource> {
  private current: Generation<Resource> | undefined;
  private readonly pendingStops = new Set<Promise<void>>();

  get hasActiveGeneration(): boolean {
    return this.current !== undefined && !this.current.controller.signal.aborted;
  }

  activate(
    factory: (signal: AbortSignal) => Promise<Resource>,
    install: (resource: Resource, signal: AbortSignal) => ActivationCleanup | Promise<ActivationCleanup>,
  ): Promise<void> {
    if (this.current) return this.current.start;
    const generation: Generation<Resource> = {
      controller: new AbortController(),
      start: Promise.resolve(),
      cleanupIssued: false,
      closeIssued: false,
    };
    this.current = generation;
    const predecessors =
      this.pendingStops.size > 0
        ? Promise.all([...this.pendingStops]).then(() => undefined)
        : undefined;
    generation.start = this.startGeneration(generation, predecessors, factory, install);
    return generation.start;
  }

  deactivate(): Promise<void> {
    const generation = this.current;
    if (generation) {
      this.current = undefined;
      generation.controller.abort();
      const stopping = this.stopGeneration(generation);
      this.pendingStops.add(stopping);
      void stopping.then(
        () => this.pendingStops.delete(stopping),
        () => this.pendingStops.delete(stopping),
      );
    }
    return Promise.all([...this.pendingStops]).then(() => undefined);
  }

  private async startGeneration(
    generation: Generation<Resource>,
    predecessors: Promise<void> | undefined,
    factory: (signal: AbortSignal) => Promise<Resource>,
    install: (resource: Resource, signal: AbortSignal) => ActivationCleanup | Promise<ActivationCleanup>,
  ): Promise<void> {
    try {
      if (predecessors) {
        await predecessors;
        if (generation.controller.signal.aborted) return;
      }
      const resource = await factory(generation.controller.signal);
      generation.resource = resource;
      if (generation.controller.signal.aborted) return;
      generation.cleanup = await install(resource, generation.controller.signal);
    } catch (error) {
      await this.finishGeneration(generation);
      if (this.current === generation) this.current = undefined;
      if (!generation.controller.signal.aborted) throw error;
    }
  }

  private async stopGeneration(generation: Generation<Resource>): Promise<void> {
    await generation.start.catch(() => undefined);
    await this.finishGeneration(generation);
  }

  private async finishGeneration(generation: Generation<Resource>): Promise<void> {
    try {
      if (!generation.cleanupIssued && generation.cleanup) {
        generation.cleanupIssued = true;
        await generation.cleanup();
      }
    } finally {
      if (!generation.closeIssued && generation.resource) {
        generation.closeIssued = true;
        await generation.resource.close();
      }
    }
  }
}
