// UI slot registry.
//
// Plugins contribute React components into named slots. The host owns the
// list of valid slots and the props contract per slot. Adding new slots is
// non-breaking (existing plugins ignore them); changing prop contracts on
// existing slots requires apiVersion bump.

import type { ComponentType } from "react";
import type { GrimoireId, GrimoireSlotName } from "../types";

/** Props passed to components mounted in each slot. Stable contracts —
 *  adding fields is non-breaking; renaming or removing requires apiVersion
 *  bump. */
export interface SlotPropMap {
  "settings:section": {
    pluginId: GrimoireId;
  };
  "inspector:tab": {
    pluginId: GrimoireId;
    /** Active character id (string) or null when no character loaded. */
    characterId: string | null;
  };
  "chat:input:toolbar": {
    pluginId: GrimoireId;
    /** Current draft text (read-only — toolbar can't replace input). */
    draft: string;
  };
}

export interface SlotContribution<S extends GrimoireSlotName = GrimoireSlotName> {
  pluginId: GrimoireId;
  slot: S;
  /** Optional title — shown as tab label / section header / button tooltip. */
  title?: string;
  component: ComponentType<SlotPropMap[S]>;
}

export class SlotRegistry {
  private bySlot = new Map<GrimoireSlotName, SlotContribution[]>();

  register<S extends GrimoireSlotName>(
    pluginId: GrimoireId,
    slot: S,
    component: ComponentType<SlotPropMap[S]>,
    opts: { title?: string } = {}
  ): void {
    const list = this.bySlot.get(slot) ?? [];
    list.push({
      pluginId,
      slot,
      title: opts.title,
      component: component as ComponentType<SlotPropMap[GrimoireSlotName]>,
    });
    this.bySlot.set(slot, list);
  }

  unregisterPlugin(pluginId: GrimoireId): void {
    for (const [slot, list] of this.bySlot) {
      this.bySlot.set(
        slot,
        list.filter((c) => c.pluginId !== pluginId)
      );
    }
  }

  /** Get contributions for a slot, in registration order. */
  get<S extends GrimoireSlotName>(slot: S): SlotContribution<S>[] {
    const list = this.bySlot.get(slot) ?? [];
    return list as unknown as SlotContribution<S>[];
  }

  /** All registered contributions — used by the inspector for plugin status. */
  list(): SlotContribution[] {
    const out: SlotContribution[] = [];
    for (const list of this.bySlot.values()) out.push(...list);
    return out;
  }
}
