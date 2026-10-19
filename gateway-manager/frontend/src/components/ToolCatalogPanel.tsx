import { useMemo, useState } from 'react';
import type { ToolCatalogResponse } from '../types';

interface Props {
  data?: ToolCatalogResponse;
  loading: boolean;
}

export function ToolCatalogPanel({ data, loading }: Props) {
  const [query, setQuery] = useState('');
  const catalog = data?.catalog;

  const groups = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    const matches = catalog.tools.filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.serverId.toLowerCase().includes(q)
    );
    const byServer = new Map<string, typeof matches>();
    for (const tool of matches) {
      byServer.set(tool.serverId, [...(byServer.get(tool.serverId) ?? []), tool]);
    }
    return [...byServer.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog, query]);

  if (loading) return <p className="text-gray-400">Loading tool catalog...</p>;

  if (!data?.exists || !catalog) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-xl mb-2">No tool catalog yet</p>
        <p>The gateway writes it after it lists the tools of its downstream servers.</p>
        <p className="text-xs mt-2 break-all">Expected at: {data?.path ?? '~/.common-mcp/tool-catalog.json'}</p>
      </div>
    );
  }

  const total = catalog.tools.length;
  const enabled = catalog.tools.filter((t) => t.enabledByPolicy).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <input
          className="flex-1 bg-dark-card border border-dark-border rounded px-4 py-2 text-white"
          placeholder="Filter by server, tool name or description"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-sm text-gray-400">
          {enabled}/{total} tools enabled by the active project policy
        </span>
      </div>

      {groups.length === 0 && <p className="text-gray-400">No tool matches the filter.</p>}

      <div className="space-y-4">
        {groups.map(([serverId, tools]) => (
          <details key={serverId} className="bg-dark-card border border-dark-border rounded-lg" open={!!query}>
            <summary className="cursor-pointer px-4 py-3 font-semibold flex items-center justify-between">
              <span>{serverId}</span>
              <span className="text-sm font-normal text-gray-400">
                {tools.filter((t) => t.enabledByPolicy).length}/{tools.length} enabled
              </span>
            </summary>
            <ul className="divide-y divide-dark-border">
              {tools.map((tool) => (
                <li key={tool.prefixedName} className="px-4 py-2 flex items-start gap-3">
                  <span
                    className={`mt-1 shrink-0 px-2 py-0.5 rounded text-xs font-semibold ${
                      tool.enabledByPolicy ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'
                    }`}
                  >
                    {tool.enabledByPolicy ? 'ON' : 'OFF'}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-sm break-all">{tool.name}</p>
                    {tool.description && <p className="text-xs text-gray-400">{tool.description.slice(0, 220)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
