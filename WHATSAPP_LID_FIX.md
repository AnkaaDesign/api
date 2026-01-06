# WhatsApp "No LID for user" Fix

## Problem

WhatsApp Web.js was failing with "No LID for user" error when trying to send messages:

```
Error: No LID for user
at Client.sendMessage
```

**Phone number**: 5543991815689 (Brazilian mobile - verified correct format)

## Root Cause

WhatsApp Web.js uses LID (Local IDentifier) to identify contacts. When a phone number hasn't been:
1. Previously messaged via this WhatsApp Web session
2. Synced to the WhatsApp account's contacts
3. Seen in any chat history

...the library doesn't have a LID cached for that number, causing the send to fail.

## Solution

Use WhatsApp's `getNumberId()` method before sending messages. This method:
1. Queries WhatsApp servers for the number's WhatsApp ID
2. Establishes the LID in the local cache
3. Returns the proper serialized ID to use for sending

### Code Changes

**File**: `api/src/modules/common/whatsapp/whatsapp.service.ts`

**Before**:
```typescript
const chatId = `${cleanPhone}@c.us`;
await this.client.sendMessage(chatId, message);
```

**After**:
```typescript
// Get the WhatsApp ID first (establishes LID)
let whatsappId = chatId;
try {
  const numberId = await this.client.getNumberId(cleanPhone);
  if (numberId) {
    whatsappId = numberId._serialized;
  }
} catch (error) {
  // Fallback to chat ID format
}

// Send using the proper WhatsApp ID
await this.client.sendMessage(whatsappId, message);
```

## Testing

**Restart the API** and try sending a WhatsApp notification again:

```bash
cd /home/kennedy/Documents/repositories/api
pm2 restart api
```

Create a notification with WhatsApp channel - it should now:
1. Query WhatsApp for the number's ID
2. Establish the LID in cache
3. Send the message successfully

## Expected Logs

You should see:
```
[WhatsAppService] Sending message to 5543991815689
[WhatsAppService] Got WhatsApp ID for 5543991815689: 5543991815689@c.us
[WhatsAppService] Message sent successfully to 5543991815689
```

## Fallback Behavior

If `getNumberId()` fails, the code falls back to using the standard chat ID format (`{number}@c.us`) and attempts to send anyway.

## Alternative Solutions (if this doesn't work)

1. **Manual Contact Sync**: Send a message manually to the number via WhatsApp Web first
2. **Add to Contacts**: Add the number to your phone's contacts and sync
3. **WhatsApp Business API**: Use the official Business API (no LID requirement)
4. **Restart WhatsApp Session**: Disconnect and reconnect WhatsApp Web.js client

---

Generated: 2026-01-06
