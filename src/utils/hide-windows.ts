/**
 * The MCP SDK starts downstream servers with cross-spawn and only hides the console window inside Electron.
 * A gateway daemon has no console of its own, so on Windows every downstream `npx`/`cmd` would open a visible, empty
 * console window. Injecting windowsHide into every child_process.spawn call keeps them invisible.
 * The real module object is patched (require, not an ES import), because cross-spawn calls spawn through it.
 */
if (process.platform === 'win32') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function patchedSpawn(command: string, argsOrOptions?: any, maybeOptions?: any) {
    if (Array.isArray(argsOrOptions))
      return originalSpawn.call(this, command, argsOrOptions, { ...(maybeOptions ?? {}), windowsHide: true });

    return originalSpawn.call(this, command, { ...(argsOrOptions ?? {}), windowsHide: true });
  };
}

export {};
