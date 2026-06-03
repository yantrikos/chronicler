// Grimoire manifest validator. No zod dep — hand-rolled to keep the build
// graph clean. The validation rules are intentionally narrow so plugin
// authors get clear errors instead of cryptic runtime crashes.

import type {
  GrimoireManifest,
  GrimoirePermissions,
  HookPoint,
  HookType,
} from "./types";
import { GRIMOIRE_SDK_VERSION } from "./types";

export interface ManifestValidationResult {
  ok: boolean;
  manifest?: GrimoireManifest;
  errors: string[];
}

const VALID_HOOK_POINTS: ReadonlySet<HookPoint> = new Set([
  "beforeRetrieve",
  "afterRetrieve",
  "beforeCompose",
  "beforeChat",
  "afterChat",
  "beforeWrite",
  "afterWrite",
]);

const VALID_HOOK_TYPES: ReadonlySet<HookType> = new Set([
  "observer",
  "augmenter",
  "strategy",
]);

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[a-z0-9-]+(?:\.[a-z0-9-]+)*)?$/i;
const SEMVER_RANGE_RE = /^[\^~]?\d+\.\d+\.\d+/;
const ID_RE = /^[a-z][a-z0-9._@/-]*[a-z0-9]$/i;

export function validateManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const m = input as Record<string, unknown>;

  // Required: id
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    errors.push(`id must be a string matching ${ID_RE}`);
  }
  // Required: name
  if (typeof m.name !== "string" || m.name.length === 0) {
    errors.push("name must be a non-empty string");
  }
  // Required: version (semver)
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    errors.push("version must be valid semver (e.g. 1.0.0)");
  }
  // Required: apiVersion (semver range)
  if (typeof m.apiVersion !== "string" || !SEMVER_RANGE_RE.test(m.apiVersion)) {
    errors.push("apiVersion must be a semver range (e.g. ^0.1.0)");
  } else if (!isApiVersionCompatible(m.apiVersion)) {
    errors.push(
      `apiVersion ${m.apiVersion} is not compatible with this host's SDK version ${GRIMOIRE_SDK_VERSION}`
    );
  }

  // Optional fields with type checks
  for (const f of ["description", "author", "license", "homepage"] as const) {
    if (f in m && typeof m[f] !== "string") {
      errors.push(`${f} must be a string when present`);
    }
  }
  if ("keywords" in m && !isStringArray(m.keywords)) {
    errors.push("keywords must be an array of strings when present");
  }

  // permissions block
  if ("permissions" in m && m.permissions != null) {
    const permErrors = validatePermissions(m.permissions);
    errors.push(...permErrors);
  }

  // contributes block
  if ("contributes" in m && m.contributes != null) {
    if (typeof m.contributes !== "object") {
      errors.push("contributes must be an object when present");
    } else {
      const c = m.contributes as Record<string, unknown>;
      if ("hooks" in c && c.hooks != null) {
        if (!Array.isArray(c.hooks)) {
          errors.push("contributes.hooks must be an array");
        } else {
          c.hooks.forEach((h: unknown, i: number) => {
            if (!h || typeof h !== "object") {
              errors.push(`contributes.hooks[${i}] must be an object`);
              return;
            }
            const hook = h as Record<string, unknown>;
            if (typeof hook.point !== "string" || !VALID_HOOK_POINTS.has(hook.point as HookPoint)) {
              errors.push(`contributes.hooks[${i}].point invalid; got ${String(hook.point)}`);
            }
            if (typeof hook.type !== "string" || !VALID_HOOK_TYPES.has(hook.type as HookType)) {
              errors.push(`contributes.hooks[${i}].type invalid; got ${String(hook.type)}`);
            }
          });
        }
      }
      if ("commands" in c && c.commands != null && !isStringArray(c.commands)) {
        errors.push("contributes.commands must be an array of strings");
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: m as unknown as GrimoireManifest, errors: [] };
}

function validatePermissions(p: unknown): string[] {
  const errors: string[] = [];
  if (!p || typeof p !== "object") {
    return ["permissions must be an object"];
  }
  const perm = p as Record<string, unknown>;
  if ("network" in perm && perm.network != null && !isStringArray(perm.network)) {
    errors.push("permissions.network must be string[] (use [] or ['*'])");
  }
  if ("filesystem" in perm && perm.filesystem != null) {
    const v = perm.filesystem;
    if (v !== false && v !== "plugin-data-only" && v !== "read-app-data") {
      errors.push("permissions.filesystem must be false | 'plugin-data-only' | 'read-app-data'");
    }
  }
  if ("llm" in perm && perm.llm != null && typeof perm.llm !== "boolean") {
    errors.push("permissions.llm must be boolean");
  }
  if ("memory" in perm && perm.memory != null) {
    const v = perm.memory;
    if (v !== false && v !== "read" && v !== "write") {
      errors.push("permissions.memory must be false | 'read' | 'write'");
    }
  }
  return errors;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Minimal semver-range check: accepts ^X.Y.Z and ~X.Y.Z patterns and
 *  validates against GRIMOIRE_SDK_VERSION. NOT a full semver implementation
 *  — sufficient for v1's "is plugin compatible" check. */
export function isApiVersionCompatible(range: string): boolean {
  const sdkParts = GRIMOIRE_SDK_VERSION.split(".").map(Number);
  const m = range.match(/^([\^~]?)(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const [, op, majS, minS, patS] = m;
  const maj = Number(majS), min = Number(minS), pat = Number(patS);
  const [sdkMaj, sdkMin, sdkPat] = sdkParts;
  if (op === "^") {
    // ^X.Y.Z = compatible if same major (or same minor when major=0).
    if (maj !== sdkMaj) return false;
    if (maj === 0 && min !== sdkMin) return false;
    if (sdkMaj > maj) return true;
    if (sdkMin > min) return true;
    return sdkPat >= pat;
  }
  if (op === "~") {
    // ~X.Y.Z = compatible if same major + minor.
    if (maj !== sdkMaj || min !== sdkMin) return false;
    return sdkPat >= pat;
  }
  // exact match
  return maj === sdkMaj && min === sdkMin && pat === sdkPat;
}

/** Convenience — extract permission defaults for plugins that omit them. */
export function defaultPermissions(): GrimoirePermissions {
  return {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: "read",
  };
}
