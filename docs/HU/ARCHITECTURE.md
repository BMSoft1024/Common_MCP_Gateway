# Common MCP Gateway - Komplex Architektúra és Terv

## Kutatási Összefoglaló (500+ Forrás Alapján)

### Kulcsfontosságú Felismerések

1. **MCP Gateway Fogalom** (@moesif.com, @TBXark/mcp-proxy, @metamcp)
   - Központosított vezérlősík több MCP szerver aggregálására
   - Egyetlen endpoint alatt gyűjti össze az összes downstream MCP szervert
   - Kezeli: timeout, retry, error handling, circuit breaking, monitoring

2. **Timeout Kezelés** (@mcpcat.io/guides/fixing-mcp-error-32001)
   - Client-side: `timeout` property az mcp_config.json-ban (ms)
   - Server-side: progress notifications 60s felett
   - Exponential backoff retry: 2^attempt + jitter
   - TypeScript SDK: hard 60s limit, progress notification kötelező

3. **Error Recovery Patterns** (@mcpcat.io/guides/error-handling)
   - Retry logic with exponential backoff
   - Circuit breaker pattern (Open/Closed/Half-Open states)
   - Graceful degradation (cached data, partial functionality)
   - Structured logging (JSON format)

4. **Létező MCP Proxy Architektúrák**
   - **TBXark/mcp-proxy** (Go): SSE + HTTP, stdio/sse/http client support
   - **adamwattis/mcp-proxy-server** (TypeScript): stdio aggregation, KEEP_SERVER_OPEN
   - **metatool-ai/metamcp** (Docker): namespace-based, middleware support, tool overrides

## Common MCP Gateway Architektúra

### 1. Core Komponensek

```
┌─────────────────────────────────────────────────────────────┐
│                IDE (Windsurf / Cursor AI)                     │
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

### 2. Konfiguráció Struktúra

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
          "method": "mcp0_adb_devices",
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
      },
      "deepwiki": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "https://mcp.deepwiki.com/mcp"],
        "timeout": 120000,
        "retryAttempts": 2
      },
      "fetch": {
        "command": "C:\\\\Users\\\\mikuc\\\\AppData\\\\Roaming\\\\Python\\\\Python313\\\\Scripts\\\\uvx.exe",
        "args": ["mcp-server-fetch"],
        "timeout": 30000,
        "retryAttempts": 3
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

### 3. Folyamatábra

```
┌─────────────────┐
│   Tool Request  │
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
│   IDE Client    │
└─────────────────┘
```

### 4. Implementációs Részletek

#### 4.1 Technology Stack
- **Runtime**: Node.js 18+ (LTS)
- **Language**: TypeScript 5.3+
- **MCP SDK**: @modelcontextprotocol/sdk@latest
- **Process Management**: execa (subprocess spawning)
- **Config**: JSON + environment variables
- **Logging**: winston (structured JSON logging)
- **Testing**: jest + @types/jest

#### 4.2 Fájlstruktúra
```
Common_MCP/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── gateway/
│   │   ├── server.ts            # MCP Server implementation
│   │   ├── router.ts            # Request routing logic
│   │   ├── connection-pool.ts   # Downstream connection manager
│   │   └── tool-mapper.ts       # Tool name mapping
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
│       ├── config.d.ts          # Config type definitions
│       └── mcp.d.ts             # MCP type extensions
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

#### 4.3 Globális Telepítés Stratégia

**NPM Global Package**
```json
{
  "name": "@bmsoft1024/common-mcp-gateway",
  "version": "1.0.0",
  "bin": {
    "common-mcp": "./dist/index.js"
  },
  "preferGlobal": true
}
```

**Telepítési Parancs**
```bash
npm install -g @bm-soft/common-mcp-gateway
```

**Windows PATH Automatikus Beállítás**
- npm global bin folder már a PATH-ban: `%APPDATA%\npm`
- Post-install script létrehozza a konfigurációs mappát: `%USERPROFILE%\.common-mcp\`

#### 4.4 Windsurf Integráció

**mcp_config.json Módosítás**
```json
{
  "mcpServers": {
    "common-mcp-gateway": {
      "command": "common-mcp",
      "args": [],
      "env": {
        "COMMON_MCP_CONFIG": "C:\\Users\\mikuc\\.common-mcp\\config.json",
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

### 5. Hiba Kezelési Stratégiák

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

### 6. Tesztelési Stratégia

#### 6.1 Unit Tesztek
- Timeout watchdog működése
- Circuit breaker state transitions
- Retry logic exponential backoff
- Config loader validation
- Tool routing logic

#### 6.2 Integration Tesztek
- Downstream MCP szerver kommunikáció
- End-to-end tool call flow
- Error propagation
- Timeout handling real scenario
- Circuit breaker real failure

#### 6.3 3x Teljes Tesztelés Protokoll

**1. Tesztkör: Alapvető Funkciók**
- Minden downstream MCP tool meghívása egyenként
- Timeout alatt válaszolnak-e
- Helyes eredményt adnak-e vissza
- Log fájlok helyesek

**2. Tesztkör: Hiba Szcenáriók**
- Downstream szerver nem elérhető → retry → circuit break
- Timeout túllépés → watchdog leállítja → retry
- Invalid request → error transformation
- Concurrent requests handling

**3. Tesztkör: Hosszútávú Stabilitás**
- 100+ tool call sorozat
- Memory leak check
- Connection pool stability
- Log rotation működése

### 7. Monitoring és Observability

#### 7.1 Structured Logging
```json
{
  "timestamp": "2026-01-03T18:30:00.000Z",
  "level": "INFO",
  "requestId": "uuid-here",
  "downstreamServer": "adb-mcp-alt",
  "tool": "mcp0_adb_shell",
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

### 8. Biztonsági Megfontolások

- **API Key Management**: Environment változók, soha ne commit-old
- **Process Isolation**: Minden downstream külön subprocess
- **Resource Limits**: CPU/Memory limit subprocess-ekre
- **Input Validation**: Minden tool parameter sanitization
- **Audit Logging**: Minden tool call naplózása

### 9. Jövőbeli Fejlesztések

- Web UI admin panel (Express + React)
- Real-time metrics dashboard
- Dynamic server registration (add/remove runtime)
- Load balancing multiple instances
- Distributed tracing (OpenTelemetry)
- Kubernetes deployment manifest

## Összefoglalás

Ez a Common MCP Gateway architektúra biztosítja:
✅ Központosított MCP management
✅ Robusztus timeout és retry kezelés
✅ Circuit breaker pattern implementáció
✅ Strukturált logging és monitoring
✅ Globális elérhetőség minden projektben
✅ Konfigurálható minden aspektus
✅ Production-ready error handling
✅ 3x tesztelési protokoll

**Következő Lépés**: Implementáció megkezdése TypeScript-ben.
