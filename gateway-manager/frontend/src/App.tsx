import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

interface MCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  disabledTools?: string[];
  timeout?: number;
  retries?: number;
  circuitBreakerThreshold?: number;
  fallbackServers?: string[];
}

interface MCPConfig {
  'common-mcp': {
    version?: string;
    globalDefaults?: {
      timeout?: number;
      retryAttempts?: number;
      retryDelay?: number;
      circuitBreaker?: {
        enabled?: boolean;
        failureThreshold?: number;
        resetTimeout?: number;
      };
    };
    downstreamServers: Record<string, MCPServer>;
    logging?: {
      level?: string;
      format?: string;
      file?: string;
      maxSize?: string;
      maxFiles?: number;
    };
  };
}

let socket: Socket | null = null;

function App() {
  const queryClient = useQueryClient();
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<{ name: string; server: MCPServer }>({
    name: '',
    server: { 
      command: '', 
      args: [], 
      env: {}, 
      disabled: false,
      timeout: 30000,
      retries: 3,
      circuitBreakerThreshold: 5,
      fallbackServers: []
    }
  });
  
  // Raw JSON string for environment variables
  const [envJsonString, setEnvJsonString] = useState<string>('{}');
  const [envJsonError, setEnvJsonError] = useState<string>('');

  const { data: config, isLoading } = useQuery<MCPConfig>({
    queryKey: ['mcpConfig'],
    queryFn: async () => {
      const res = await fetch('/api/config');
      return res.json();
    }
  });

  useEffect(() => {
    if (!socket) {
      socket = io('http://localhost:1525');
      
      socket.on('connect', () => {
        console.log('[WebSocket] Connected to backend');
      });

      socket.on('configUpdate', (newConfig: MCPConfig) => {
        console.log('[WebSocket] Config updated');
        queryClient.setQueryData(['mcpConfig'], newConfig);
      });

      socket.on('disconnect', () => {
        console.log('[WebSocket] Disconnected');
      });
    }

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, [queryClient]);

  const toggleMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const res = await fetch(`/api/config/server/${serverId}/toggle`, {
        method: 'PATCH'
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpConfig'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const res = await fetch(`/api/config/server/${serverId}`, {
        method: 'DELETE'
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpConfig'] });
    }
  });

  const saveMutation = useMutation({
    mutationFn: async ({ name, server }: { name: string; server: MCPServer }) => {
      const res = await fetch(`/api/config/server/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(server)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpConfig'] });
      handleCancel();
    }
  });

  const handleEdit = (serverId: string, server: MCPServer) => {
    console.log('handleEdit called with:', { serverId, currentEditingServer: editingServer });
    
    if (editingServer === serverId) {
      console.log('Closing edit for:', serverId);
      setEditingServer(null);
    } else {
      console.log('Opening edit for:', serverId);
      // Get the latest server data from the current config
      const currentConfig = queryClient.getQueryData(['mcpConfig']) as any;
      const latestServerData = currentConfig?.['common-mcp']?.downstreamServers?.[serverId] || server;
      
      console.log('Using latest server data:', latestServerData);
      
      // Use functional update to ensure proper state sequencing
      setEditingServer(serverId);
      setFormData({ name: serverId, server: { ...latestServerData } });
      
      // Initialize envJsonString with current env values
      setEnvJsonString(JSON.stringify(latestServerData.env || {}, null, 2));
      setEnvJsonError('');
      
      // Debug: check state after update
      setTimeout(() => {
        console.log('State after update - editingServer should be:', serverId);
      }, 100);
    }
  };

  const handleSave = () => {
    if (formData.name && formData.server.command) {
      console.log('=== SAVE DEBUG ===');
      console.log('formData.server.env:', formData.server.env);
      console.log('Full formData:', formData);
      
      saveMutation.mutate(formData);
    }
  };

  const handleCancel = () => {
    setEditingServer(null);
    setShowAddForm(false);
    setFormData({ 
      name: '', 
      server: { 
        command: '', 
        args: [], 
        env: {}, 
        disabled: false,
        timeout: 30000,
        retries: 3,
        circuitBreakerThreshold: 5,
        fallbackServers: []
      } 
    });
    setEnvJsonString('{}');
    setEnvJsonError('');
  };

  const handleAddNew = () => {
    setShowAddForm(!showAddForm);
    setEditingServer(null);
    setFormData({ 
      name: '', 
      server: { 
        command: '', 
        args: [], 
        env: {}, 
        disabled: false,
        timeout: 30000,
        retries: 3,
        circuitBreakerThreshold: 5,
        fallbackServers: []
      } 
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="text-white text-xl">Loading MCP Configuration...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-bg text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">Common MCP Gateway Manager</h1>
          <button
            onClick={handleAddNew}
            className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-semibold"
          >
            + Add New MCP
          </button>
        </div>

        {showAddForm && (
          <div className="bg-dark-card p-6 rounded-lg border border-dark-border mb-6">
            <h2 className="text-2xl font-bold mb-4">Add New MCP Server</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Server Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={!!editingServer}
                  className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white disabled:opacity-50"
                  placeholder="e.g., my-mcp-server"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Command</label>
                <input
                  type="text"
                  value={formData.server.command}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    server: { ...formData.server, command: e.target.value }
                  })}
                  className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white"
                  placeholder="e.g., npx"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Arguments (comma-separated)</label>
                <input
                  type="text"
                  value={formData.server.args?.join(', ') || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    server: { 
                      ...formData.server, 
                      args: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    }
                  })}
                  className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white"
                  placeholder="e.g., -y, @scope/package-name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Environment Variables (JSON)</label>
                <textarea
                  value={envJsonString}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEnvJsonString(value);
                    
                    // Validate JSON without blocking state update
                    try {
                      const env = JSON.parse(value);
                      setFormData({ 
                        ...formData, 
                        server: { ...formData.server, env }
                      });
                      setEnvJsonError('');
                    } catch (err) {
                      setEnvJsonError('Invalid JSON format');
                    }
                  }}
                  className={`w-full bg-dark-bg border rounded px-4 py-2 text-white font-mono text-sm h-32 ${
                    envJsonError ? 'border-red-500' : 'border-dark-border'
                  }`}
                  placeholder='{"API_KEY": "your-key"}'
                />
                {envJsonError && (
                  <p className="text-red-500 text-xs mt-1">{envJsonError}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Timeout (ms)</label>
                  <input
                    type="number"
                    value={formData.server.timeout || 30000}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      server: { ...formData.server, timeout: parseInt(e.target.value) || 30000 }
                    })}
                    className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white"
                    placeholder="30000"
                    min="1000"
                    max="300000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Retries</label>
                  <input
                    type="number"
                    value={formData.server.retries || 3}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      server: { ...formData.server, retries: parseInt(e.target.value) || 3 }
                    })}
                    className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white"
                    placeholder="3"
                    min="0"
                    max="10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Circuit Breaker Threshold</label>
                <input
                  type="number"
                  value={formData.server.circuitBreakerThreshold || 5}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    server: { ...formData.server, circuitBreakerThreshold: parseInt(e.target.value) || 5 }
                  })}
                  className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white"
                  placeholder="5"
                  min="1"
                  max="100"
                />
                <p className="text-xs text-gray-500 mt-1">Number of failures before opening circuit</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Fallback Servers (comma-separated)</label>
                <input
                  type="text"
                  value={formData.server.fallbackServers?.join(', ') || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    server: { 
                      ...formData.server, 
                      fallbackServers: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    }
                  })}
                  className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white"
                  placeholder="e.g., backup-server-1, backup-server-2"
                />
                <p className="text-xs text-gray-500 mt-1">Alternative servers to use if primary fails</p>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.server.disabled || false}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    server: { ...formData.server, disabled: e.target.checked }
                  })}
                  className="w-5 h-5"
                />
                <label className="text-sm font-medium">Disabled</label>
              </div>

              <div className="flex space-x-4 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-semibold disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditingServer(null);
                    setShowAddForm(false);
                  }}
                  className="bg-gray-600 hover:bg-gray-700 px-6 py-2 rounded-lg font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4">
          {config?.['common-mcp']?.downstreamServers && Object.entries(config['common-mcp'].downstreamServers).map(([serverId, server]) => (
            <div
              key={serverId}
              className="bg-dark-card p-6 rounded-lg border border-dark-border hover:border-dark-hover transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-4 mb-2">
                    <h3 className="text-xl font-bold">{serverId}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      server.disabled 
                        ? 'bg-red-900 text-red-200' 
                        : 'bg-green-900 text-green-200'
                    }`}>
                      {server.disabled ? 'DISABLED' : 'ENABLED'}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-400 space-y-1">
                    <p><span className="font-semibold">Command:</span> {server.command}</p>
                    {server.args && server.args.length > 0 && (
                      <p><span className="font-semibold">Args:</span> {server.args.join(' ')}</p>
                    )}
                    {server.env && Object.keys(server.env).length > 0 && (
                      <p><span className="font-semibold">Env:</span> {Object.keys(server.env).join(', ')}</p>
                    )}
                  </div>
                </div>

                <div className="flex space-x-2">
                  <button
                    onClick={() => toggleMutation.mutate(serverId)}
                    disabled={toggleMutation.isPending}
                    className={`px-4 py-2 rounded-lg font-semibold ${
                      server.disabled
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-yellow-600 hover:bg-yellow-700'
                    } disabled:opacity-50`}
                  >
                    {server.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    onClick={() => handleEdit(serverId, server)}
                    className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-semibold"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${serverId}?`)) {
                        deleteMutation.mutate(serverId);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              {/* Inline Edit Form */}
              {editingServer === serverId && (
                <div className="mt-4 p-6 bg-dark-bg rounded-lg border-2 border-blue-500">
                  <h3 className="text-xl font-bold mb-4">Edit: {serverId}</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Command</label>
                      <input
                        type="text"
                        value={formData.server.command}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          server: { ...formData.server, command: e.target.value }
                        })}
                        className="w-full bg-dark-card border border-dark-border rounded px-4 py-2 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Arguments (comma-separated)</label>
                      <input
                        type="text"
                        value={formData.server.args?.join(', ') || ''}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          server: { ...formData.server, args: e.target.value.split(',').map(s => s.trim()) }
                        })}
                        className="w-full bg-dark-card border border-dark-border rounded px-4 py-2 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Environment Variables (JSON)</label>
                      <textarea
                        value={envJsonString}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEnvJsonString(value);
                          
                          // Validate JSON without blocking state update
                          try {
                            const env = JSON.parse(value);
                            setFormData({ 
                              ...formData, 
                              server: { ...formData.server, env }
                            });
                            setEnvJsonError('');
                          } catch (err) {
                            setEnvJsonError('Invalid JSON format');
                          }
                        }}
                        className={`w-full bg-dark-card border rounded px-4 py-2 text-white font-mono text-sm h-32 ${
                          envJsonError ? 'border-red-500' : 'border-dark-border'
                        }`}
                        placeholder='{"API_KEY": "your-key"}'
                      />
                      {envJsonError ? (
                        <p className="text-red-500 text-xs mt-1">{envJsonError}</p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-1">Enter environment variables as JSON object</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Timeout (ms)</label>
                      <input
                        type="number"
                        value={formData.server.timeout || 30000}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          server: { ...formData.server, timeout: parseInt(e.target.value) }
                        })}
                        min="1000"
                        max="300000"
                        className="w-full bg-dark-card border border-dark-border rounded px-4 py-2 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Retries</label>
                      <input
                        type="number"
                        value={formData.server.retries || 3}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          server: { ...formData.server, retries: parseInt(e.target.value) }
                        })}
                        min="0"
                        max="10"
                        className="w-full bg-dark-card border border-dark-border rounded px-4 py-2 text-white"
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={formData.server.disabled || false}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          server: { ...formData.server, disabled: e.target.checked }
                        })}
                        className="w-5 h-5"
                      />
                      <label className="text-sm font-medium">Disabled</label>
                    </div>

                    <div className="flex space-x-4 pt-4">
                      <button
                        onClick={handleSave}
                        disabled={saveMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-semibold disabled:opacity-50"
                      >
                        {saveMutation.isPending ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={handleCancel}
                        className="bg-gray-600 hover:bg-gray-700 px-6 py-2 rounded-lg font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {(!config?.['common-mcp']?.downstreamServers || Object.keys(config['common-mcp'].downstreamServers).length === 0) && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-xl mb-4">No MCP servers configured</p>
            <p>Click "Add New MCP" to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
