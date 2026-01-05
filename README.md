# Common MCP Gateway

A centralized MCP (Model Context Protocol) gateway with robust timeout, retry, and circuit breaker handling.

## Features

- **Aggregate multiple MCP servers** under a single endpoint
- **Timeout watchdog** with configurable deadlines
- **Exponential backoff retry** with jitter
- **Circuit breaker pattern** (Open/Closed/Half-Open states)
- **Structured JSON logging** with Winston
- **Global availability** across all projects
- **Fully configurable** (timeout, retry, circuit breaker settings)

## Installation

### Global Installation

```bash
cd Common_MCP
npm install
npm run build
npm install -g .
```

### Configuration Setup

The gateway automatically creates the configuration directory:
- Windows: `C:\Users\[username]\.common-mcp\`
- Config file: `C:\Users\[username]\.common-mcp\config.json`

The config file is automatically created on first run with default settings. You can also:

```bash
mkdir C:\Users\%USERNAME%\.common-mcp
copy config\default.json C:\Users\%USERNAME%\.common-mcp\config.json
```

**Configuration Format:**
```json
{
  "common-mcp": {
    "version": "1.0.0",
    "globalDefaults": {
      "timeout": 30000,
      "retryAttempts": 3,
      "retryDelay": 1000,
      "circuitBreaker": {
        "enabled": true,
        "failureThreshold": 5,
        "resetTimeout": 60000
      }
    },
    "downstreamServers": {
      "your-mcp-server": {
        "command": "npx",
        "args": ["-y", "your-mcp-package"],
        "timeout": 30000,
        "retries": 3,
        "env": {}
      }
    }
  }
}
```

## Usage

### IDE Integration

#### Windsurf IDE

Edit the `mcp_config.json` file:
- **Windows**: `C:\Users\[username]\.codeium\windsurf\mcp_config.json`
- **Linux/macOS**: `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "common-mcp-gateway": {
      "command": "common-mcp",
      "args": [],
      "disabled": false
    }
  }
}
```

#### Cursor AI IDE

Edit the Cursor MCP configuration file:
- **Windows**: `C:\Users\[username]\AppData\Roaming\Cursor\User\mcp.json`
- **Linux**: `~/.config/Cursor/User/mcp.json`
- **macOS**: `~/Library/Application Support/Cursor/User/mcp.json`

```json
{
  "mcpServers": {
    "common-mcp-gateway": {
      "command": "common-mcp",
      "args": [],
      "env": {
        "COMMON_MCP_CONFIG": "~/.common-mcp/config.json"
      },
      "disabled": false
    }
  }
}
```

**Important**: Disable all downstream MCP servers in `mcp_config.json` (set `"disabled": true`) as they will be managed by the gateway.

### Adding Downstream MCP Servers

In the `config.json` file, add your downstream servers:

```json
{
  "common-mcp": {
    "downstreamServers": {
      "my-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-server"],
        "timeout": 30000,
        "retryAttempts": 3
      }
    }
  }
}
```

### Tool Naming Convention

The gateway uses `serverId__toolName` format (double underscore):

```
time__get_current_time
fetch__fetch
filesystem__read_file
memory__create_entities
cursor-playwright__playwright_navigate
```

**Why double underscore?** Windsurf requires tool names matching `^[a-zA-Z0-9_-]{1,64}$`. The slash character (`/`) is not allowed, so we use `__` as a separator.

## Configuration Reference

### Global Defaults

```json
{
  "globalDefaults": {
    "timeout": 30000,              // milliseconds
    "retryAttempts": 3,
    "retryDelay": 1000,            // base delay in ms
    "circuitBreaker": {
      "enabled": true,
      "failureThreshold": 5,
      "resetTimeout": 60000        // milliseconds
    }
  }
}
```

### Downstream Server Configuration

```json
{
  "downstreamServers": {
    "server-id": {
      "command": "npx",
      "args": ["-y", "package-name"],
      "timeout": 45000,            // Override global
      "retryAttempts": 3,          // Override global
      "env": {
        "API_KEY": "your-key-here"
      },
      "healthCheck": {
        "enabled": true,
        "method": "tool_name",
        "interval": 30000
      }
    }
  }
}
```

### Logging Configuration

```json
{
  "logging": {
    "level": "INFO",               // DEBUG|INFO|WARN|ERROR
    "format": "json",              // json|simple
    "file": "path/to/log.log",
    "maxSize": "10MB",
    "maxFiles": 5
  }
}
```

## Marketplace UI (Admin Interface)

### Web-based Configuration Editor

The Common MCP Gateway includes a web-based admin interface for managing your MCP servers:

**Features:**
- View all downstream MCP servers
- Add new MCP servers with full configuration
- Edit existing servers (inline, below selected item)
- Enable/Disable servers
- Delete servers
- Live WebSocket updates (no restart required)
- Timeout, retry, circuit breaker, and fallback configuration

### Running the Marketplace UI

**Option 1: Manual Start (Development)**

```bash
# Terminal 1: Start backend
cd marketplace/backend
npm run dev

# Terminal 2: Start frontend
cd marketplace/frontend
npm run dev
```

Access at: http://localhost:5173

**Option 2: PM2 Auto-Start (Production)**

Use PM2 process manager for automatic startup:

```bash
# Install PM2 globally (if not installed)
npm install -g pm2

# Start both backend and frontend
pm2 start ecosystem.config.js

# View status
pm2 status

# View logs
pm2 logs mcp-marketplace-backend
pm2 logs mcp-marketplace-frontend

# Stop all
pm2 stop all

# Enable startup on system boot
pm2 startup
pm2 save
```

**Configuration Path:**
- The Marketplace UI edits: `C:\Users\[username]\.common-mcp\config.json`
- **NOT** the Windsurf config: `C:\Users\[username]\.codeium\windsurf\mcp_config.json`
- Changes are saved immediately and broadcast via WebSocket

### UI Usage

1. **Add New MCP Server**: Click "+ Add New MCP" button at top
2. **Edit Server**: Click "Edit" button on any server - form appears below that server
3. **Enable/Disable**: Click "Enable" or "Disable" button
4. **Delete Server**: Click "Delete" button and confirm
5. **Advanced Settings**: Configure timeout, retries, circuit breaker thresholds, fallback servers

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Tests

```bash
npm test
npm run test:coverage
```

## Architecture

The gateway consists of the following components:

1. **Router**: Routes tool names to downstream servers
2. **Timeout Watchdog**: Configurable timeout management
3. **Retry Engine**: Exponential backoff with jitter
4. **Circuit Breaker**: Open/Closed/Half-Open state management
5. **Connection Pool**: Downstream connection lifecycle
6. **Logger**: Structured JSON logging

Detailed architecture documentation: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Troubleshooting

### MCP Server Not Found

Check the `command` and `args` in your configuration:

```bash
# Test manually
npx -y package-name
```

### Timeout Errors

Increase the timeout value in configuration:

```json
{
  "timeout": 60000  // 60 seconds
}
```

### Circuit Breaker Open

If too many errors occur, the circuit breaker enters OPEN state. Wait for the reset timeout (default: 60s) or restart the gateway.

### Log Inspection

```bash
# Windows
type C:\Users\%USERNAME%\.common-mcp\logs\common-mcp-*.log

# Or open the file in a JSON viewer
```

## Extending the Gateway

### Adding a New MCP Server

1. Add server configuration to `config.json`:

```json
{
  "downstreamServers": {
    "my-new-server": {
      "command": "npx",
      "args": ["-y", "@scope/my-mcp-server"],
      "timeout": 30000,
      "retryAttempts": 3,
      "env": {
        "API_KEY": "optional-key"
      }
    }
  }
}
```

2. Restart the gateway (or restart Windsurf to reload the gateway)

3. Tools will be available as `my-new-server__toolname`

### Custom Middleware

You can extend the gateway with custom middleware. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## MCP Marketplace UI

A web-based configuration management interface is available for easy MCP server management.

### Features
- **Visual Config Management**: View, add, edit, and delete MCP servers
- **Enable/Disable Toggle**: Quick on/off switching for any server
- **Live Reload**: Real-time updates via WebSocket
- **Configuration Validation**: Automatic validation before saving
- **Dark Mode UI**: Modern, clean interface

### Quick Start

**Start Backend:**
```bash
cd marketplace/backend
npm install
npm run dev
```

**Start Frontend:**
```bash
cd marketplace/frontend
npm install
npm run dev
```

Access at `http://localhost:5173`

See [marketplace/README.md](./marketplace/README.md) for detailed documentation.

## Testing

Comprehensive testing results available in [MCP_TOOLS_TEST_RESULTS.md](./MCP_TOOLS_TEST_RESULTS.md).

**Tested MCP Servers:**
- ✅ Time MCP (2 tools)
- ✅ Fetch MCP (1 tool)
- ✅ Filesystem MCP (10+ tools)
- ✅ Memory MCP (8 tools)
- ✅ Sequential Thinking MCP (1 tool)
- ✅ Cursor Playwright MCP (30+ tools)

**Test Results:** 13+ tools tested with 100% success rate.

## Examples

See the [marketplace](./marketplace) directory for:
- Backend API server example
- React frontend implementation
- WebSocket live reload pattern
- Configuration validation examples

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly (see TESTING.md)
4. Submit a pull request

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history and release notes.

## License

Apache License 2.0 - See [LICENSE](./LICENSE) file for details.

## Links

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Windsurf IDE](https://codeium.com/windsurf)
- [Cursor AI IDE](https://cursor.sh/)
- [Architecture Documentation](./docs/EN/ARCHITECTURE.md)
- [Testing Documentation](./docs/EN/TESTING.md)
- [Test Results](./docs/EN/MCP_TOOLS_TEST_RESULTS.md)

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/BMSoft1024/Common_MCP_Gateway/issues)
- Documentation: [docs/EN/](./docs/EN/) and [docs/HU/](./docs/HU/)

---

**Hungarian documentation**: See [docs/HU/](./docs/HU/) for Hungarian versions of all documentation.
