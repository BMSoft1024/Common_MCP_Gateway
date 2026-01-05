# Common MCP Gateway

Központosított MCP (Model Context Protocol) gateway robusztus timeout, retry és circuit breaker kezeléssel.

## Funkciók

- **Több MCP szerver aggregálása** egyetlen végpont alatt
- **Timeout watchdog** konfigurálható határidőkkel
- **Exponential backoff retry** jitter-rel
- **Circuit breaker pattern** (Open/Closed/Half-Open)
- **Structured JSON logging** Winston-nal
- **Globális elérhetőség** minden projektben
- **Konfigurálható** minden aspektus (timeout, retry, circuit breaker)

## Telepítés

### Globális Telepítés

```bash
cd Common_MCP
npm install
npm run build
npm install -g .
```

### Konfiguráció Beállítása

A gateway automatikusan létrehozza a konfigurációs könyvtárat:
- Windows: `C:\Users\[username]\.common-mcp\`
- Konfigurációs fájl: `C:\Users\[username]\.common-mcp\config.json`

Másold át a példa konfigurációt:

```bash
mkdir C:\Users\%USERNAME%\.common-mcp
copy config\default.json C:\Users\%USERNAME%\.common-mcp\config.json
```

## Használat

### Windsurf Integráció

Szerkeszd az `mcp_config.json` fájlt (`C:\Users\[username]\.codeium\windsurf\mcp_config.json`):

```json
{
  "mcpServers": {
    "common-mcp-gateway": {
      "command": "common-mcp",
      "args": [],
      "env": {
        "COMMON_MCP_CONFIG": "C:\\Users\\[username]\\.common-mcp\\config.json"
      },
      "disabled": false
    }
  }
}
```

### Downstream MCP Szerverek Bekötése

A `config.json` fájlban add hozzá a downstream szervereket:

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

### Tool Hívás Formátum

A gateway `serverId/toolName` formátumban várja a tool neveket:

```
adb-mcp-alt/mcp0_adb_devices
android-adb-mcp/mcp1_adb_shell
cursor-playwright/mcp2_playwright_navigate
```

## Konfiguráció Referencia

### Globális Beállítások

```json
{
  "globalDefaults": {
    "timeout": 30000,              // ms
    "retryAttempts": 3,
    "retryDelay": 1000,            // ms base delay
    "circuitBreaker": {
      "enabled": true,
      "failureThreshold": 5,
      "resetTimeout": 60000        // ms
    }
  }
}
```

### Downstream Szerver Konfiguráció

```json
{
  "downstreamServers": {
    "server-id": {
      "command": "npx",
      "args": ["-y", "package-name"],
      "timeout": 45000,            // Override global
      "retryAttempts": 3,          // Override global
      "env": {
        "API_KEY": "value"
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

### Logging Konfiguráció

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

## Fejlesztés

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Tesztek

```bash
npm test
npm run test:coverage
```

## Architektúra

A gateway a következő komponensekből áll:

1. **Router**: Tool név routing downstream szerverekhez
2. **Timeout Watchdog**: Konfigurálható timeout kezelés
3. **Retry Engine**: Exponential backoff + jitter
4. **Circuit Breaker**: Open/Closed/Half-Open states
5. **Connection Pool**: Downstream kapcsolatok kezelése
6. **Logger**: Strukturált JSON logging

Részletes architektúra dokumentáció: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Hibaelhárítás

### MCP Server Nem Található

Ellenőrizd a konfigurációban a `command` és `args` helyességét:

```bash
# Teszteld manuálisan
npx -y package-name
```

### Timeout Hibák

Növeld a timeout értéket a konfigurációban:

```json
{
  "timeout": 60000  // 60 seconds
}
```

### Circuit Breaker Open

Ha túl sok hiba történt, a circuit breaker OPEN állapotba kerül. Várd meg a reset timeout-ot (alapértelmezett: 60s), vagy indítsd újra a gateway-t.

### Logok Vizsgálata

```bash
# Windows
type C:\Users\%USERNAME%\.common-mcp\logs\common-mcp-*.log

# Vagy nyisd meg a fájlt egy JSON viewerben
```

## License

MIT
