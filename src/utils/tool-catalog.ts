import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { CommonMCPConfig } from '../types/config';
import { getLogger } from './logger';

export interface CatalogServerEntry {
  serverId: string;
  command: string;
  args: string[];
  disabledByConfig: boolean;
  /** "Csak projektben" mode — not enabled anywhere unless a policy explicitly opts in. */
  projectOnly?: boolean;
}

export interface CatalogToolEntry {
  serverId: string;
  name: string;
  prefixedName: string;
  description: string;
  enabledByPolicy: boolean;
}

export interface ToolCatalog {
  generatedAt: string;
  servers: CatalogServerEntry[];
  tools: CatalogToolEntry[];
}

export function getToolCatalogPath(): string {
  return resolve(homedir(), '.common-mcp', 'tool-catalog.json');
}

export function writeToolCatalog(
  config: CommonMCPConfig,
  tools: CatalogToolEntry[]
): void {
  const logger = getLogger();
  const catalogPath = getToolCatalogPath();

  try {
    const catalogDir = dirname(catalogPath);
    if (!existsSync(catalogDir)) {
      mkdirSync(catalogDir, { recursive: true });
    }

    const servers: CatalogServerEntry[] = Object.entries(config.downstreamServers).map(
      ([serverId, serverConfig]) => ({
        serverId,
        command: serverConfig.command,
        args: serverConfig.args,
        disabledByConfig: !!serverConfig.disabled,
        projectOnly: !!serverConfig.projectOnly
      })
    );

    // Merge with the previous catalog: servers that produced no tools in this refresh
    // (transient downstream failure / timeout) keep their last-known entries instead of
    // disappearing — a partially-failed refresh must not shrink the catalog.
    let previousTools: CatalogToolEntry[] = [];
    try {
      const previous = JSON.parse(readFileSync(catalogPath, 'utf-8')) as ToolCatalog;
      previousTools = previous.tools ?? [];
    } catch {
      // no or unreadable previous catalog — first run
    }
    const refreshedServerIds = new Set(tools.map((t) => t.serverId));
    const mergedTools = [
      ...tools,
      ...previousTools.filter((t) => !refreshedServerIds.has(t.serverId))
    ];

    const catalog: ToolCatalog = {
      generatedAt: new Date().toISOString(),
      servers,
      tools: mergedTools
    };

    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
    logger.debug(`Tool catalog written to ${catalogPath} (${mergedTools.length} tools)`);
  } catch (error) {
    logger.warn({
      message: 'Failed to write tool catalog',
      path: catalogPath,
      error: (error as Error).message
    });
  }
}
