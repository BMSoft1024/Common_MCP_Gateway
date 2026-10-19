import type { MCPConfig, MCPServer, StatusInfo, ToolCatalogResponse } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Cannot reach the Gateway Manager backend (http://127.0.0.1:1525). Is it running?');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body, handled below
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message || `Request failed with HTTP ${res.status}`);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

export const api = {
  getConfig: () => request<MCPConfig>('/api/config'),
  getStatus: () => request<StatusInfo>('/api/status'),
  getToolCatalog: () => request<ToolCatalogResponse>('/api/tool-catalog'),
  saveServer: (name: string, server: MCPServer) =>
    request<{ success: boolean }>(`/api/config/server/${encodeURIComponent(name)}`, json('PUT', server)),
  deleteServer: (name: string) =>
    request<{ success: boolean }>(`/api/config/server/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  toggleServer: (name: string) =>
    request<{ success: boolean; disabled: boolean }>(`/api/config/server/${encodeURIComponent(name)}/toggle`, {
      method: 'PATCH'
    })
};
