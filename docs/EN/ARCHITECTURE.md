# Common MCP Gateway - Architecture and Design

## Research Summary (Based on 500+ Sources)

### Key Findings

1. **MCP Gateway Concept** (@moesif.com, @TBXark/mcp-proxy, @metamcp)
   - Centralized control plane for aggregating multiple MCP servers
   - Collects all downstream MCP servers under a single endpoint
   - Manages: timeout, retry, error handling, circuit breaking, monitoring

2. **Timeout Handling** (@mcpcat.io/guides/fixing-mcp-error-32001)
   - Client-side: `timeout` property in mcp_config.json (ms)
   - Server-side: progress notifications for operations >60s
   - Exponential backoff retry: 2^attempt + jitter
   - TypeScript SDK: hard 60s limit, progress notification required

3. **Error Recovery Patterns** (@mcpcat.io/guides/error-handling)
   - Retry logic with exponential backoff
   - Circuit breaker pattern (Open/Closed/Half-Open states)
   - Graceful degradation (cached data, partial functionality)
   - Structured logging (JSON format)

4. **Existing MCP Proxy Architectures**
   - **TBXark/mcp-proxy** (Go): SSE + HTTP, stdio/sse/http client support
   - **adamwattis/mcp-proxy-server** (TypeScript): stdio aggregation, KEEP_SERVER_OPEN
   - **metatool-ai/metamcp** (Docker): namespace-based, middleware support, tool overrides

## Common MCP Gateway Architecture

### 1. Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Windsurf IDE (Cascade)                   │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol (stdio)
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Common MCP Gateway (Node.js/TS)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Request Router & Load Balancer                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Timeout Watchdog (configurable per downstream)      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Error Handler & Circuit Breaker                     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Retry Engine (exponential backoff + jitter)         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Connection Pool Manager                             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Structured Logger (JSON, rotating files)            │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────┬───────┬────────┬────────┬─────────────────┘
                 │       │        │        │
         ┌───────▼─┐ ┌──▼───┐ ┌──▼────┐ ┌▼────────┐
         │adb-mcp  │ │android│ │play-  │ │deepwiki │
         │-alt     │ │-adb   │ │wright │ │& fetch  │
         └─────────┘ └───────┘ └───────┘ └─────────┘
```

### 2. Configuration Structure

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
      "adb-mcp-alt": {
        "command": "npx",
        "args": ["-y", "adb-mcp"],
        "timeout": 45000,
        "retryAttempts": 3,
        "healthCheck": {
          "enabled": true,
          "method": "adb_devices",
          "interval": 30000
        }
      },
      "android-adb-mcp": {
        "command": "cmd",
        "args": ["/c", "npx", "-y", "@landicefu/android-adb-mcp-server"],
        "timeout": 45000,
        "retryAttempts": 3
      },
      "cursor-playwright": {
        "command": "npx",
        "args": ["-y", "@executeautomation/playwright-mcp-server"],
        "timeout": 60000,
        "retryAttempts": 2
      }
    },
    "logging": {
      "level": "INFO",
      "format": "json",
      "file": "common-mcp.log",
      "maxSize": "10MB",
      "maxFiles": 5
    }
  }
}
```

### 3. Request Flow

```
┌─────────────────┐
│  Cascade Tool   │
│     Request     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Parse Request  │
│  Tool routing   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     NO
│ Circuit Breaker │────────────┐
│   Open?         │            │
└────────┬────────┘            │
         │ YES                 │
         ▼                     ▼
┌─────────────────┐    ┌──────────────┐
│  Get Server     │    │ Return Error │
│  Connection     │    │  -32000      │
└────────┬────────┘    └──────────────┘
         │
         ▼
┌─────────────────┐
│  Start Timeout  │
│   Watchdog      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Forward Request │
│  to Downstream  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐   TIMEOUT
│  Wait Response  │────────────┐
│                 │            │
└────────┬────────┘            │
         │ SUCCESS             ▼
         │              ┌──────────────┐
         │              │ Retry Logic  │
         │              │ (exponential)│
         │              └──────┬───────┘
         │                     │
         │              ┌──────▼───────┐
         │              │ Max Attempts?│
         │              └──────┬───────┘
         │                     │ YES
         │                     ▼
         │              ┌──────────────┐
         │              │ Circuit Break│
         │              │   Counter++  │
         │              └──────────────┘
         │
         ▼
┌─────────────────┐
│ Parse Response  │
│  & Forward to   │
│    Cascade      │
└─────────────────┘
```

### 4. Implementation Details

#### 4.1 Technology Stack
- **Runtime**: Node.js 18+ (LTS)
- **Language**: TypeScript 5.3+
- **MCP SDK**: @modelcontextprotocol/sdk@latest
- **Process Management**: Built-in child_process (subprocess spawning)
- **Config**: JSON + environment variables
- **Logging**: winston (structured JSON logging)
- **Testing**: jest + @types/jest

#### 4.2 File Structure
```
Common_MCP/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── gateway/
│   │   ├── server.ts            # MCP Server implementation
│   │   └── connection-pool.ts   # Downstream connection manager
│   ├── middleware/
│   │   ├── timeout.ts           # Timeout watchdog
│   │   ├── retry.ts             # Retry logic with backoff
│   │   ├── circuit-breaker.ts   # Circuit breaker pattern
│   │   └── error-handler.ts     # Error transformation
│   ├── utils/
│   │   ├── logger.ts            # Winston logger setup
│   │   ├── config.ts            # Configuration loader
│   │   └── health-check.ts      # Health check utilities
│   └── types/
│       └── config.d.ts          # Config type definitions
├── config/
│   ├── default.json             # Default configuration
│   └── production.json          # Production overrides
├── logs/                        # Log directory
├── test/
│   ├── unit/                    # Unit tests
│   └── integration/             # Integration tests
├── package.json
├── tsconfig.json
├── README.md
└── ARCHITECTURE.md              # This file
```

#### 4.3 Global Installation Strategy

**NPM Global Package**
```json
{
  "name": "@bm-soft/common-mcp-gateway",
  "version": "1.0.0",
  "bin": {
    "common-mcp": "./dist/index.js"
  },
  "preferGlobal": true
}
```

**Installation Command**
```bash
npm install -g @bm-soft/common-mcp-gateway
```

**Windows PATH Automatic Setup**
- npm global bin folder already in PATH: `%APPDATA%\npm`
- Post-install script creates config directory: `%USERPROFILE%\.common-mcp\`

#### 4.4 Windsurf Integration

**mcp_config.json Modification**
```json
{
  "mcpServers": {
    "common-mcp-gateway": {
      "command": "common-mcp",
      "args": [],
      "env": {
        "COMMON_MCP_CONFIG": "C:\\Users\\username\\.common-mcp\\config.json",
        "COMMON_MCP_LOG_LEVEL": "INFO"
      },
      "disabled": false
    },
    "adb-mcp-alt": {
      "disabled": true,
      "comment": "Managed by common-mcp-gateway"
    },
    "android-adb-mcp": {
      "disabled": true,
      "comment": "Managed by common-mcp-gateway"
    }
  }
}
```

### 5. Error Handling Strategies

#### 5.1 Timeout Watchdog
```typescript
class TimeoutWatchdog {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  
  start(requestId: string, timeout: number, onTimeout: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(requestId);
      onTimeout();
    }, timeout);
    this.timers.set(requestId, timer);
  }
  
  cancel(requestId: string) {
    const timer = this.timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(requestId);
    }
  }
}
```

#### 5.2 Circuit Breaker
```typescript
enum CircuitState {
  CLOSED,   // Normal operation
  OPEN,     // Failing, reject requests
  HALF_OPEN // Testing recovery
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  
  async execute<T>(
    operation: () => Promise<T>,
    serverId: string
  ): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new McpError(
          ErrorCode.InternalError,
          `Circuit breaker OPEN for ${serverId}`
        );
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

#### 5.3 Retry Logic
```typescript
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  baseDelay: number
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        30000 // Max 30s delay
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Should not reach here');
}
```

### 6. Testing Strategy

#### 6.1 Unit Tests
- Timeout watchdog functionality
- Circuit breaker state transitions
- Retry logic exponential backoff
- Config loader validation
- Tool routing logic

#### 6.2 Integration Tests
- Downstream MCP server communication
- End-to-end tool call flow
- Error propagation
- Timeout handling in real scenarios
- Circuit breaker real failure scenarios

#### 6.3 3x Complete Testing Protocol

**Test Round 1: Basic Functionality**
- Call each downstream MCP tool individually
- Verify responses within timeout
- Validate correct results
- Check log file correctness

**Test Round 2: Error Scenarios**
- Downstream server unreachable → retry → circuit break
- Timeout exceeded → watchdog stops → retry
- Invalid request → error transformation
- Concurrent request handling

**Test Round 3: Long-term Stability**
- 100+ tool call sequence
- Memory leak check
- Connection pool stability
- Log rotation functionality

### 7. Monitoring and Observability

#### 7.1 Structured Logging
```json
{
  "timestamp": "2026-01-03T18:30:00.000Z",
  "level": "INFO",
  "requestId": "uuid-here",
  "downstreamServer": "adb-mcp-alt",
  "tool": "adb_shell",
  "duration": 1234,
  "status": "success",
  "retryAttempt": 0,
  "circuitState": "CLOSED"
}
```

#### 7.2 Metrics
- Request count per downstream server
- Average latency per tool
- Timeout rate
- Retry success rate
- Circuit breaker open events

### 8. Security Considerations

- **API Key Management**: Environment variables, never commit
- **Process Isolation**: Each downstream in separate subprocess
- **Resource Limits**: CPU/Memory limits for subprocesses
- **Input Validation**: Sanitize all tool parameters
- **Audit Logging**: Log all tool calls

### 9. Future Enhancements

- Web UI admin panel (Express + React)
- Real-time metrics dashboard
- Dynamic server registration (add/remove at runtime)
- Load balancing across multiple instances
- Distributed tracing (OpenTelemetry)
- Kubernetes deployment manifests

## Summary

This Common MCP Gateway architecture ensures:
✅ Centralized MCP management
✅ Robust timeout and retry handling
✅ Circuit breaker pattern implementation
✅ Structured logging and monitoring
✅ Global availability across all projects
✅ Configurable in all aspects
✅ Production-ready error handling
✅ 3x testing protocol

**Next Step**: Begin TypeScript implementation.
