import type { GateConfig } from '../types';

interface Props {
  gate?: GateConfig;
}

export function GatePanel({ gate }: Props) {
  const projects = Object.entries(gate?.knownProjects ?? {});
  const unknown = gate?.unknownProjectDefaults;
  const serverPolicies = Object.entries(unknown?.servers ?? {});

  if (!gate) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-xl mb-2">No gate section in the configuration</p>
        <p>Every project sees all enabled servers. Add a gate section to the configuration to restrict servers per project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400">
        Read-only view. Projects and per-project tool policies live in the configuration and in the project policy files; this page never
        modifies the gate section, and saving a server here preserves it.
      </p>

      <section className="bg-dark-card border border-dark-border rounded-lg p-4">
        <h3 className="text-lg font-bold mb-3">Known projects ({projects.length})</h3>
        {projects.length === 0 ? (
          <p className="text-gray-400 text-sm">No project registered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-dark-border">
                  <th className="py-2 pr-4">Project ID</th>
                  <th className="py-2">Path</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(([id, path]) => (
                  <tr key={id} className="border-b border-dark-border last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs break-all">{id}</td>
                    <td className="py-2 break-all">{path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-dark-card border border-dark-border rounded-lg p-4">
        <h3 className="text-lg font-bold mb-3">Unknown project defaults</h3>
        <p className="text-sm mb-3">
          Default:{' '}
          <span className={unknown?.defaultAllow === false ? 'text-red-300 font-semibold' : 'text-green-300 font-semibold'}>
            {unknown?.defaultAllow === false ? 'deny' : 'allow'}
          </span>{' '}
          for servers and tools that have no explicit rule.
        </p>
        {serverPolicies.length > 0 && (
          <ul className="space-y-2 text-sm">
            {serverPolicies.map(([serverId, policy]) => {
              const tools = Object.entries(policy.tools ?? {});
              const denied = tools.filter(([, allowed]) => !allowed).length;
              return (
                <li key={serverId} className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{serverId}</span>
                  <span className="text-gray-400">
                    server {policy.enabled === false ? 'off' : policy.enabled === true ? 'on' : 'default'}
                  </span>
                  {tools.length > 0 && (
                    <span className="text-gray-400">
                      {tools.length - denied} tools allowed, {denied} denied
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {(unknown?.alwaysVisibleTools ?? []).length > 0 && (
          <p className="text-sm mt-3">
            <span className="font-semibold">Always visible tools:</span> {unknown!.alwaysVisibleTools!.join(', ')}
          </p>
        )}
      </section>
    </div>
  );
}
