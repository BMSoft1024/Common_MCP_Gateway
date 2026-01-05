# Common MCP Gateway Manager - Felhasználói Útmutató

## Áttekintés

A Common MCP Gateway tartalmaz egy webes adminisztrációs felületet a downstream MCP szerverek kezeléséhez. Ez a Gateway Manager lehetővé teszi, hogy könnyedén hozzáadj, módosíts és törölj MCP szervereket.

## ⚠️ FONTOS: Újraindítás Szükséges

**MINDEN konfigurációs változtatás után (enable/disable, hozzáadás, szerkesztés, törlés) ÚJRA KELL INDÍTANOD a Windsurf IDE-t** hogy a módosítások érvénybe lépjenek. A Gateway induláskor tölti be a konfigurációt és nem követi automatikusan a változásokat.

## Funkciók

### Alapvető Funkciók
- **Összes szerver megtekintése**: Teljes lista a downstream szerverekről
- **Inline szerkesztés**: A szerkesztő form az adott szerver alatt jelenik meg (jobb UX)
- **Engedélyezés/Letiltás**: Szerverek ki/bekapcsolása egyetlen kattintással
- **Hozzáadás**: Új MCP szerverek gyors hozzáadása
- **Törlés**: Szerverek eltávolítása megerősítéssel

### Haladó Funkciók
- **Timeout beállítás**: 1000-300000 ms között (alapértelmezett: 30000)
- **Újrapróbálkozások**: 0-10 retry (alapértelmezett: 3)
- **Circuit breaker**: 1-100 hibás próbálkozás küszöb (alapértelmezett: 5)
- **Fallback szerverek**: Alternatív szerverek megadása hiba esetén
- **Élő frissítés**: WebSocket alapú valós idejű szinkronizáció
- **Automatikus mentés**: Változások azonnal mentődnek

## Telepítés és Indítás

### Előfeltételek
- Node.js 18+ (LTS verzió)
- npm vagy yarn
- Common MCP Gateway telepítve és konfigurálva

### Manuális Indítás (Fejlesztés)

**Terminál 1 - Backend:**
```bash
cd gateway-manager/backend
npm install
npm run dev
```

**Terminál 2 - Frontend:**
```bash
cd gateway-manager/frontend
npm install
npm run dev
```

**Hozzáférés:** http://localhost:5173

### PM2 Automatikus Indítás (Ajánlott)

A PM2 process manager használata production környezetben:

```bash
# PM2 telepítése (ha nincs meg)
npm install -g pm2

# Common MCP gyökérkönyvtárból
pm2 start ecosystem.config.js

# Státusz ellenőrzése
pm2 status

# Logok megtekintése
pm2 logs mcp-marketplace-backend
pm2 logs mcp-marketplace-frontend

# Minden leállítása
pm2 stop all

# Automatikus indítás rendszer bootoláskor
pm2 startup
pm2 save
```

## Konfiguráció Helye

**FONTOS:** A Gateway Manager a következő fájlt szerkeszti:

**Windows:**
```
C:\Users\[felhasználónév]\.common-mcp\config.json
```

**Linux/macOS:**
```
~/.common-mcp/config.json
```

**NEM** a Windsurf config fájlt:
- Windows: `C:\Users\[felhasználónév]\.codeium\windsurf\mcp_config.json`
- Linux/macOS: `~/.codeium/windsurf/mcp_config.json`

A változások azonnal mentésre kerülnek és WebSocket-en keresztül minden kliens frissül.

## Használat

### 1. Új MCP Szerver Hozzáadása

1. Kattints a **"+ Add New MCP"** gombra a jobb felső sarokban
2. Add meg a szerver nevét (egyedi azonosító)
3. Add meg a parancsot (pl. `npx`)
4. Add meg az argumentumokat vesszővel elválasztva
5. Opcionálisan állítsd be a környezeti változókat
6. Állítsd be a haladó beállításokat (timeout, retry, stb.)
7. Kattints a **"Save"** gombra

### 2. Meglévő Szerver Szerkesztése

1. Keresd meg a szerkeszteni kívánt szervert a listában
2. Kattints az **"Edit"** gombra
3. A szerkesztő form megjelenik **közvetlenül az adott szerver alatt**
4. Módosítsd a beállításokat
5. Kattints a **"Save"** gombra vagy **"Cancel"** a visszavonáshoz

**Új funkció:** Az edit form már nem a lap tetején jelenik meg, hanem inline az adott elem alatt!

### 3. Szerver Engedélyezése/Letiltása

1. Kattints a szerver mellett lévő **"Enable"** vagy **"Disable"** gombra
2. A változás azonnal érvénybe lép
3. A szerver státusza zöld (ENABLED) vagy piros (DISABLED) lesz

### 4. Szerver Törlése

1. Kattints a **"Delete"** gombra
2. Erősítsd meg a törlést a felugró ablakban
3. A szerver azonnal törlésre kerül a konfigurációból

## Haladó Beállítások

### Timeout Konfiguráció
- **Minimum:** 1000 ms (1 másodperc)
- **Maximum:** 300000 ms (5 perc)
- **Alapértelmezett:** 30000 ms (30 másodperc)
- **Cél:** Maximum várakozási idő az MCP szerver válaszára

### Újrapróbálkozás (Retry)
- **Minimum:** 0 (nincs retry)
- **Maximum:** 10 újrapróbálkozás
- **Alapértelmezett:** 3
- **Cél:** Hányszor próbálja újra hiba esetén, exponenciális backoff-al

### Circuit Breaker Küszöb
- **Minimum:** 1 hiba
- **Maximum:** 100 hiba
- **Alapértelmezett:** 5
- **Cél:** Hány egymást követő hiba után nyitja meg a circuit-et (megelőzi a kaszkád hibákat)

### Fallback Szerverek
- **Formátum:** Vesszővel elválasztott szerver ID-k
- **Példa:** `backup-server-1, backup-server-2`
- **Cél:** Alternatív szerverek használata, ha az elsődleges nem elérhető

### Példa Konfiguráció

```json
{
  "common-mcp": {
    "downstreamServers": {
      "primary-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-package"],
        "timeout": 60000,
        "retries": 5,
        "circuitBreakerThreshold": 10,
        "fallbackServers": ["backup-server"],
        "disabled": false
      },
      "backup-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-package-backup"],
        "timeout": 45000,
        "retries": 3,
        "disabled": false
      }
    }
  }
}
```

## WebSocket Élő Frissítés

A Marketplace UI WebSocket kapcsolatot használ a backend-del:
- **Port:** 1525
- **Event:** `configUpdate`
- **Működés:** Minden config változás után broadcast minden kliensnek

**Előnyök:**
- Nincs szükség manuális frissítésre
- Több kliens egyszerre használható
- Külső fájl módosítások is megjelennek azonnal

## Hibaelhárítás

### Backend nem indul el
- Ellenőrizd, hogy a 1525-ös port szabad-e: `netstat -ano | findstr :1525`
- Ellenőrizd a config fájl elérési útját: `C:\Users\[név]\.common-mcp\config.json`
- A backend automatikusan létrehozza az alapértelmezett config-ot, ha hiányzik
- Nézd meg a backend logokat

### Frontend nem csatlakozik a backend-hez
- Győződj meg róla, hogy a backend fut a 1525-ös porton
- Ellenőrizd a CORS beállításokat a `backend/src/server.ts` fájlban
- Ellenőrizd a Vite proxy konfigurációt a `frontend/vite.config.ts` fájlban

### Konfiguráció nem mentődik
- Ellenőrizd a fájl jogosultságokat: `C:\Users\[név]\.common-mcp\config.json`
- Ellenőrizd, hogy a JSON szintaxis helyes-e
- Nézd meg a backend konzolban a Zod validációs hibákat
- Győződj meg róla, hogy a `downstreamServers` struktúra helyes

### Élő frissítés nem működik
- Ellenőrizd, hogy a WebSocket kapcsolat létrejött-e
- Nézd meg a böngésző konzolban a Socket.io hibákat
- Ellenőrizd, hogy a chokidar figyeli-e a helyes fájl útvonalat

### PM2 Specifikus Problémák

**PM2 nem telepíthető:**
```bash
npm install -g pm2 --force
```

**PM2 app nem indul:**
```bash
pm2 delete all
pm2 start ecosystem.config.js
pm2 logs
```

**PM2 startup hiba Windows-on:**
```bash
# Futtasd adminisztrátorként
pm2 startup
# Másold be és futtasd a megjelenő parancsot
pm2 save
```

## Portok

- **Backend API:** 1525 (localhost only)
- **Frontend Dev Server:** 5173 (Vite)
- **WebSocket:** 1525 (ugyanaz mint a backend)

## Biztonság

- **Localhost only:** Backend csak 127.0.0.1-re bind-ol
- **CORS:** Korlátozott a frontend origin-re
- **Helmet:** Biztonsági headerek CSP-vel
- **Input validáció:** Zod schema minden végponton
- **Nincs authentikáció:** Biztonságos helyi használatra

## Technológiai Stack

### Backend
- Express 4.x
- Socket.io 4.x
- Chokidar 3.x
- Zod 3.x
- TypeScript 5.x

### Frontend
- React 18
- Vite 5.x
- TanStack Query (React Query) 5.x
- Socket.io-client 4.x
- Tailwind CSS 3.x
- TypeScript 5.x

## Támogatás

Ha problémád van a Marketplace UI-val:
1. Ellenőrizd ezt a dokumentációt
2. Nézd meg a logokat: `pm2 logs` vagy backend/frontend konzol
3. Ellenőrizd a config fájl szintaxisát
4. Nyiss issue-t a GitHub repository-ban

## Frissítési Jegyzetek

### v1.0.0 (2026-01-04)
- ✅ Config path javítva: Common MCP `config.json` használata
- ✅ Inline edit form: az elem alatt jelenik meg (nem a tetején)
- ✅ PM2 auto-start támogatás: `ecosystem.config.js`
- ✅ Teljes haladó beállítások: timeout, retry, circuit breaker, fallback
- ✅ WebSocket élő frissítés minden változáshoz
- ✅ Dark mode UI Tailwind CSS-sel
- ✅ Teljes API validáció Zod schemákkal

## Következő Funkciók (Tervezett)

- [ ] Szerver állapot monitoring (health check)
- [ ] Konfiguráció import/export
- [ ] Batch műveletek (több szerver egyszerre)
- [ ] Szerver sablonok (templates)
- [ ] Metrics és statisztikák dashboard
- [ ] Szerver log viewer a UI-ban
