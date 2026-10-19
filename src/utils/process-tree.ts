import { spawnSync } from 'child_process';

/**
 * Parses `ps -eo pid=,ppid=` output and returns every descendant of `rootPid`, deepest first, so children can be
 * killed before their parents. Cycles and malformed lines are ignored.
 */
export function descendantsOf(rootPid: number, psOutput: string): number[] {
  const children = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match)
      continue;

    const parent = Number(match[2]);
    children.set(parent, [...(children.get(parent) ?? []), Number(match[1])]);
  }

  const ordered: number[] = [];
  const seen = new Set<number>([rootPid]);
  const visit = (pid: number): void => {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child))
        continue;

      seen.add(child);
      visit(child);
      ordered.push(child);
    }
  };
  visit(rootPid);

  return ordered;
}

/**
 * Kills a process and everything it started. Windows uses `taskkill /T`. On Linux and macOS the launcher (npx, uvx,
 * a shell wrapper) is only the parent of the real server, so killing just its pid would leave the server running:
 * the descendants are collected from `ps` first and killed together with the root.
 */
export function killProcessTree(pid: number | null | undefined): void {
  // 0 and 1 are never a downstream server, and the gateway must not kill itself through a stale or wrong pid.
  if (!pid || pid <= 1 || pid === process.pid)
    return;

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }

    const listing = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    const victims = listing.status === 0 ? descendantsOf(pid, listing.stdout) : [];
    for (const victim of [...victims, pid]) {
      try {
        process.kill(victim, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  } catch {
    // process already gone
  }
}
