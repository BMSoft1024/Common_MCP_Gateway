import type { ReactNode } from 'react';
import type { MCPServer } from '../types';

interface Props {
  serverId: string;
  server: MCPServer;
  toolCounts?: { enabled: number; total: number };
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  editing: boolean;
  children?: ReactNode;
}

export function ServerCard({ serverId, server, toolCounts, busy, onToggle, onEdit, onDelete, editing, children }: Props) {
  const retries = server.retryAttempts ?? server.retries;
  const envKeys = Object.keys(server.env ?? {});

  return (
    <div className="bg-dark-card p-6 rounded-lg border border-dark-border hover:border-dark-hover transition-colors">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-3 mb-2">
            <h3 className="text-xl font-bold">{serverId}</h3>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                server.disabled ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'
              }`}
            >
              {server.disabled ? 'DISABLED' : 'ENABLED'}
            </span>
            {toolCounts && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-dark-bg border border-dark-border text-gray-300">
                {toolCounts.enabled}/{toolCounts.total} tools
              </span>
            )}
          </div>

          <div className="text-sm text-gray-400 space-y-1 break-all">
            <p><span className="font-semibold">Command:</span> {server.command}</p>
            {server.args && server.args.length > 0 && (
              <p><span className="font-semibold">Args:</span> {server.args.join(' ')}</p>
            )}
            {envKeys.length > 0 && <p><span className="font-semibold">Env:</span> {envKeys.join(', ')}</p>}
            <p>
              <span className="font-semibold">Limits:</span>{' '}
              timeout {Math.round((server.timeout ?? 30000) / 1000)}s
              {retries !== undefined && `, ${retries} retry attempts`}
              {server.circuitBreakerThreshold !== undefined && `, breaker at ${server.circuitBreakerThreshold} failures`}
            </p>
            {server.fallbackServers && server.fallbackServers.length > 0 && (
              <p><span className="font-semibold">Fallback:</span> {server.fallbackServers.join(', ')}</p>
            )}
          </div>
        </div>

        <div className="flex space-x-2 shrink-0">
          <button
            onClick={onToggle}
            disabled={busy}
            className={`px-4 py-2 rounded-lg font-semibold disabled:opacity-50 ${
              server.disabled ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'
            }`}
          >
            {server.disabled ? 'Enable' : 'Disable'}
          </button>
          <button onClick={onEdit} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-semibold">
            {editing ? 'Close' : 'Edit'}
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 p-6 bg-dark-bg rounded-lg border-2 border-blue-500">
          <h3 className="text-xl font-bold mb-4">Edit: {serverId}</h3>
          {children}
        </div>
      )}
    </div>
  );
}
