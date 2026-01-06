# Stock/Inventory Notification Integration

## Overview

This document describes the integration of notification triggers for stock/inventory events. The system automatically sends notifications to users with ADMIN and WAREHOUSE privileges when stock levels cross critical thresholds.

## Architecture

### Components

1. **StockNotificationService** (`stock-notification.service.ts`)
   - Core service responsible for stock event notifications
   - Implements threshold-based notification logic
   - Manages notification deduplication to prevent spam
   - Targets users with ADMIN/WAREHOUSE privileges

2. **AtomicStockUpdateService** (`atomic-stock-update.service.ts`)
   - Stock management service that triggers notifications
   - Integrates with StockNotificationService
   - Calls notification service during stock updates

3. **NotificationService** (`notification.service.ts`)
   - Core notification infrastructure
   - Handles notification creation and dispatch
   - Manages user preferences and channels

## Integration Points

### 1. AtomicStockUpdateService

**File:** `/home/kennedy/Documents/repositories/api/src/modules/inventory/services/atomic-stock-update.service.ts`

**Integration Location:** Line 399-421 in `createStockNotifications()` method

**Dependencies Added:**
```typescript
import { StockNotificationService } from './stock-notification.service';

constructor(
  private readonly calculator: AtomicStockCalculatorService,
  private readonly changeLogService: ChangeLogService,
  private readonly stockNotificationService: StockNotificationService,
) {}
```

**Trigger Point:**
```typescript
// Step 4: Create stock level notifications if needed
await this.createStockNotifications(plan, result, tx);
```

This is called within `executeAtomicUpdate()` after:
- Item quantities are updated
- Order items are updated
- Order statuses are updated

And before the transaction is committed.

### 2. StockNotificationService

**File:** `/home/kennedy/Documents/repositories/api/src/modules/inventory/services/stock-notification.service.ts`

**Main Entry Point:**
```typescript
async processStockNotifications(
  calculations: StockCalculationResult[],
  tx: PrismaTransaction,
): Promise<number>
```

**Called by:** `AtomicStockUpdateService.createStockNotifications()`

## Notification Events

### Event Types

The system triggers notifications for four types of stock events:

1. **OUT_OF_STOCK** (`out`)
   - Triggered when: `finalQuantity === 0 && currentQuantity > 0`
   - Importance: HIGH
   - Message: "Estoque Esgotado - [Item] está sem estoque. Reposição urgente necessária."

2. **CRITICAL** (`critical`)
   - Triggered when: `stockLevel === STOCK_LEVEL.CRITICAL`
   - Threshold: quantity <= 90% of reorder point
   - Importance: HIGH
   - Message: "Estoque Crítico - [Item] atingiu nível crítico. Reposição recomendada."

3. **LOW** (`low`)
   - Triggered when: `stockLevel === STOCK_LEVEL.LOW`
   - Threshold: 90% < quantity <= 110% of reorder point
   - Importance: NORMAL
   - Message: "Estoque Baixo - [Item] está com estoque baixo. Considere reposição."

4. **REPLENISHED** (`restock`)
   - Triggered when: `finalQuantity > currentQuantity && stockLevel === OPTIMAL && currentQuantity < reorderPoint`
   - Importance: LOW
   - Message: "Estoque Reabastecido - [Item] foi reabastecido."

## Threshold Logic

### Stock Level Calculation

Stock levels are calculated by `determineStockLevel()` in `/home/kennedy/Documents/repositories/api/src/utils/stock-level.ts`:

```typescript
// Base thresholds
const CRITICAL_THRESHOLD = 0.9; // 90% of reorder point
const LOW_THRESHOLD = 1.1;      // 110% of reorder point

// Adjusted if there's an active order
const adjustmentFactor = hasActiveOrder ? 1.5 : 1;
const adjustedCriticalThreshold = reorderPoint * 0.9 * adjustmentFactor;
const adjustedLowThreshold = reorderPoint * 1.1 * adjustmentFactor;
```

### Decision Tree

```
Is quantity === 0?
├─ Yes → OUT_OF_STOCK
└─ No
   └─ Is quantity <= (reorderPoint * 0.9)?
      ├─ Yes → CRITICAL
      └─ No
         └─ Is quantity <= (reorderPoint * 1.1)?
            ├─ Yes → LOW
            └─ No
               └─ Is quantity > currentQuantity && currentQuantity < reorderPoint?
                  ├─ Yes → REPLENISHED
                  └─ No → No notification
```

### Spam Prevention

To prevent notification spam on every stock decrement/increment:

1. **Cooldown Period:** 5 minutes (configurable)
   - After sending a notification for an item/event, the system won't send another identical notification for 5 minutes
   - Each item-event combination is tracked separately

2. **In-Memory Cache:**
   - Key: `{itemId}-{eventType}` (e.g., "abc123-critical")
   - Value: timestamp of last notification
   - Cache cleanup: entries older than 1 hour are removed

3. **Example:**
   - Stock drops to critical level (90 units) → Notification sent
   - Stock drops again to 85 units → No notification (within cooldown)
   - Stock drops to 80 units → No notification (within cooldown)
   - After 5 minutes, stock drops to 75 units → Notification sent

## User Targeting

### Target Roles

Notifications are sent to users with:
- **ADMIN** role
- **WAREHOUSE** role

### User Selection Criteria

```typescript
const targetUsers = await tx.user.findMany({
  where: {
    isActive: true,
    status: { not: 'DISMISSED' },
    OR: [
      {
        sector: {
          privileges: {
            hasSome: [USER_ROLE.ADMIN, USER_ROLE.WAREHOUSE],
          },
        },
      },
    ],
  },
});
```

### User Preferences

These are **OPTIONAL** notifications - users can:
- Enable/disable stock notifications in their preferences
- Choose which channels to receive notifications on (EMAIL, IN_APP, PUSH, etc.)

Default preferences (defined in `notification-preference.service.ts`):
```typescript
// STOCK - LOW
{
  type: NOTIFICATION_TYPE.STOCK,
  eventType: 'low',
  channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  mandatory: false,
}

// STOCK - OUT
{
  type: NOTIFICATION_TYPE.STOCK,
  eventType: 'out',
  channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  mandatory: false,
}

// STOCK - RESTOCK
{
  type: NOTIFICATION_TYPE.STOCK,
  eventType: 'restock',
  channels: [NOTIFICATION_CHANNEL.IN_APP],
  mandatory: false,
}
```

## Notification Payload

### Notification Fields

```typescript
{
  userId: string,              // Target user ID
  title: string,               // Event-specific title
  body: string,                // Detailed description
  type: NOTIFICATION_TYPE.STOCK,
  channel: [
    NOTIFICATION_CHANNEL.IN_APP,
    NOTIFICATION_CHANNEL.EMAIL,
  ],
  importance: NOTIFICATION_IMPORTANCE, // HIGH, NORMAL, or LOW
  actionType: string,          // Event type: 'low', 'critical', 'out', 'restock'
  actionUrl: string,           // Deep link to item details
  metadata: StockNotificationMetadata
}
```

### Metadata Structure

```typescript
interface StockNotificationMetadata {
  itemId: string;              // Item unique identifier
  itemName: string;            // Display name
  itemCode: string | null;     // SKU/code if available
  currentQuantity: number;     // Quantity after update
  previousQuantity: number;    // Quantity before update
  reorderPoint: number | null; // Configured reorder threshold
  criticalThreshold: number | null;  // Calculated: reorderPoint * 0.9
  lowThreshold: number | null;       // Calculated: reorderPoint * 1.1
  stockLevel: STOCK_LEVEL;     // Current stock level enum
  warehouse: string | null;    // Warehouse name if applicable
  category: string | null;     // Product category
  brand: string | null;        // Product brand
  eventType: STOCK_EVENT_TYPE; // 'low', 'critical', 'out', 'restock'
  triggeredAt: Date;           // Event timestamp
}
```

### Deep Links

Format: `/estoque/itens/detalhes/{itemId}`

Example: `/estoque/itens/detalhes/cm4ph98g70001m4zdzugl70yt`

This allows users to click the notification and navigate directly to the item detail page in the frontend application.

## Example Notification Messages

### Out of Stock
```
Title: Estoque Esgotado
Body: Tinta Branca Premium (SKU-001) em Depósito Central está sem estoque.
      Quantidade: 0 unidades (Ponto de reposição: 50).
      Reposição urgente necessária.
```

### Critical Level
```
Title: Estoque Crítico
Body: Tinta Azul Marinho (SKU-042) em Depósito Sul atingiu nível crítico.
      Quantidade: 15 unidades (Ponto de reposição: 30).
      Reposição recomendada.
```

### Low Level
```
Title: Estoque Baixo
Body: Primer Acrílico (SKU-123) em Depósito Norte está com estoque baixo.
      Quantidade: 35 unidades (Ponto de reposição: 30).
      Considere reposição.
```

### Replenished
```
Title: Estoque Reabastecido
Body: Verniz Fosco (SKU-089) em Depósito Central foi reabastecido.
      Quantidade atual: 75 unidades (Ponto de reposição: 40).
```

## Configuration

### Threshold Constants

**File:** `/home/kennedy/Documents/repositories/api/src/constants/stock-thresholds.ts`

```typescript
export const CRITICAL_THRESHOLD = 0.9; // 10% below reorder point
export const LOW_THRESHOLD = 1.1;      // 10% above reorder point
```

### Cooldown Period

**File:** `/home/kennedy/Documents/repositories/api/src/modules/inventory/services/stock-notification.service.ts`

```typescript
// Cooldown period in milliseconds (5 minutes)
private readonly NOTIFICATION_COOLDOWN = 5 * 60 * 1000;
```

To change the cooldown period, modify this constant:
- 1 minute: `1 * 60 * 1000`
- 10 minutes: `10 * 60 * 1000`
- 30 minutes: `30 * 60 * 1000`

## Testing & Monitoring

### Cache Statistics

Get current cache status:

```typescript
const stats = stockNotificationService.getCacheStats();
// Returns:
{
  size: number,
  entries: [
    {
      itemId: string,
      eventType: string,
      lastNotified: Date
    }
  ]
}
```

### Manual Cache Control

```typescript
// Clear cache for specific item (force new notifications)
stockNotificationService.clearCacheForItem(itemId);

// Clear entire cache
stockNotificationService.clearCache();
```

### Testing Scenarios

1. **Test Critical Level:**
   - Set item with reorderPoint = 100
   - Reduce quantity to 90 or below
   - Verify HIGH importance notification sent to ADMIN/WAREHOUSE users

2. **Test Spam Prevention:**
   - Trigger same event twice within 5 minutes
   - Verify only one notification is created

3. **Test Multiple Events:**
   - Drop to LOW level → verify notification
   - Drop to CRITICAL level → verify new notification (different event type)
   - Replenish to OPTIMAL → verify restock notification

4. **Test User Preferences:**
   - Disable stock notifications for a test user
   - Trigger stock event
   - Verify user doesn't receive notification

## Error Handling

### Non-Blocking Errors

Notification errors do NOT fail the stock transaction:

```typescript
try {
  await this.stockNotificationService.processStockNotifications(plan.calculations, tx);
} catch (error) {
  // Log error but don't fail the transaction
  this.logger.error('Error creating stock notifications:', error);
}
```

This ensures that:
- Stock updates complete successfully even if notifications fail
- Data integrity is preserved
- Users are warned via logs about notification failures

### Error Recovery

If notification creation fails for one user, the system continues processing other users:

```typescript
for (const user of targetUsers) {
  try {
    await this.notificationService.createNotification(...);
  } catch (error) {
    this.logger.error(`Failed to create notification for user ${user.id}`);
    // Continue with other users
  }
}
```

## Performance Considerations

1. **In-Memory Cache:** Minimal overhead, O(1) lookups
2. **Batch Processing:** All notifications created within the same transaction
3. **Async Dispatch:** Notifications are queued for async delivery (EMAIL, SMS, etc.)
4. **Target User Query:** Single query fetches all ADMIN/WAREHOUSE users
5. **Item Details Query:** Single query per item within transaction

### Optimization Tips

- Cache is automatically cleaned every hour
- Notifications are created in parallel for multiple users
- Transaction commits before notifications are dispatched
- Heavy operations (email sending) happen asynchronously

## Dependencies

### Module Dependencies

```typescript
// Required services
- NotificationService (from @modules/common/notification)
- PrismaService (from @modules/common/prisma)

// Required in module providers
{
  provide: StockNotificationService,
  useClass: StockNotificationService,
}

// Injection in AtomicStockUpdateService
constructor(
  private readonly stockNotificationService: StockNotificationService,
)
```

### Database Dependencies

Requires these Prisma models:
- `User` - with sector and privileges
- `Item` - with stock levels and thresholds
- `Notification` - for storing notifications
- `UserNotificationPreference` - for user preferences

## Future Enhancements

Potential improvements:

1. **Batch Notifications:** Aggregate multiple stock events into digest emails
2. **Escalation:** Send escalated notifications if critical stock persists
3. **Predictive Alerts:** Warn before reaching thresholds based on usage trends
4. **Custom Thresholds:** Per-item threshold overrides
5. **Warehouse-Specific Routing:** Route notifications to warehouse-specific users
6. **SMS/WhatsApp:** Add SMS/WhatsApp channels for urgent notifications
7. **Analytics:** Track notification effectiveness and response times

## Troubleshooting

### No Notifications Being Created

1. Check if users have ADMIN/WAREHOUSE privileges
2. Verify reorderPoint is set on items
3. Check user notification preferences
4. Review cooldown cache (may be preventing duplicates)
5. Check logs for error messages

### Too Many Notifications

1. Increase NOTIFICATION_COOLDOWN period
2. Adjust threshold values (CRITICAL_THRESHOLD, LOW_THRESHOLD)
3. Review event determination logic

### Notifications to Wrong Users

1. Verify user sector privileges query
2. Check user isActive and status fields
3. Review target user selection criteria

## Summary

The stock notification integration provides:

- ✅ Automatic threshold-based notifications
- ✅ Four event types (out, critical, low, replenished)
- ✅ Smart spam prevention with cooldown
- ✅ Role-based targeting (ADMIN, WAREHOUSE)
- ✅ User preference support (OPTIONAL notifications)
- ✅ Rich metadata with product details
- ✅ Deep links to product pages
- ✅ Non-blocking error handling
- ✅ Transaction-safe implementation
- ✅ Minimal performance overhead

For questions or issues, contact the development team.
