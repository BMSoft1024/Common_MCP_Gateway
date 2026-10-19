import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Shared by the daemon and the stdio bridge: where the daemon listens and the token that guards it. */
export const DAEMON_HOST = '127.0.0.1';
export const DAEMON_PORT = Number(process.env.COMMON_MCP_PORT) || 47831;
export const DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

const TOKEN_FILE = path.join(os.homedir(), '.common-mcp', 'daemon.token');

function readPackageVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Version of the installed gateway package. Daemon and bridge compare it, so an update replaces a stale daemon. */
export const GATEWAY_VERSION = readPackageVersion();

/** True when `candidate` is a strictly newer version than `current`. An unreadable version counts as the oldest. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => version.split(/[.+-]/).map((part) => (Number.isNaN(parseInt(part, 10)) ? -1 : parseInt(part, 10)));
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y)
      return x > y;
  }

  return false;
}

/** Returns the shared secret, creating it atomically the first time (whichever of daemon and bridge comes first). */
export function ensureToken(): string {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    // fall through and create it
  }

  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  try {
    // 0600: on Linux/macOS the default umask would make the token readable by every local user.
    fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch {
    // another process created it between the read and the write
  }

  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

export interface DaemonInfo {
  ok: boolean;
  version?: string;
  sessions?: number;
  downstream?: number;
}

/**
 * Health of the running daemon, or null when nothing (or nothing compatible) answers on the daemon port.
 * Without a token the daemon only says `ok`, version and session counts need the token.
 */
export async function daemonInfo(token?: string): Promise<DaemonInfo | null> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(1500)
    });
    return response.ok ? ((await response.json()) as DaemonInfo) : null;
  } catch {
    return null;
  }
}

export async function daemonHealthy(): Promise<boolean> {
  return (await daemonInfo()) !== null;
}

export type ShutdownResult = 'stopped' | 'busy' | 'current' | 'unsupported' | 'unreachable';

/**
 * Asks a running daemon to exit so a newer one can take over. It refuses while clients are connected (`busy`)
 * unless `force` is set, and refuses when it is not older than the requesting version (`current`). Daemons from
 * before version handshakes have no such endpoint (`unsupported`), a daemon that vanished meanwhile is `unreachable`.
 */
export async function requestDaemonShutdown(token: string, force: boolean): Promise<ShutdownResult> {
  try {
    const query = `forVersion=${encodeURIComponent(GATEWAY_VERSION)}${force ? '&force=1' : ''}`;
    const response = await fetch(`${DAEMON_URL}/shutdown?${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000)
    });

    if (response.ok)
      return 'stopped';

    if (response.status === 409) {
      const body = (await response.json().catch(() => ({}))) as { reason?: string };
      return body.reason === 'current' ? 'current' : 'busy';
    }

    return 'unsupported';
  } catch {
    return 'unreachable';
  }
}
