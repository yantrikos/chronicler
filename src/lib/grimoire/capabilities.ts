// Capability check helpers. Used by sdk-runtime to wrap api.fetch / api.llm /
// api.memory / etc. with permission enforcement.
//
// Enforcement boundary: SDK-wrapped APIs only. Plugins that bypass the SDK
// (e.g. raw fetch, raw import of node modules) escape enforcement. This is
// documented as a trust boundary; "only install Grimoire entries from
// authors you trust."

import type { GrimoirePermissions } from "./types";
import { defaultPermissions } from "./manifest";

export class CapabilityError extends Error {
  constructor(public pluginId: string, public capability: string, message: string) {
    super(`[${pluginId}] capability '${capability}' denied: ${message}`);
    this.name = "CapabilityError";
  }
}

export function effectivePermissions(
  declared?: GrimoirePermissions
): Required<GrimoirePermissions> {
  const defaults = defaultPermissions() as Required<GrimoirePermissions>;
  return {
    network: declared?.network ?? defaults.network,
    filesystem: declared?.filesystem ?? defaults.filesystem,
    llm: declared?.llm ?? defaults.llm,
    memory: declared?.memory ?? defaults.memory,
  };
}

/** Check if `host` is allowed under network permissions. "*" matches all. */
export function isHostAllowed(host: string, allowed: string[]): boolean {
  if (allowed.includes("*")) return true;
  return allowed.some((rule) => {
    if (rule === host) return true;
    // wildcard subdomain match: *.example.com
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1); // ".example.com"
      return host.endsWith(suffix);
    }
    return false;
  });
}

export function assertNetwork(
  pluginId: string,
  url: string,
  perms: Required<GrimoirePermissions>
): void {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    throw new CapabilityError(pluginId, "network", `invalid URL: ${url}`);
  }
  if (!perms.network || perms.network.length === 0) {
    throw new CapabilityError(
      pluginId,
      "network",
      `no network access declared (manifest.permissions.network is empty)`
    );
  }
  if (!isHostAllowed(host, perms.network)) {
    throw new CapabilityError(
      pluginId,
      "network",
      `host ${host} not in allowed list ${JSON.stringify(perms.network)}`
    );
  }
}

export function assertLlm(
  pluginId: string,
  perms: Required<GrimoirePermissions>
): void {
  if (!perms.llm) {
    throw new CapabilityError(
      pluginId,
      "llm",
      `llm access denied (manifest.permissions.llm = false)`
    );
  }
}

export function assertMemoryRead(
  pluginId: string,
  perms: Required<GrimoirePermissions>
): void {
  if (perms.memory === false) {
    throw new CapabilityError(pluginId, "memory", `memory access denied`);
  }
}

export function assertMemoryWrite(
  pluginId: string,
  perms: Required<GrimoirePermissions>
): void {
  if (perms.memory !== "write") {
    throw new CapabilityError(
      pluginId,
      "memory:write",
      `write access denied (manifest.permissions.memory must be 'write')`
    );
  }
}
