# Baileys Migration - Quick Reference Guide

## At a Glance

### Problem Statement
Current whatsapp-web.js implementation has:
- Large sessions (50-500MB) consuming Redis storage
- Slow startup (40-70 seconds)
- Heavy resource usage (requires Chromium)
- Single-device limitation

### Solution
Migrate to Baileys which offers:
- Tiny sessions (1-8MB)
- Fast startup (4-15 seconds)
- Lightweight (WebSocket-based)
- Multi-device support built-in

---

## Current vs Baileys Comparison Matrix

```
┌─────────────────────────┬──────────────────────┬──────────────────────┐
│ Feature                 │ whatsapp-web.js      │ Baileys              │
├─────────────────────────┼──────────────────────┼──────────────────────┤
│ Session Size            │ 50-500MB             │ 1-8MB                │
│ Startup Time            │ 40-70 seconds        │ 4-15 seconds         │
│ Browser                 │ Chromium required    │ None (WebSocket)     │
│ Compression             │ ZIP (level 9)        │ JSON serialization    │
│ Storage Format          │ Base64 encoded       │ JSON objects         │
│ Multi-device            │ No                   │ Yes (native)         │
│ Redis Keys              │ 3 keys               │ 7+ keys              │
│ CPU Usage               │ High (rendering)     │ Low (messaging only) │
│ Memory Baseline         │ 200-400MB            │ 50-100MB             │
│ Connection Type         │ Browser automation   │ Direct WebSocket     │
│ QR Code Handling        │ Browser rendered     │ String-based         │
│ Error Recovery          │ Session delete       │ Better isolation     │
└─────────────────────────┴──────────────────────┴──────────────────────┘
```

---

## Session Persistence Comparison

### whatsapp-web.js Flow

```
┌────────────────────────────────────────────────────────────┐
│ Session Folder (.wwebjs_auth/RemoteAuth-ankaa-whatsapp/)  │
│ - Default/                                                  │
│   ├── Cache/                                                │
│   ├── Code Cache/                                           │
│   ├── IndexedDB/       ← WhatsApp auth keys stored here    │
│   ├── Local Storage/   ← Tokens                            │
│   └── Session Storage/                                      │
│ - SingletonLock        ← Remove during cleanup              │
└────────────────────────────────────────────────────────────┘
                              ↓
                   [archiver zip, level 9]
                              ↓
                         ZIP Buffer
                              ↓
                     [Buffer.toString('base64')]
                              ↓
    ┌────────────────────────────────────────────┐
    │ Redis Key: whatsapp:session:ankaa-whatsapp │
    │ Size: 50-100MB base64 encoded              │
    │ TTL: 30 days                               │
    └────────────────────────────────────────────┘
```

### Baileys Flow

```
┌──────────────────────────────────────────────┐
│ AuthState Object                             │
│ {                                            │
│   creds: {                                   │
│     noiseKey,                                │
│     signedIdentityKey,                       │
│     signedPreKey,                            │
│     registrationId,                          │
│     ...                                      │
│   },                                         │
│   keys: {                                    │
│     get: (type, jids) => ...,                │
│     set: (data) => ...                       │
│   }                                          │
│ }                                            │
└──────────────────────────────────────────────┘
              ↓
       [JSON.stringify()]
              ↓
   ┌─────────────────────────┐
   │ Multiple Redis Keys:    │
   ├─────────────────────────┤
   │ whatsapp:creds:...      │
   │ whatsapp:keys:pre-key:..│
   │ whatsapp:keys:session:..│
   │ whatsapp:keys:sender-..│
   │ whatsapp:auth:meta:...  │
   │ Size: 1-8MB total       │
   │ TTL: 30 days            │
   └─────────────────────────┘
```

---

## Redis Key Mapping

### Current (whatsapp-web.js)

```redis
# Main session storage
whatsapp:session:ankaa-whatsapp → <50-100MB base64>

# QR Code (temporary)
whatsapp:qr → {"qr": "<data url>", "expiresAt": "..."}

# Status tracking
whatsapp:status → {"status": "READY", "lastUpdated": "..."}
```

### Target (Baileys)

```redis
# Credentials (small, frequently updated)
whatsapp:creds:ankaa-whatsapp → JSON {noiseKey, signedIdentityKey, ...}

# Keys organized by type
whatsapp:keys:pre-key:ankaa-whatsapp → {jid1: key, jid2: key, ...}
whatsapp:keys:session:ankaa-whatsapp → {jid1: key, jid2: key, ...}
whatsapp:keys:sender-key:ankaa-whatsapp → {jid1: key, ...}
whatsapp:keys:app-state-sync-key:ankaa-whatsapp → {...}
whatsapp:keys:app-state-sync-version:ankaa-whatsapp → {...}
whatsapp:keys:sender-key-memory:ankaa-whatsapp → {...}

# Same QR and status keys as before
whatsapp:qr → {"qr": "<data url>", "expiresAt": "..."}
whatsapp:status → {"status": "READY", "lastUpdated": "..."}

# Metadata for tracking
whatsapp:auth:meta:ankaa-whatsapp → {creds_updated_at, keys_updated_at}
```

---

## Event Flow Comparison

### whatsapp-web.js Events

```
Application Start
    ↓
client.on('qr') → Store QR in Redis (expires in 60s)
    ↓
client.on('authenticated') → Clear QR
    ↓
client.on('ready') → Start backup intervals
    ↓
client.on('remote_session_saved') → Save to Redis (every few minutes)
    ↓
client.on('disconnected') → Handle reconnection
```

### Baileys Events

```
Application Start
    ↓
socket.ev.on('connection.update', {qr}) → Store QR in Redis
    ↓
socket.ev.on('creds.update') → Save to Redis (CONTINUOUS)
    ↓
socket.ev.on('connection.update', {connection: 'open'}) → Ready
    ↓
socket.ev.on('connection.update', {connection: 'close'}) → Reconnect
```

**Key difference:** Baileys emits `creds.update` continuously, requiring more frequent saves.

---

## Startup Time Breakdown

### whatsapp-web.js (40-70 seconds)

```
Phase                          Duration    Activity
────────────────────────────────────────────────────────
Check session in Redis         0.5s        Network I/O
Extract ZIP from Redis         1-2s        Decompression
Create client instance         1s          JavaScript object
Launch Chromium                20-40s      Heavy: subprocess, loading
Load WhatsApp Web              10-20s      Browser: DOM rendering
Authenticate/Ready             3-10s       WhatsApp connection
────────────────────────────────────────────────────────
TOTAL                          40-70s
```

### Baileys (4-15 seconds)

```
Phase                          Duration    Activity
────────────────────────────────────────────────────────
Load auth state from Redis     <0.1s       JSON parse
Create socket instance         0.5s        JavaScript object
Connect to servers             3-10s       WebSocket connection
Synchronize state              1-5s        Key verification
Ready event                    <1s         Local validation
────────────────────────────────────────────────────────
TOTAL                          4-15s
```

---

## Migration Decision Tree

```
                    ┌─────────────────────┐
                    │ Migrate to Baileys? │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │ Check requirements │
                    └─────────┬──────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
      Need multi-        Have Chromium    Already using
      device?         installed locally?   RemoteAuth?
            │                 │                 │
           YES               NO                YES
            │                 │                 │
            v                 v                 v
      ✓ Use Baileys    ✓ Use Baileys    ✓ Good fit for
                                         Baileys migration
                                              │
            ┌────────────────────────────────┴────────────────────────────────┐
            │ Proceed with migration                                           │
            └────────────────────────────────┬────────────────────────────────┘
                                             │
            ┌────────────────────────────────┴────────────────────────────────┐
            │ Migration Strategy                                              │
            └────┬─────────────────────┬──────────────────┬──────────────────┘
                 │                     │                  │
            Phase 1:            Phase 2:             Phase 3:
            Preparation         Integration          Testing
            (1-2 weeks)         (2-3 weeks)          (2-3 weeks)
                 │                     │                  │
                 v                     v                  v
         1. Code & tests       1. Wire up module   1. Dual run
         2. Auth store         2. Add handlers     2. Performance
         3. Docs & plan        3. Test events      3. Stability
                                4. Message send    4. Edge cases
```

---

## File Change Summary

### Files to Create
```
src/modules/common/whatsapp/
├── stores/
│   └── baileys-auth-store.ts         [NEW] Redis auth state provider
├── services/
│   └── baileys-whatsapp.service.ts   [NEW] Main Baileys service
├── baileys-whatsapp.module.ts        [NEW] NestJS module
├── whatsapp-service.factory.ts       [NEW] Strategy selector
└── tests/
    └── baileys-auth-store.spec.ts    [NEW] Unit tests

scripts/
└── migrate-to-baileys.ts             [NEW] Migration helper
```

### Files to Modify
```
src/modules/common/whatsapp/whatsapp.module.ts
  - Add BaileysWhatsAppModule to imports

src/main.ts or app.module.ts
  - Add BaileysWhatsAppModule

package.json
  - Add: "@whiskeysockets/baileys": "^6.x.x"
  - (Remove whatsapp-web.js in Phase 5)
  - (Remove puppeteer deps in Phase 5)
```

### Files NOT Changed
```
- CacheService (Redis wrapper) ✓ Reusable
- WhatsAppNotificationService ✓ Works with both
- Events/listeners ✓ Compatible
- API controllers ✓ Same interface
```

---

## Quick Start Checklist

### Pre-Migration
- [ ] Backup current Redis data
- [ ] Review current Redis keys
- [ ] Document current session size
- [ ] Plan rollback procedure

### Phase 1: Setup
- [ ] Create baileys-auth-store.ts
- [ ] Create baileys-whatsapp.service.ts
- [ ] Add BaileysAuthStore to DI
- [ ] Write unit tests
- [ ] Set WHATSAPP_STRATEGY=web.js (keep current)

### Phase 2: Integration
- [ ] Create baileys-whatsapp.module.ts
- [ ] Implement event handlers
- [ ] Test QR code flow
- [ ] Test message sending
- [ ] Set WHATSAPP_STRATEGY=auto (try Baileys first)

### Phase 3: Testing
- [ ] Run both implementations (dual-write)
- [ ] Monitor error rates
- [ ] Compare performance
- [ ] Test edge cases (disconnect, reconnect, errors)
- [ ] Load test (multiple messages)

### Phase 4: Cutover
- [ ] Set WHATSAPP_STRATEGY=baileys (primary)
- [ ] Keep fallback ready
- [ ] Monitor logs closely
- [ ] Quick rollback plan ready

### Phase 5: Cleanup
- [ ] Remove whatsapp-web.js code
- [ ] Remove Chromium dependencies
- [ ] Clean up old Redis keys
- [ ] Update documentation
- [ ] Remove fallback code

---

## Expected Performance Improvements

### Metrics to Track

```
Metric                          Current         Target        Improvement
────────────────────────────────────────────────────────────────────────
Session Size (Redis)            50-100MB        1-8MB         90-95% ↓
Startup Time                    40-70s          4-15s         5-10x ↑
Memory Usage (baseline)          300-400MB       50-100MB      4x ↓
Compression/Decompression Time  1-2s            <0.1s         20x ↑
CPU Usage (steady state)         20-30%          2-5%          5-10x ↓
Number of Docker nodes          2-3 per msg     1-2 per msg   ~2x ↑
Database connections saved      Needed          Not needed    Simpler
```

---

## Troubleshooting Guide

### Issue: "No LID for user" Error

**Current (whatsapp-web.js):**
```typescript
// Complex workaround in sendMessage()
// Using pupPage.evaluate() to force LID creation
// Can fail intermittently
```

**Baileys:**
```typescript
// Better LID handling built-in
// Rarely requires special handling
// If needed: simpler API
await socket.onWhatsApp(phone); // Pre-check
```

### Issue: Session Restore Fails

**Current:**
```
ZIP extraction error
→ Session folder corrupted
→ Requires QR scan again
```

**Baileys:**
```
Auth state parse error
→ Delete and restart
→ Much faster QR re-scan (< 15s vs 60s)
```

### Issue: Connection Drop

**Current:**
```
Chromium process killed
→ Puppeteer cleanup fails
→ Orphaned processes pile up
→ Eventually system hangs
```

**Baileys:**
```
WebSocket connection drops
→ Clean socket.end()
→ No orphaned processes
→ Immediate reconnect attempt
```

---

## Key Implementation Details

### AuthState Structure (Baileys)

```typescript
// AuthState that Baileys requires
interface AuthState {
  creds: {
    noiseKey: KeyPair;
    signedIdentityKey: KeyPair;
    signedPreKey: SignedKeyPair;
    registrationId: number;
    advSecretKey: string;
    // ... more fields
  };
  keys: {
    get: (type, jids) => Promise<{}>;
    set: (data) => Promise<void>;
  };
}
```

### Event Patterns

**Old (whatsapp-web.js):**
```typescript
client.on('remote_session_saved', async () => {
  // Save entire session folder to Redis
  // Called occasionally (every few minutes)
})

client.on('disconnected', async (reason) => {
  // Handle reconnection
})
```

**New (Baileys):**
```typescript
socket.ev.on('creds.update', async () => {
  // Save updated credentials to Redis
  // Called frequently (multiple times per minute)
})

socket.ev.on('connection.update', async (update) => {
  if (update.qr) { /* Handle QR */ }
  if (update.connection === 'open') { /* Connected */ }
  if (update.connection === 'close') { /* Disconnected */ }
})
```

---

## Cost-Benefit Analysis

### Benefits
- 5-10x faster startup (less downtime)
- 90% smaller sessions (lower Redis costs)
- Multi-device support (scale horizontally)
- No Chromium overhead (cheaper infrastructure)
- Better error isolation (more reliable)

### Costs
- Rewrite required (2-3 weeks engineering)
- Testing period (2-3 weeks concurrent run)
- Risk of breaking changes (rollback plan needed)
- New dependency: @whiskeysockets/baileys

### ROI
- **Infrastructure savings**: ~$500-1000/month (Redis, compute)
- **Engineering time**: ~160 hours (2 weeks)
- **Break-even**: ~2-3 months
- **Long-term savings**: ~$6000-12000/year

---

## References

### Current Implementation Files
- `/home/kennedy/Documents/repositories/api/src/modules/common/whatsapp/stores/redis-store.ts`
- `/home/kennedy/Documents/repositories/api/src/modules/common/whatsapp/whatsapp.service.ts`
- `/home/kennedy/Documents/repositories/api/src/modules/common/notification/whatsapp/whatsapp.service.ts`

### Documentation
- BAILEYS_MIGRATION_ANALYSIS.md (detailed analysis)
- BAILEYS_IMPLEMENTATION_GUIDE.md (code templates)
- This file (quick reference)

### External Resources
- Baileys Documentation: https://github.com/WhiskeySockets/Baileys
- whatsapp-web.js: https://github.com/pedroslopez/whatsapp-web.js

---

## Document Info

**Created:** 2025-01-25
**Type:** Quick Reference
**Status:** Ready for Implementation
**Owner:** Kennedy
**Related Documents:**
- BAILEYS_MIGRATION_ANALYSIS.md (comprehensive)
- BAILEYS_IMPLEMENTATION_GUIDE.md (code samples)
