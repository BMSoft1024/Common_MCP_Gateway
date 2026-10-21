import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from '../utils/logger';
import { CommonMCPConfig } from '../types/config';
import { ConnectionPool } from './connection-pool';
import { TimeoutWatchdog, generateRequestId } from '../middleware/timeout';
import {
  ProjectContext,
  loadConfig,
  resolveProjectContext,
  buildProjectContext,
  findKnownProject,
  loadProjectPolicy,
  isServerAllowed
} from '../utils/config';
import { PolicyWatcher } from '../utils/policy-watcher';
import { ToolExecutor } from './tool-executor';
import { ToolList } from './tool-list';
import { resolve as resolvePath } from 'path';
import { homedir } from 'os';

const SET_CONTEXT_TOOL_NAME = 'gate__set_project_context';

const SET_CONTEXT_TOOL: Tool = {
  name: SET_CONTEXT_TOOL_NAME,
  description:
    'Declare which registered project this session is working on. Provide the absolute ' +
    'project root path. The gateway loads that project\'s policy and reloads the allowed ' +
    'tool list. Always callable, even before a project context is declared.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Absolute path to the project root directory'
      }
    },
    required: ['projectPath']
  }
};

export class CommonMCPGateway {
  private server: Server;
  private connectionPool: ConnectionPool;
  private timeoutWatchdog: TimeoutWatchdog;
  private logger = getLogger();
  private config: CommonMCPConfig;
  private toolList: ToolList;
  private executor: ToolExecutor;
  private context: ProjectContext;
  private sessionIdentified = false;
  private policyWatcher: PolicyWatcher;
  private configPath: string;

  private sharedPool: boolean;
  private origin?: { cwd?: string; projectPath?: string };

  /**
   * In daemon mode many sessions (one per client) run as separate gateway instances on ONE shared
   * ConnectionPool, so every downstream server exists once no matter how many clients are connected.
   * `origin` carries the connecting client's cwd and project path, which the daemon cannot see itself.
   */
  constructor(config: CommonMCPConfig, configPath?: string, options?: { pool?: ConnectionPool; cwd?: string; projectPath?: string }) {
    this.config = config;
    this.sharedPool = options?.pool !== undefined;
    this.origin = { cwd: options?.cwd, projectPath: options?.projectPath };
    this.connectionPool = options?.pool ?? new ConnectionPool();
    this.timeoutWatchdog = new TimeoutWatchdog();
    this.context = resolveProjectContext(config, { cwd: options?.cwd, projectPath: options?.projectPath });
    this.sessionIdentified = this.context.matched === 'project';
    this.configPath =
      configPath ||
      process.env.COMMON_MCP_CONFIG ||
      resolvePath(homedir(), '.common-mcp', 'config.json');

    const deps = {
      pool: this.connectionPool,
      getConfig: () => this.config,
      getPolicy: () => this.context.policy
    };
    this.toolList = new ToolList(deps);
    this.executor = new ToolExecutor({ ...deps, watchdog: this.timeoutWatchdog });

    if (!this.sharedPool) {
      this.connectionPool.setServerEnabledFilter((serverId) =>
        isServerAllowed(this.context.policy, serverId,
          this.config.downstreamServers[serverId]?.projectOnly === true)
      );
    }
    this.policyWatcher = new PolicyWatcher(() => this.onPolicyFileChanged());

    this.server = new Server(
      {
        name: 'common-mcp-gateway',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {
            listChanged: true
          }
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.info('Handling list_tools request');

      await this.refreshToolCache();

      if (this.requiresContextDeclaration()) {
        const alwaysVisible = this.config.gate?.unknownProjectDefaults?.alwaysVisibleTools ?? [];
        const extras = this.toolList.tools.filter((t) => alwaysVisible.includes(t.name));
        return { tools: [SET_CONTEXT_TOOL, ...extras] };
      }

      return { tools: [SET_CONTEXT_TOOL, ...this.toolList.tools] };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const requestId = generateRequestId();
      const { name, arguments: args } = request.params;

      this.logger.info({
        message: 'Handling call_tool request',
        requestId,
        toolName: name,
        arguments: args
      });

      if (name === SET_CONTEXT_TOOL_NAME) {
        return await this.handleSetProjectContext(args);
      }

      if (this.requiresContextDeclaration()) {
        throw new Error(
          `Project context not declared. Call ${SET_CONTEXT_TOOL_NAME} with the project root path first.`
        );
      }

      const [serverId, toolName] = this.toolList.parseToolName(name);

      if (!serverId || !toolName) {
        throw new Error(`Invalid tool name format: ${name}. Expected: serverId__toolName (double underscore separator)`);
      }

      return await this.executor.call(serverId, toolName, args, requestId, name);
    });
  }

  private getClientName(): string {
    try {
      const version = (this.server as any).getClientVersion?.();
      return version?.name ?? '';
    } catch {
      return '';
    }
  }

  private requiresContextDeclaration(): boolean {
    // Opt-in (gate.requireContextDeclaration): by default every client lists all tools.
    if (this.config.gate?.requireContextDeclaration !== true) {
      return false;
    }
    if (this.sessionIdentified || this.context.matched === 'project') {
      return false;
    }
    const clientName = this.getClientName();
    // Forced context mode applies only to Claude Desktop (no per-project MCP
    // config, unusable cwd). CLI clients fall through to unknown defaults.
    return /claude/i.test(clientName) && !/code/i.test(clientName);
  }

  private async handleSetProjectContext(args: any): Promise<any> {
    const projectPath = args?.projectPath;
    if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: "projectPath" (string) argument is required' }],
        isError: true
      };
    }

    const found = findKnownProject(this.config.gate?.knownProjects, projectPath);
    if (!found) {
      this.logger.warn({
        message: 'set_project_context: path not in knownProjects registry',
        projectPath
      });
      return {
        content: [
          {
            type: 'text',
            text: `Path "${projectPath}" is not a registered project (or inside one). Unknown-project policy remains active.`
          }
        ],
        isError: true
      };
    }

    this.context = buildProjectContext(this.config, found.id, found.path);
    this.sessionIdentified = true;
    this.startPolicyWatcher();
    await this.refreshToolCache(true);

    const result = {
      projectId: found.id,
      projectPath: found.path,
      matchedPolicy: 'project',
      enabledToolCount: this.toolList.tools.length
    };

    this.logger.info({
      message: 'Project context set via meta-tool',
      projectId: found.id,
      projectPath: found.path,
      enabledToolCount: this.toolList.tools.length
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  }

  private onPolicyFileChanged(): void {
    this.logger.info('Policy or gate config file changed, reloading');
    try {
      this.config = loadConfig(this.configPath);
    } catch (error) {
      this.logger.warn({
        message: 'Failed to reload gateway config, keeping previous configuration',
        error: (error as Error).message
      });
    }
    if (this.context.matched === 'project' && this.context.policyPath && this.context.projectId) {
      this.context.policy = loadProjectPolicy(this.context.policyPath, this.context.projectId, this.context.policy);
    } else {
      const reloaded = resolveProjectContext(this.config, this.origin);
      this.context = reloaded;
      this.sessionIdentified = reloaded.matched === 'project';
    }
    // A shared pool serves other sessions whose policy may still allow the server, so only the idle timer closes it.
    if (!this.sharedPool) {
      for (const serverId of this.connectionPool.getAllServerIds()) {
        const serverConfig = this.config.downstreamServers[serverId];
        if (!serverConfig || serverConfig.disabled || !isServerAllowed(this.context.policy, serverId, serverConfig.projectOnly === true)) {
          this.connectionPool.closeConnection(serverId).catch(() => undefined);
        }
      }
    }
    this.refreshToolCache(true).catch((error) => {
      this.logger.warn({
        message: 'Tool cache refresh failed after policy change',
        error: (error as Error).message
      });
    });
  }

  private startPolicyWatcher(): void {
    this.policyWatcher.watchPaths(this.context.policyPath, this.configPath);
  }

  async start(transport?: Transport): Promise<void> {
    this.logger.info('Starting Common MCP Gateway');

    await this.server.connect(transport ?? new StdioServerTransport());

    this.logger.info({
      message: 'Common MCP Gateway started successfully',
      downstreamServers: Object.keys(this.config.downstreamServers),
      projectContext: this.context.matched,
      projectId: this.context.projectId,
      policyPath: this.context.policyPath
    });

    this.startPolicyWatcher();

    try {
      await this.refreshToolCache(true);
      this.logger.info('Tools cache initialized successfully');
    } catch (error) {
      this.logger.warn({
        message: 'Failed to initialize tools cache',
        error: (error as Error).message
      });
    }
  }

  private async refreshToolCache(shouldNotify = false): Promise<void> {
    await this.toolList.refresh();

    if (shouldNotify) {
      await this.sendToolListChangedNotification();
    }
  }

  private async sendToolListChangedNotification(): Promise<void> {
    if (typeof (this.server as any).sendToolListChanged !== 'function') {
      return;
    }

    try {
      await (this.server as any).sendToolListChanged();
      this.logger.info('tools/list_changed notification sent');
    } catch (error) {
      this.logger.warn({
        message: 'Failed to send tools/list_changed notification',
        error: (error as Error).message
      });
    }
  }

  /** Synchronous downstream process-tree kill for the process 'exit' handler. */
  killDownstreamSync(): void {
    this.connectionPool.killAllSync();
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Common MCP Gateway');

    this.timeoutWatchdog.cancelAll();
    this.policyWatcher.close();
    if (!this.sharedPool)
      await this.connectionPool.closeAll();

    await this.server.close();

    this.logger.info('Common MCP Gateway stopped');
  }
}
