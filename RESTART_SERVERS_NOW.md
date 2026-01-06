# 🔴 RESTART REQUIRED - Servers Running Old Code

## Current Status

Both fixes are IN THE CODEBASE but NOT LOADED in memory:

✅ **WhatsApp userId fix** - Code updated but backend not restarted
✅ **Frontend cache initialization fix** - Code updated but frontend may not have hot-reloaded

## Evidence from Your Logs

```
Processing WhatsApp notification 85ac4437-36d1-4adf-b10c-7c59e4f26a95 for user undefined
                                                                              ^^^^^^^^^
                                                                              STILL UNDEFINED!
```

The backend is still running code WITHOUT the userId parameter.

---

## Step 1: Restart Backend ⚠️ CRITICAL

```bash
# In the terminal running the backend, press Ctrl+C to stop it
# Then restart:
cd /home/kennedy/Documents/repositories/api
npm run start:dev
```

**What this will fix:**
- WhatsApp notifications will include userId
- No more "User ID is required for WhatsApp notifications" errors

---

## Step 2: Restart Frontend (if needed)

If the frontend didn't hot-reload automatically:

```bash
# In the terminal running the frontend, press Ctrl+C to stop it
# Then restart:
cd /home/kennedy/Documents/repositories/web
npm run dev
```

**What this will fix:**
- Notifications will appear immediately in notification center
- No more "Nenhuma notificação" when notifications exist
- Badge count will match displayed notifications

---

## Step 3: Test After Restart

### Test 1: Clear Browser Cache & Reload
```
1. Open DevTools (F12)
2. Right-click the reload button
3. Select "Empty Cache and Hard Reload"
```

### Test 2: Create New Notification
```
1. Create notification for 2 users (including yourself)
2. Check:
   ✅ Badge shows 1 (not 2)
   ✅ Opening notification center shows 1 notification immediately
   ✅ WhatsApp logs show: "Adding WhatsApp job... to 43*******03"
   ✅ No "User ID is required" error
   ✅ Logs show: "for user 345cd001-37de-469b-a184-fb0e729d4401" (not undefined)
```

---

## Why Badge Showed "2" Before

The success toast "2 notificações enviadas com sucesso" is correct - you created 2 notifications (one for each user).

But YOUR badge should only show 1 (the one for you), not 2.

If you're seeing both notifications, there might be an additional bug where the query is not filtering by userId properly. We'll know after the restart.

---

## What to Check in Logs After Restart

### ✅ Good WhatsApp Log:
```
Adding WhatsApp job for notification [id] to 43*******03
Processing WhatsApp notification [id] for user 345cd001-37de-469b-a184-fb0e729d4401
                                                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                 SHOULD NOT BE "undefined"
```

### ✅ Good Frontend Log (in browser console):
```
[NotificationCenter] New notification received: [id]
[NotificationCenter] Initializing cache with new notification: [id]
```

OR if cache already exists:
```
[NotificationCenter] New notification received: [id]
(cache updated without "Initializing" message)
```

---

## RESTART NOW

**Do NOT create any more notifications until AFTER restarting both servers.**

The fixes are ready in the code - they just need to be loaded into memory.
