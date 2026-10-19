import { ListToolsResultSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from '../utils/logger';
import { CommonMCPConfig, ProjectPolicy } from '../types/config';
import { isServerAllowed, isToolAllowed } from '../utils/config';
import { writeToolCatalog, CatalogToolEntry } from '../utils/tool-catalog';
import { markFailed, readToolsCache, toolsCacheKey, toolsCacheTtlMs, wasRecentlyFailed, writeToolsCache } from '../utils/tools-cache';
import { ConnectionPool } from './connection-pool';

interface ToolMapping {
  serverId: string;
  toolName: string;
}

export interface ToolListDeps {
  pool: ConnectionPool;
  getConfig: () => CommonMCPConfig;
  getPolicy: () => ProjectPolicy;
}

export function createToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const combined = `${safeServer}__${safeTool}`;
  return combined.length > 64 ? combined.slice(0, 64) : combined;
}

/** The prefixed tool list one session exposes, built from the shared tools cache and the session's project policy. */
export class ToolList {
  tools: Tool[] = [];

  private nameMap: Map<string, ToolMapping> = new Map();
  private failedUntil = new Map<string, number>();
  private logger = getLogger();

  constructor(private deps: ToolListDeps) {}

  parseToolName(fullName: string): [string | null, string | null] {
    const mapping = this.nameMap.get(fullName);
    if (mapping) {
      return [mapping.serverId, mapping.toolName];
    }

    const separatorIndex = fullName.indexOf('__');
    if (separatorIndex === -1) {
      return [null, null];
    }

    const serverCandidate = fullName.slice(0, separatorIndex);
    const toolCandidate = fullName.slice(separatorIndex + 2);
    if (!serverCandidate || !toolCandidate) {
      return [null, null];
    }

    return [serverCandidate, toolCandidate];
  }

  async refresh(): Promise<void> {
    try {
      this.logger.info('Refreshing tool cache from downstream servers');

      const config = this.deps.getConfig();
      const policy = this.deps.getPolicy();
      const nameMap = new Map<string, ToolMapping>();
      const catalogTools: CatalogToolEntry[] = [];

      const perServer = Object.entries(config.downstreamServers)
        .filter(([serverId, serverConfig]) =>
          !serverConfig.disabled && isServerAllowed(policy, serverId, serverConfig.projectOnly === true)
        )
        .map(async ([serverId, serverConfig]) => {
          try {
            // Listing tools must not start every downstream server: a fresh cache entry answers it, and the
            // server is only spawned when it has no valid entry (first run, changed command, expired entry).
            const cacheKey = toolsCacheKey(serverConfig);
            let listedTools: any[] | null = readToolsCache(serverId, cacheKey, toolsCacheTtlMs(serverConfig));

            if (!listedTools) {
              if ((this.failedUntil.get(serverId) ?? 0) > Date.now() || wasRecentlyFailed(serverId, cacheKey))
                return [];

              const circuitBreakerConfig = {
                ...config.globalDefaults.circuitBreaker,
                failureThreshold: serverConfig.circuitBreakerThreshold || config.globalDefaults.circuitBreaker.failureThreshold
              };
              const connection = await this.deps.pool.createConnection(serverId, serverConfig, circuitBreakerConfig);

              const listed = await connection.client.request({ method: 'tools/list' }, ListToolsResultSchema);
              listedTools = listed.tools ?? [];
              writeToolsCache(serverId, cacheKey, listedTools);
            }

            const projectOnly = serverConfig.projectOnly === true;
            const serverTools = listedTools as Tool[];

            // The catalog lists EVERY tool the downstream server reports, including policy-disabled ones
            // (flagged via enabledByPolicy), otherwise a UI cannot show toggles for tools that are currently off.
            for (const tool of serverTools) {
              catalogTools.push({
                serverId,
                name: tool.name,
                prefixedName: createToolName(serverId, tool.name),
                description: tool.description ?? '',
                enabledByPolicy: isToolAllowed(policy, serverId, tool.name, projectOnly)
              });
            }

            return serverTools
              .filter((tool) => isToolAllowed(policy, serverId, tool.name, projectOnly))
              .map((tool) => {
                const prefixedName = createToolName(serverId, tool.name);
                nameMap.set(prefixedName, { serverId, toolName: tool.name });

                const baseDescription = tool.description || tool.name;
                return {
                  ...tool,
                  name: prefixedName,
                  description: `[Server: ${serverId}] ${baseDescription}. Use this tool by calling ${prefixedName}.`
                };
              });
          } catch (error) {
            // Do not respawn a server that just failed on every tools/list request.
            this.failedUntil.set(serverId, Date.now() + 5 * 60 * 1000);
            markFailed(serverId, toolsCacheKey(serverConfig));
            this.logger.error({
              message: 'Failed to list tools from downstream',
              serverId,
              error: (error as Error).message
            });
            return [];
          }
        });

      const results = await Promise.all(perServer);
      // Swap in one step so a concurrent refresh never leaves a half filled map behind.
      this.nameMap = nameMap;
      this.tools = results.flat();

      writeToolCatalog(config, catalogTools);

      this.logger.info({ message: 'Tools cache refreshed', totalTools: this.tools.length });
    } catch (error) {
      this.logger.error({
        message: 'Error refreshing tool cache',
        error: (error as Error).message
      });
      throw error;
    }
  }
}
