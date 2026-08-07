/**
 * FsCapabilityStore — FS adapter for CapabilityStore (D5 L2 / L4 / ABS-A3).
 *
 * Maps bare capability ids to module paths via harness search order.
 * Absolute paths live only in entry / ref.locator — never as domain identity.
 *
 * Search order (from company/agents/_harness/resolve.ts / former resolveExtensionPath):
 * 1. name contains `/` → projectRoot-relative
 * 2. tools/internal/<name>
 * 3. extensions/<name>
 * 4. .pi/extensions/<name>
 * 5. tools/families/<name>
 * 6. ~/.pi/agent/extensions/<name>
 * 7. absolute path if exists
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  asCapabilityId,
  type CapabilityId,
  type CapabilityKind,
} from "../../domain/capability.ts";
import type {
  CapabilityArtifact,
  CapabilityGetOptions,
  CapabilityStore,
} from "../../ports/capability-store.ts";

/**
 * Where a module was found in the ordered FS search.
 * Same labels as PackSource (packs domain); kept here so packs can thin-wrap.
 */
export type FsCapabilitySource =
  | "explicit"
  | "internal"
  | "project-extensions"
  | "agent"
  | "families"
  | "global-pi";

/** Low-level FS hit — path + search provenance. */
export type FsResolvedModule = {
  readonly id: string;
  readonly path: string;
  readonly source: FsCapabilitySource;
};

export type FsCapabilityStoreOptions = {
  /** Project / pack root used as search base. */
  readonly projectRoot: string;
  /** Override home for tests (default: os.homedir()). */
  readonly homeDir?: string;
};

/**
 * Resolve a single capability name against project root (and optional home).
 * Returns null when not found. Pure FS I/O — no CapabilityStore types.
 */
export function resolveFsModule(
  name: string,
  projectRoot: string,
  homeDir: string = os.homedir(),
): FsResolvedModule | null {
  const root = path.resolve(projectRoot);

  // 1. Slash → relative to project root
  if (name.includes("/")) {
    const relPath = path.resolve(root, name);
    if (fs.existsSync(relPath)) {
      return { id: name, path: relPath, source: "explicit" };
    }
  }

  // 2. tools/internal/<name>
  const internalPath = path.join(root, "tools", "internal", name);
  if (fs.existsSync(internalPath)) {
    return { id: name, path: internalPath, source: "internal" };
  }

  // 3. extensions/<name>
  const projectExtPath = path.join(root, "extensions", name);
  if (fs.existsSync(projectExtPath)) {
    return { id: name, path: projectExtPath, source: "project-extensions" };
  }

  // 4. .pi/extensions/<name>
  const dotPiPath = path.join(root, ".pi", "extensions", name);
  if (fs.existsSync(dotPiPath)) {
    return { id: name, path: dotPiPath, source: "agent" };
  }

  // 5. tools/families/<name>
  const familyPath = path.join(root, "tools", "families", name);
  if (fs.existsSync(familyPath)) {
    return { id: name, path: familyPath, source: "families" };
  }

  // 6. ~/.pi/agent/extensions/<name>
  const globalPath = path.join(homeDir, ".pi", "agent", "extensions", name);
  if (fs.existsSync(globalPath)) {
    return { id: name, path: globalPath, source: "global-pi" };
  }

  // 7. Absolute path if exists
  if (path.isAbsolute(name) && fs.existsSync(name)) {
    return { id: name, path: name, source: "explicit" };
  }

  return null;
}

function kindFromSource(source: FsCapabilitySource): CapabilityKind {
  switch (source) {
    case "internal":
    case "families":
      return "custom-tool";
    case "project-extensions":
    case "agent":
    case "global-pi":
      return "extension";
    case "explicit":
      return "other";
  }
}

function artifactFromResolved(found: FsResolvedModule): CapabilityArtifact {
  const id = asCapabilityId(found.id);
  return {
    ref: {
      id,
      kind: kindFromSource(found.source),
      origin: "fs",
      locator: { path: found.path, source: found.source },
    },
    entry: {
      kind: "module-path",
      modulePath: found.path,
    },
  };
}

/**
 * Filesystem CapabilityStore. Identity is the bare id; path only in entry/locator.
 *
 * Version/digest: the FS layout is unversioned — a file path carries no version
 * metadata, so `get` forwards `opts` to callers but cannot filter by version.
 * Versioned lookups belong to versioned media (registry / memory); the
 * composite store walks registry → fs and versioned stores honor the selector
 * while fs serves as the unversioned fallback (D5 L1: durable snapshots prefer
 * id + source + digest — the fs adapter does not invent versions).
 */
export class FsCapabilityStore implements CapabilityStore {
  private readonly projectRoot: string;
  private readonly homeDir: string;

  constructor(opts: FsCapabilityStoreOptions) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.homeDir = opts.homeDir ?? os.homedir();
  }

  async get(
    id: CapabilityId,
    _opts?: CapabilityGetOptions,
  ): Promise<CapabilityArtifact | null> {
    const found = resolveFsModule(id, this.projectRoot, this.homeDir);
    if (!found) return null;
    return artifactFromResolved(found);
  }
}

export function createFsCapabilityStore(
  opts: FsCapabilityStoreOptions,
): FsCapabilityStore {
  return new FsCapabilityStore(opts);
}
