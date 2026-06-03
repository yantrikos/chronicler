// Hook registry + dispatcher.
//
// Three flavors with distinct dispatch semantics:
//   observer  — fire-and-forget, errors caught, multiple per hook point
//   augmenter — awaited in order, may return mutated context, errors auto-disable
//   strategy  — exactly one per hook point; conflicts surface in settings UI
//
// The registry does NOT know about plugins directly — it operates on hook
// registration tokens (a stable opaque value tying the registration to a
// plugin id for error reporting + dispose).

import type {
  GrimoireApi,
  GrimoireId,
  HookContextMap,
  HookHandler,
  HookPoint,
  HookType,
} from "../types";

interface Registration<P extends HookPoint> {
  pluginId: GrimoireId;
  type: HookType;
  handler: HookHandler<P>;
}

export interface HookDispatchResult<P extends HookPoint> {
  context: HookContextMap[P];
  errors: Array<{ pluginId: GrimoireId; error: unknown }>;
}

export class HookRegistry {
  private registrations = new Map<HookPoint, Registration<HookPoint>[]>();
  /** Tracks which plugins have hit hard errors so the host can auto-disable. */
  private disabledPlugins = new Set<GrimoireId>();

  /** Plugin-author-facing registration API. */
  register<P extends HookPoint>(
    pluginId: GrimoireId,
    point: P,
    type: HookType,
    handler: HookHandler<P>
  ): void {
    if (type === "strategy") {
      const existing = (this.registrations.get(point) ?? []).find(
        (r) => r.type === "strategy"
      );
      if (existing) {
        throw new Error(
          `[grimoire] strategy conflict on ${point}: ${existing.pluginId} already registered, ${pluginId} rejected`
        );
      }
    }
    const list = this.registrations.get(point) ?? [];
    list.push({
      pluginId,
      type,
      handler: handler as unknown as HookHandler<HookPoint>,
    });
    this.registrations.set(point, list);
  }

  /** Remove all registrations for a plugin (used on dispose / hot reload). */
  unregisterPlugin(pluginId: GrimoireId): void {
    for (const [point, list] of this.registrations) {
      this.registrations.set(
        point,
        list.filter((r) => r.pluginId !== pluginId)
      );
    }
    this.disabledPlugins.delete(pluginId);
  }

  isDisabled(pluginId: GrimoireId): boolean {
    return this.disabledPlugins.has(pluginId);
  }

  /** Mark a plugin disabled (auto-disable after unhandled error in augmenter
   *  or strategy). Observers don't trigger auto-disable. */
  disable(pluginId: GrimoireId): void {
    this.disabledPlugins.add(pluginId);
  }

  /** Manually re-enable (from the inspector). */
  enable(pluginId: GrimoireId): void {
    this.disabledPlugins.delete(pluginId);
  }

  /** Dispatch a hook point with context. Returns the (possibly mutated)
   *  context + any errors caught. Strategy hooks run first (singleton),
   *  then augmenters in registration order, then observers (fire-and-forget). */
  async dispatch<P extends HookPoint>(
    point: P,
    initialContext: HookContextMap[P],
    buildApi: (pluginId: GrimoireId) => GrimoireApi
  ): Promise<HookDispatchResult<P>> {
    const list = this.registrations.get(point) ?? [];
    const errors: Array<{ pluginId: GrimoireId; error: unknown }> = [];
    let ctx: HookContextMap[P] = initialContext;

    // Filter out disabled plugins.
    const active = list.filter((r) => !this.disabledPlugins.has(r.pluginId));

    // Strategy first (singleton).
    const strategy = active.find((r) => r.type === "strategy");
    if (strategy) {
      try {
        const result = await strategy.handler(ctx, buildApi(strategy.pluginId));
        if (result) ctx = result as HookContextMap[P];
      } catch (e) {
        errors.push({ pluginId: strategy.pluginId, error: e });
        this.disable(strategy.pluginId);
      }
    }

    // Augmenters in registration order.
    for (const reg of active.filter((r) => r.type === "augmenter")) {
      try {
        const result = await reg.handler(ctx, buildApi(reg.pluginId));
        if (result) ctx = result as HookContextMap[P];
      } catch (e) {
        errors.push({ pluginId: reg.pluginId, error: e });
        this.disable(reg.pluginId);
      }
    }

    // Observers — fire-and-forget but awaited so logs land in order.
    for (const reg of active.filter((r) => r.type === "observer")) {
      try {
        await reg.handler(ctx, buildApi(reg.pluginId));
      } catch (e) {
        // Observer errors don't disable; just log.
        errors.push({ pluginId: reg.pluginId, error: e });
      }
    }

    return { context: ctx, errors };
  }

  /** Introspection — used by the inspector UI. */
  listRegistrations(): Array<{
    point: HookPoint;
    pluginId: GrimoireId;
    type: HookType;
    disabled: boolean;
  }> {
    const out: Array<{
      point: HookPoint;
      pluginId: GrimoireId;
      type: HookType;
      disabled: boolean;
    }> = [];
    for (const [point, list] of this.registrations) {
      for (const r of list) {
        out.push({
          point,
          pluginId: r.pluginId,
          type: r.type,
          disabled: this.disabledPlugins.has(r.pluginId),
        });
      }
    }
    return out;
  }
}
