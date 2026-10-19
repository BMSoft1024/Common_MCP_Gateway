import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DownstreamServerConfig } from '../types/config';

/**
 * On-disk cache of each downstream server's tools/list result, shared by every gate instance.
 * With it a gate answers tools/list without spawning any downstream process; a server is only started
 * when one of its tools is actually called (or when its cache entry is missing or stale).
 */
const CACHE_DIR = path.join(os.homedir(), '.common-mcp', 'tools-cache');
const DEFAULT_TTL_MS = Number(process.env.COMMON_MCP_TOOLS_TTL_MS) || 24 * 60 * 60 * 1000;
const FLOATING_TTL_MS = Math.min(DEFAULT_TTL_MS, 4 * 60 * 60 * 1000);
const LAUNCHERS = new Set(['npx', 'uvx', 'pipx', 'bunx', 'pnpx']);

/**
 * Servers started through a package launcher without a pinned version (npx, uvx, mcp-remote to a URL) can gain
 * tools without their command changing, so their cached list expires sooner than a pinned or local command.
 */
export function toolsCacheTtlMs(config: DownstreamServerConfig): number {
  const command = path.basename(config.command).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();
  const args = config.args ?? [];
  const launcher = LAUNCHERS.has(command) || ((command === 'pnpm' || command === 'yarn') && args[0] === 'dlx');
  if (!launcher)
    return DEFAULT_TTL_MS;

  const pinned = args.some((arg) => /^@?[\w./-]+(@|==)\d+(\.\d+)*/.test(arg));
  return pinned ? DEFAULT_TTL_MS : FLOATING_TTL_MS;
}

/** Changes whenever the way the server is started changes, which invalidates its cached tool list. */
export function toolsCacheKey(config: DownstreamServerConfig): string {
  const identity = JSON.stringify({ command: config.command, args: config.args ?? [], envKeys: Object.keys(config.env ?? {}).sort() });
  return crypto.createHash('sha1').update(identity).digest('hex');
}

function cacheFile(serverId: string): string {
  return path.join(CACHE_DIR, `${serverId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

export function readToolsCache(serverId: string, key: string, ttlMs: number = DEFAULT_TTL_MS): any[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(serverId), 'utf8'));
    if (parsed.key !== key || !Array.isArray(parsed.tools) || Date.now() - parsed.savedAt > ttlMs)
      return null;

    return parsed.tools;
  } catch {
    return null;
  }
}

export function writeToolsCache(serverId: string, key: string, tools: any[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(serverId), JSON.stringify({ key, savedAt: Date.now(), tools }));
  } catch {
    // the cache is an optimisation, never a reason to fail
  }
}

const FAIL_TTL_MS = 10 * 60 * 1000;

function failFile(serverId: string): string {
  return path.join(CACHE_DIR, `${serverId.replace(/[^a-zA-Z0-9_-]/g, '_')}.fail.json`);
}

/** True when this server failed to start recently in ANY gate, so no other gate respawns it just to fail again. */
export function wasRecentlyFailed(serverId: string, key: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(failFile(serverId), 'utf8'));
    return parsed.key === key && Date.now() - parsed.failedAt < FAIL_TTL_MS;
  } catch {
    return false;
  }
}

export function markFailed(serverId: string, key: string): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(failFile(serverId), JSON.stringify({ key, failedAt: Date.now() }));
  } catch {
    // best effort
  }
}
