# Baileys Data Migration Strategy

## Executive Summary

This document outlines how to migrate WhatsApp session data from whatsapp-web.js format to Baileys format. The key challenge is extracting cryptographic keys from whatsapp-web.js' IndexedDB storage and converting them to Baileys' JSON-based auth state.

---

## 1. Session Data Location & Format

### whatsapp-web.js Session Structure

**File System:**
```
.wwebjs_auth/RemoteAuth-ankaa-whatsapp/
├── Default/
│   ├── Cache/                          # Browser cache (large)
│   ├── Code Cache/                     # Compiled resources
│   ├── IndexedDB/                      # Database storage (IMPORTANT)
│   │   └── {UUID}.indexeddb.blob/      # Blob storage
│   │       ├── 1                       # Version files
│   │       └── 2
│   ├── Local Storage/                  # Key-value storage
│   │   └── chrome-extension://...      # LocalStorage DB
│   ├── Session Storage/                # Session data
│   └── [Other Chrome profile data]
├── SingletonLock                       # Process lock file
├── SingletonSocket                     # IPC socket
└── SingletonCookie                     # Cookie lock
```

### IndexedDB Content (Critical for Migration)

**Database Name:** `whatsapp`

**Object Stores:**
```
1. auth
   - Keys: "noiseKey", "signedIdentityKey", "signedPreKey", etc.
   - Values: Serialized key data

2. me
   - Contains: Phone number, JID, registered status

3. contacts
   - Contains: All contact information

4. chats
   - Contains: Chat metadata

5. messages
   - Contains: Message history (not needed for Baileys migration)

6. status_updates
   - Contains: Status update data

7. participants
   - Contains: Group participant data
```

### Redis Storage (Current)

**Key:** `whatsapp:session:ankaa-whatsapp`
**Value:** `{base64-encoded-zip-of-above-folder}`
**Size:** 50-100MB

---

## 2. Migration Approaches

### Approach A: Direct Migration (Fast but Complex)

**Pros:**
- Preserves all auth keys
- Single operation
- No downtime needed

**Cons:**
- Must parse IndexedDB format
- Error-prone with encrypted data
- Risk of corrupting keys

**Steps:**
```
1. Extract ZIP from Redis
2. Parse IndexedDB database files
3. Deserialize stored objects
4. Map to Baileys AuthState format
5. Validate and save to Redis
6. Switch service to Baileys
```

### Approach B: Clean Slate (Safe but Requires QR)

**Pros:**
- No data corruption risk
- Simpler implementation
- Guaranteed clean state

**Cons:**
- Requires new QR scan
- ~15 minute downtime
- User must verify on phone

**Steps:**
```
1. Delete old session from Redis
2. Start Baileys with empty auth state
3. User scans new QR code
4. Session automatically saved to Redis
5. Normal operation resumes
```

### Approach C: Hybrid (Recommended)

**Pros:**
- Try direct migration
- Fallback to clean slate if parsing fails
- Best of both worlds

**Cons:**
- Most complex to implement
- Requires error handling

**Steps:**
```
1. Attempt direct migration
   if (success) → use new session
   if (error) → clean slate
2. Validate migration result
3. Test before switching
4. Execute with rollback ready
```

---

## 3. Direct Migration Implementation

### 3.1 IndexedDB Parsing (SQLite-based)

```typescript
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract auth state from whatsapp-web.js IndexedDB
 */
export async function extractAuthStateFromIndexedDB(
  sessionPath: string,
): Promise<AuthenticationCreds | null> {
  try {
    // Find the IndexedDB directory
    const indexedDBPath = path.join(
      sessionPath,
      'Default',
      'IndexedDB',
    );

    if (!fs.existsSync(indexedDBPath)) {
      console.log('IndexedDB directory not found');
      return null;
    }

    // List all .db files in IndexedDB
    const files = fs.readdirSync(indexedDBPath);
    let dbFile = files.find(f => f.endsWith('.db'));

    if (!dbFile) {
      console.log('No IndexedDB database found');
      return null;
    }

    const dbPath = path.join(indexedDBPath, dbFile);

    // Open the database
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    // Query the object stores
    // In SQLite, IndexedDB is stored in 'object_store_data' table

    const authKeys = await db.all(`
      SELECT key, value
      FROM object_store_data
      WHERE object_store_id = (
        SELECT id FROM object_stores
        WHERE name = 'auth'
      )
    `);

    if (!authKeys || authKeys.length === 0) {
      console.log('No auth keys found in IndexedDB');
      await db.close();
      return null;
    }

    // Parse auth keys
    const creds = new Map<string, any>();

    for (const row of authKeys) {
      const key = row.key;
      let value = row.value;

      // Value might be base64 encoded or binary
      if (typeof value === 'string') {
        try {
          value = JSON.parse(Buffer.from(value, 'base64').toString());
        } catch {
          // Try to parse as JSON directly
          try {
            value = JSON.parse(value);
          } catch {
            // Leave as is
          }
        }
      }

      creds.set(key, value);
    }

    await db.close();

    // Convert to AuthenticationCreds format
    return convertToAuthenticationCreds(creds);
  } catch (error) {
    console.error('Failed to extract auth state:', error);
    return null;
  }
}

/**
 * Convert parsed keys to Baileys AuthenticationCreds format
 */
function convertToAuthenticationCreds(
  parsed: Map<string, any>,
): AuthenticationCreds {
  const creds: any = {};

  // Map whatsapp-web.js keys to Baileys format
  const keyMapping: Record<string, string> = {
    'noise_key': 'noiseKey',
    'signed_identity_key': 'signedIdentityKey',
    'signed_pre_key': 'signedPreKey',
    'registration_id': 'registrationId',
    'adv_secret_key': 'advSecretKey',
    'next_pre_key_id': 'nextPreKeyId',
    'first_unuploaded_pre_key_id': 'firstUnuploadedPreKeyId',
    'account_sync_counter': 'accountSyncCounter',
    'account_settings': 'accountSettings',
    'device_id': 'deviceId',
    'phone_number_country_code': 'phoneNumberCountryCode',
    'phone_number': 'phoneNumber',
    'signed_device_identity': 'signedDeviceIdentity',
    'last_disconnect_reason': 'lastDisconnectReason',
    'login_timestamp': 'loginTimestamp',
  };

  for (const [webJsKey, baileysKey] of Object.entries(keyMapping)) {
    if (parsed.has(webJsKey)) {
      creds[baileysKey] = parsed.get(webJsKey);
    }
  }

  // Ensure required fields exist with defaults
  if (!creds.noiseKey) {
    throw new Error('Missing critical key: noiseKey');
  }

  return creds as AuthenticationCreds;
}
```

### 3.2 LocalStorage Extraction

```typescript
/**
 * Extract phone number and device info from LocalStorage
 */
export async function extractPhoneInfoFromLocalStorage(
  sessionPath: string,
): Promise<{ phoneNumber: string; jid: string } | null> {
  try {
    const localStoragePath = path.join(
      sessionPath,
      'Default',
      'Local Storage',
    );

    if (!fs.existsSync(localStoragePath)) {
      return null;
    }

    // LocalStorage is stored in LevelDB format
    // This requires leveldb library to read

    // For now, we can extract from the auth state itself
    // The phone number should be in creds.phoneNumber

    return null;
  } catch (error) {
    console.error('Failed to extract phone info:', error);
    return null;
  }
}
```

### 3.3 Full Migration Function

```typescript
/**
 * Migrate entire session from whatsapp-web.js to Baileys format
 */
export async function migrateSessionToBAileys(
  sessionName: string,
  sessionPath: string,
  baileyAuthStore: BaileysAuthStore,
): Promise<{
  success: boolean;
  error?: string;
  keysExtracted?: number;
}> {
  try {
    console.log(`Starting migration for session: ${sessionName}`);

    // Step 1: Extract credentials from IndexedDB
    console.log('Step 1: Extracting credentials from IndexedDB...');
    const creds = await extractAuthStateFromIndexedDB(sessionPath);

    if (!creds) {
      return {
        success: false,
        error: 'Failed to extract credentials from IndexedDB',
      };
    }

    console.log('Step 2: Extracting cryptographic keys...');

    // Step 2: Extract session keys (these are stored separately in Baileys)
    // In whatsapp-web.js, these might be in IndexedDB with different keys
    const sessionKeys = await extractSessionKeysFromIndexedDB(sessionPath);
    const preKeys = await extractPreKeysFromIndexedDB(sessionPath);
    const senderKeys = await extractSenderKeysFromIndexedDB(sessionPath);

    // Step 3: Validate credentials
    console.log('Step 3: Validating extracted credentials...');
    const validation = validateAuthenticationCreds(creds);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.error}`,
      };
    }

    // Step 4: Save to Redis using BaileysAuthStore
    console.log('Step 4: Saving to Redis...');
    await baileyAuthStore.saveCredentials(sessionName, creds);

    // Save keys if extracted
    if (Object.keys(sessionKeys).length > 0) {
      await baileyAuthStore.saveKeys(sessionName, {
        'session': sessionKeys,
      });
    }

    if (Object.keys(preKeys).length > 0) {
      await baileyAuthStore.saveKeys(sessionName, {
        'pre-key': preKeys,
      });
    }

    if (Object.keys(senderKeys).length > 0) {
      await baileyAuthStore.saveKeys(sessionName, {
        'sender-key': senderKeys,
      });
    }

    console.log('Migration completed successfully');
    return {
      success: true,
      keysExtracted: Object.keys(sessionKeys).length + Object.keys(preKeys).length,
    };
  } catch (error) {
    console.error('Migration failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Validate that essential credentials are present
 */
function validateAuthenticationCreds(creds: AuthenticationCreds): {
  valid: boolean;
  error?: string;
} {
  const required = [
    'noiseKey',
    'signedIdentityKey',
    'signedPreKey',
    'registrationId',
    'advSecretKey',
  ];

  for (const field of required) {
    if (!creds[field]) {
      return {
        valid: false,
        error: `Missing required field: ${field}`,
      };
    }
  }

  return { valid: true };
}
```

---

## 4. Clean Slate Migration

### Simple Approach: Delete and Rescan QR

```typescript
/**
 * Clean slate migration - delete old session and require QR
 */
export async function cleanSlateMigration(
  sessionName: string,
  redisStore: RedisStore,
  baileyAuthStore: BaileysAuthStore,
): Promise<{ success: boolean; message: string }> {
  try {
    console.log('Starting clean slate migration...');

    // 1. Delete old whatsapp-web.js session
    console.log('Deleting old whatsapp-web.js session...');
    await redisStore.delete({ session: sessionName });

    // 2. Delete any existing Baileys session
    console.log('Cleaning Baileys session keys...');
    await baileyAuthStore.deleteSession(sessionName);

    // 3. Initialize new empty session
    console.log('Initializing new Baileys session...');
    const newAuthState = await baileyAuthStore.initializeNewSession(sessionName);

    if (!newAuthState) {
      return {
        success: false,
        message: 'Failed to initialize new session',
      };
    }

    console.log('Clean slate migration completed');
    console.log('Next startup will require QR code scan');

    return {
      success: true,
      message: 'Session cleared. User must scan QR code on next startup.',
    };
  } catch (error) {
    return {
      success: false,
      message: `Migration failed: ${error.message}`,
    };
  }
}
```

---

## 5. Hybrid Migration Script

```typescript
/**
 * Hybrid approach: Try migration, fallback to clean slate
 *
 * Usage:
 *   npx ts-node scripts/hybrid-migration.ts \
 *     --session-name=ankaa-whatsapp \
 *     --session-path=.wwebjs_auth
 */

import * as path from 'path';
import * as fs from 'fs';

async function hybridMigration() {
  const sessionName = process.argv.find(arg =>
    arg.startsWith('--session-name='),
  )?.split('=')[1] || 'ankaa-whatsapp';

  const sessionPath = process.argv.find(arg =>
    arg.startsWith('--session-path='),
  )?.split('=')[1] || '.wwebjs_auth';

  const fullPath = path.join(sessionPath, `RemoteAuth-${sessionName}`);

  console.log(`=== Hybrid Migration Tool ===`);
  console.log(`Session: ${sessionName}`);
  console.log(`Path: ${fullPath}`);
  console.log('');

  if (!fs.existsSync(fullPath)) {
    console.error(`Session folder not found: ${fullPath}`);
    process.exit(1);
  }

  // Initialize services (in real implementation)
  const redisStore = new RedisStore(/* ... */);
  const baileyAuthStore = new BaileysAuthStore(/* ... */);

  try {
    // First, try to extract from ZIP in Redis
    console.log('Step 1: Checking Redis for existing session...');
    const redisExists = await redisStore.sessionExists({ session: sessionName });

    if (!redisExists) {
      console.log('No session in Redis. Using local folder.');
    } else {
      console.log('Found session in Redis, extracting...');
      await redisStore.extract({ session: sessionName });
    }

    // Try direct migration
    console.log('\nStep 2: Attempting direct migration...');
    const migrationResult = await migrateSessionToBAileys(
      sessionName,
      fullPath,
      baileyAuthStore,
    );

    if (migrationResult.success) {
      console.log('\n✓ Direct migration successful!');
      console.log(`  Keys extracted: ${migrationResult.keysExtracted}`);
      console.log('\nNext steps:');
      console.log('  1. Set WHATSAPP_STRATEGY=baileys');
      console.log('  2. Restart application');
      console.log('  3. Verify connection works');
      process.exit(0);
    }

    console.log('\n✗ Direct migration failed:', migrationResult.error);
    console.log('  Attempting clean slate...');

    // Fallback to clean slate
    const cleanResult = await cleanSlateMigration(
      sessionName,
      redisStore,
      baileyAuthStore,
    );

    if (cleanResult.success) {
      console.log('\n✓ Clean slate migration successful');
      console.log(cleanResult.message);
      console.log('\nNext steps:');
      console.log('  1. Set WHATSAPP_STRATEGY=baileys');
      console.log('  2. Restart application');
      console.log('  3. Scan QR code when prompted');
      process.exit(0);
    }

    console.error('\n✗ Both migrations failed');
    console.error(cleanResult.message);
    process.exit(1);
  } catch (error) {
    console.error('\n✗ Unexpected error:', error);
    process.exit(1);
  }
}

hybridMigration();
```

---

## 6. Validation & Testing

### Pre-Migration Checks

```typescript
/**
 * Validate that session is ready for migration
 */
export async function validateSessionReadiness(
  sessionName: string,
  sessionPath: string,
  redisStore: RedisStore,
): Promise<{
  isValid: boolean;
  checks: Record<string, boolean>;
  errors: string[];
}> {
  const checks: Record<string, boolean> = {};
  const errors: string[] = [];

  // Check 1: Session folder exists
  checks.folderExists = fs.existsSync(sessionPath);
  if (!checks.folderExists) {
    errors.push('Session folder not found');
  }

  // Check 2: IndexedDB exists
  const indexedDBPath = path.join(sessionPath, 'Default', 'IndexedDB');
  checks.indexedDBExists = fs.existsSync(indexedDBPath);
  if (!checks.indexedDBExists) {
    errors.push('IndexedDB not found - session may not be initialized');
  }

  // Check 3: Session in Redis
  const inRedis = await redisStore.sessionExists({ session: sessionName });
  checks.inRedis = inRedis;
  if (!inRedis) {
    errors.push('Session not backed up in Redis');
  }

  // Check 4: Folder is not too large
  const folderSize = calculateFolderSize(sessionPath);
  checks.sizeReasonable = folderSize < 1_000_000_000; // 1GB max
  if (!checks.sizeReasonable) {
    errors.push(`Folder too large: ${formatBytes(folderSize)}`);
  }

  // Check 5: No lock files
  const lockFiles = findLockFiles(sessionPath);
  checks.noLockFiles = lockFiles.length === 0;
  if (!checks.noLockFiles) {
    errors.push(`Found ${lockFiles.length} lock files - session may be in use`);
  }

  return {
    isValid: errors.length === 0,
    checks,
    errors,
  };
}

function calculateFolderSize(dir: string): number {
  let size = 0;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      size += calculateFolderSize(filePath);
    } else {
      size += stat.size;
    }
  }

  return size;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function findLockFiles(dir: string): string[] {
  const lockFiles: string[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    if (
      file === 'SingletonLock' ||
      file === 'SingletonSocket' ||
      file === 'SingletonCookie'
    ) {
      lockFiles.push(path.join(dir, file));
    }

    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      lockFiles.push(...findLockFiles(filePath));
    }
  }

  return lockFiles;
}
```

### Post-Migration Verification

```typescript
/**
 * Verify that migrated session works
 */
export async function verifyMigratedSession(
  sessionName: string,
  baileyAuthStore: BaileysAuthStore,
): Promise<{
  verified: boolean;
  checks: Record<string, boolean>;
  errors: string[];
}> {
  const checks: Record<string, boolean> = {};
  const errors: string[] = [];

  // Check 1: Session exists
  const exists = await baileyAuthStore.sessionExists(sessionName);
  checks.sessionExists = exists;
  if (!exists) {
    errors.push('Session not found after migration');
    return { verified: false, checks, errors };
  }

  // Check 2: Can load auth state
  try {
    const authState = await baileyAuthStore.getAuthState(sessionName);
    checks.authStateLoadable = !!authState;
    if (!authState) {
      errors.push('Could not load auth state');
    }
  } catch (error) {
    checks.authStateLoadable = false;
    errors.push(`Failed to load auth state: ${error.message}`);
  }

  // Check 3: Credentials are complete
  if (checks.authStateLoadable) {
    const authState = await baileyAuthStore.getAuthState(sessionName);
    const requiredFields = [
      'noiseKey',
      'signedIdentityKey',
      'signedPreKey',
    ];

    checks.credentialsComplete = requiredFields.every(
      field => !!authState?.creds[field],
    );

    if (!checks.credentialsComplete) {
      const missing = requiredFields.filter(f => !authState?.creds[f]);
      errors.push(`Missing credential fields: ${missing.join(', ')}`);
    }
  }

  return {
    verified: errors.length === 0,
    checks,
    errors,
  };
}
```

---

## 7. Rollback Plan

### If Direct Migration Fails

```typescript
/**
 * Rollback: Restore from backup
 */
export async function rollbackMigration(
  sessionName: string,
  backupRedisKey: string,
  cacheService: CacheService,
): Promise<{ success: boolean; message: string }> {
  try {
    console.log('Attempting rollback...');

    // Restore from Redis backup (old session)
    const backupData = await cacheService.get<string>(backupRedisKey);

    if (!backupData) {
      return {
        success: false,
        message: 'No backup found for rollback',
      };
    }

    // Restore the session
    await cacheService.set(
      `whatsapp:session:${sessionName}`,
      backupData,
      60 * 60 * 24 * 30,
    );

    console.log('Rollback completed');
    return {
      success: true,
      message: 'Session restored from backup. Restart with WHATSAPP_STRATEGY=web.js',
    };
  } catch (error) {
    return {
      success: false,
      message: `Rollback failed: ${error.message}`,
    };
  }
}
```

---

## 8. Migration Checklist

### Before Migration

- [ ] Backup Redis entirely (`redis-cli --rdb`)
- [ ] Document current session size
- [ ] Ensure no active messages being sent
- [ ] Plan maintenance window (15 minutes)
- [ ] Have rollback Redis key saved
- [ ] Verify Baileys implementation is ready
- [ ] Test Baileys locally first

### During Migration

- [ ] Run `validateSessionReadiness()`
- [ ] Attempt migration (direct or clean slate)
- [ ] Run `verifyMigratedSession()`
- [ ] Set `WHATSAPP_STRATEGY=baileys`
- [ ] Restart application
- [ ] Verify QR code works (if clean slate)
- [ ] Send test message

### After Migration

- [ ] Monitor logs for errors
- [ ] Test message sending
- [ ] Verify callbacks work
- [ ] Check session size (should be <10MB)
- [ ] Monitor resource usage (should be lower)
- [ ] Keep web.js as fallback for 1 week
- [ ] Document any issues

---

## 9. Decision Matrix

### When to Use Each Approach

| Scenario | Recommendation |
|----------|---|
| Session < 100MB, accessible via web.js | Direct Migration |
| Session > 500MB or file system issues | Clean Slate |
| Production environment, high availability needed | Hybrid (fallback) |
| Development/testing | Either (test both) |
| Time-constrained | Clean Slate |
| Trying to preserve data | Direct Migration |

---

## 10. Implementation Roadmap

**Week 1: Preparation**
- Implement validation functions
- Create backup/restore utilities
- Write tests for migration logic
- Document rollback procedure

**Week 2: Direct Migration**
- Implement IndexedDB parsing
- Test with local session
- Handle edge cases
- Create hybrid wrapper

**Week 3: Testing**
- Test direct migration
- Test clean slate
- Test rollback
- Production dry-run

**Week 4: Execution**
- Schedule maintenance window
- Execute migration
- Monitor
- Transition to Baileys service

---

**Document Version:** 1.0
**Created:** 2025-01-25
**Status:** Ready for Implementation
