import type { StatusInfo } from '../types';

interface Props {
  socketConnected: boolean;
  status?: StatusInfo;
  configError: string;
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 129600) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

export function StatusBar({ socketConnected, status, configError }: Props) {
  return (
    <div className="mb-6 space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-400 bg-dark-card border border-dark-border rounded-lg px-4 py-2">
        <span className="flex items-center gap-2" title="Live WebSocket connection to the backend">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          {socketConnected ? 'Live updates connected' : 'Live updates disconnected'}
        </span>
        {status && (
          <>
            <span className="break-all">
              <span className="font-semibold">Config:</span> {status.configPath}
            </span>
            <span>
              <span className="font-semibold">Tool catalog:</span>{' '}
              {status.toolCatalogExists ? `updated ${formatAge(status.toolCatalogGeneratedAt)}` : 'not generated yet (start the gateway once)'}
            </span>
          </>
        )}
      </div>
      {configError && (
        <div className="text-sm text-red-200 bg-red-950 border border-red-800 rounded-lg px-4 py-2">
          Configuration problem: {configError}
        </div>
      )}
    </div>
  );
}
