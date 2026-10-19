import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './api';
import type { MCPConfig, MCPServer, ToolCatalogResponse } from './types';
import { ServerForm } from './components/ServerForm';
import { ServerCard } from './components/ServerCard';
import { StatusBar } from './components/StatusBar';
import { ToolCatalogPanel } from './components/ToolCatalogPanel';
import { GatePanel } from './components/GatePanel';
import { SettingsPanel } from './components/SettingsPanel';

type Tab = 'servers' | 'tools' | 'gate' | 'settings';

const NEW_SERVER: MCPServer = { command: '', args: [], env: {}, disabled: false, timeout: 30000, retryAttempts: 3, circuitBreakerThreshold: 5, fallbackServers: [] };

function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('servers');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [configError, setConfigError] = useState('');
  const [actionError, setActionError] = useState('');

  const configQuery = useQuery<MCPConfig>({ queryKey: ['mcpConfig'], queryFn: api.getConfig });
  const statusQuery = useQuery({ queryKey: ['status'], queryFn: api.getStatus, refetchInterval: 30000 });
  const catalogQuery = useQuery<ToolCatalogResponse>({ queryKey: ['toolCatalog'], queryFn: api.getToolCatalog });

  useEffect(() => {
    const socket = io();
    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('configUpdate', (config: MCPConfig) => {
      setConfigError('');
      queryClient.setQueryData(['mcpConfig'], config);
    });
    socket.on('configError', (message: string) => setConfigError(message));
    socket.on('catalogUpdate', () => {
      queryClient.invalidateQueries({ queryKey: ['toolCatalog'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  const onMutationError = (error: Error) => setActionError(error.message);
  const onMutationDone = () => {
    setActionError('');
    queryClient.invalidateQueries({ queryKey: ['mcpConfig'] });
  };

  const toggleMutation = useMutation({ mutationFn: api.toggleServer, onSuccess: onMutationDone, onError: onMutationError });
  const deleteMutation = useMutation({ mutationFn: api.deleteServer, onSuccess: onMutationDone, onError: onMutationError });
  const saveMutation = useMutation({
    mutationFn: ({ name, server }: { name: string; server: MCPServer }) => api.saveServer(name, server),
    onSuccess: () => {
      onMutationDone();
      setEditing(null);
      setAdding(false);
    }
  });

  const gatewayConfig = configQuery.data?.['common-mcp'];
  const servers = gatewayConfig?.downstreamServers ?? {};
  const serverNames = Object.keys(servers);

  const toolCounts = useMemo(() => {
    const counts: Record<string, { enabled: number; total: number }> = {};
    for (const tool of catalogQuery.data?.catalog?.tools ?? []) {
      const entry = (counts[tool.serverId] ??= { enabled: 0, total: 0 });
      entry.total += 1;
      if (tool.enabledByPolicy) entry.enabled += 1;
    }
    return counts;
  }, [catalogQuery.data]);

  const startAdd = () => {
    saveMutation.reset();
    setEditing(null);
    setAdding((open) => !open);
  };

  const startEdit = (serverId: string) => {
    saveMutation.reset();
    setAdding(false);
    setEditing((current) => (current === serverId ? null : serverId));
  };

  if (configQuery.isLoading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="text-white text-xl">Loading MCP configuration...</div>
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="min-h-screen bg-dark-bg text-white flex items-center justify-center p-8">
        <div className="max-w-xl text-center space-y-4">
          <h1 className="text-3xl font-bold">Cannot load the configuration</h1>
          <p className="text-red-300">{(configQuery.error as Error).message}</p>
          <button onClick={() => configQuery.refetch()} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-semibold">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'servers', label: `Servers (${serverNames.length})` },
    { id: 'tools', label: `Tool catalog${catalogQuery.data?.catalog ? ` (${catalogQuery.data.catalog.tools.length})` : ''}` },
    { id: 'gate', label: `Gate${gatewayConfig?.gate ? ` (${Object.keys(gatewayConfig.gate.knownProjects ?? {}).length} projects)` : ''}` },
    { id: 'settings', label: 'Settings' }
  ];

  return (
    <div className="min-h-screen bg-dark-bg text-white p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Common MCP Gateway Manager</h1>
          {tab === 'servers' && (
            <button onClick={startAdd} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-semibold">
              {adding ? 'Close form' : '+ Add New MCP'}
            </button>
          )}
        </div>

        <StatusBar socketConnected={socketConnected} status={statusQuery.data} configError={configError} />

        <div className="flex flex-wrap gap-2 mb-6 border-b border-dark-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 -mb-px border-b-2 font-semibold ${
                tab === t.id ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {actionError && (
          <div className="mb-4 text-sm text-red-200 bg-red-950 border border-red-800 rounded-lg px-4 py-2 flex justify-between gap-4">
            <span>{actionError}</span>
            <button onClick={() => setActionError('')} className="text-red-300 hover:text-white">Dismiss</button>
          </div>
        )}

        {tab === 'servers' && (
          <>
            {adding && (
              <div className="bg-dark-card p-6 rounded-lg border border-dark-border mb-6">
                <h2 className="text-2xl font-bold mb-4">Add New MCP Server</h2>
                <ServerForm
                  initialName=""
                  initial={NEW_SERVER}
                  nameEditable
                  existingNames={serverNames}
                  otherServerNames={serverNames}
                  saving={saveMutation.isPending}
                  saveError={saveMutation.error?.message ?? ''}
                  onSubmit={(name, server) => saveMutation.mutate({ name, server })}
                  onCancel={() => setAdding(false)}
                />
              </div>
            )}

            <div className="grid gap-4">
              {serverNames.map((serverId) => (
                <ServerCard
                  key={serverId}
                  serverId={serverId}
                  server={servers[serverId]}
                  toolCounts={toolCounts[serverId]}
                  busy={toggleMutation.isPending || deleteMutation.isPending}
                  editing={editing === serverId}
                  onToggle={() => toggleMutation.mutate(serverId)}
                  onEdit={() => startEdit(serverId)}
                  onDelete={() => {
                    if (confirm(`Delete ${serverId}?`)) deleteMutation.mutate(serverId);
                  }}
                >
                  <ServerForm
                    initialName={serverId}
                    initial={servers[serverId]}
                    nameEditable={false}
                    existingNames={serverNames}
                    otherServerNames={serverNames.filter((n) => n !== serverId)}
                    saving={saveMutation.isPending}
                    saveError={saveMutation.error?.message ?? ''}
                    onSubmit={(name, server) => saveMutation.mutate({ name, server })}
                    onCancel={() => setEditing(null)}
                  />
                </ServerCard>
              ))}
            </div>

            {serverNames.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-xl mb-4">No MCP servers configured</p>
                <p>Click "Add New MCP" to get started</p>
              </div>
            )}
          </>
        )}

        {tab === 'tools' && <ToolCatalogPanel data={catalogQuery.data} loading={catalogQuery.isLoading} />}
        {tab === 'gate' && <GatePanel gate={gatewayConfig?.gate} />}
        {tab === 'settings' && (
          <SettingsPanel version={gatewayConfig?.version} globalDefaults={gatewayConfig?.globalDefaults} logging={gatewayConfig?.logging} />
        )}
      </div>
    </div>
  );
}

export default App;
