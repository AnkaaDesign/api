# Auto-Order & Scheduled Order Coordination Workflow

## Overview

This document explains the intelligent coordination between **Auto Orders** (system-generated) and **Scheduled Orders** (user-planned) to prevent conflicts while ensuring stock availability.

## Hierarchical Priority System

```
Priority 1: CRITICAL EMERGENCY
  ├─ Stock = 0 (out of stock)
  ├─ Will stockout before scheduled order arrives
  └─ Action: Auto-order IMMEDIATELY, even if in schedule

Priority 2: SCHEDULED ORDERS (User Planning)
  ├─ Items in active schedules
  ├─ Recurring orders at planned intervals
  └─ Action: Defer to schedule if delivery is timely

Priority 3: AUTO ORDERS (Intelligent Gap-Filling)
  ├─ Items NOT in schedules
  ├─ Items where schedule won't arrive in time
  └─ Action: Auto-order based on consumption analysis
```

## Workflow Logic

### 1. Scheduled Order Analysis (Primary)

When an item is in an active order schedule:

```typescript
// Calculate if scheduled order will arrive in time
daysUntilScheduledOrder = scheduledDate - today
daysUntilScheduledDelivery = daysUntilScheduledOrder + leadTime

// Calculate when stock will run out
daysUntilStockout = currentStock / dailyConsumption

// Decision logic
if (daysUntilStockout > daysUntilScheduledDelivery) {
  // Stock will last until scheduled order arrives
  → DEFER TO SCHEDULE (no auto-order)
  → Log: "Covered by schedule"

} else {
  // Stock will run out before scheduled order
  → CREATE EMERGENCY AUTO-ORDER
  → Log: "⚠️ EMERGENCY: Stockout before schedule"
  → Urgency: CRITICAL
}
```

### 2. Auto Order Analysis (Secondary)

For items NOT in schedules OR emergency cases:

```typescript
// Weighted monthly consumption (recent months weighted more)
weight(month) = e^(-monthsAgo / 3)
// Current month: weight = 1.0
// 3 months ago: weight = 0.37
// 6 months ago: weight = 0.14

monthlyConsumption = Σ(consumption[month] × weight[month]) / Σ(weight[month])

// Trend detection (compare recent 3 months vs older 3 months)
recentAvg = avg(last 3 months)
olderAvg = avg(months 4-6)
trendChange = (recentAvg - olderAvg) / olderAvg × 100

if (trendChange > 20%) → trend = 'increasing'
if (trendChange < -20%) → trend = 'decreasing'
else → trend = 'stable'

// Trend-adjusted order quantity
trendMultiplier = {
  increasing: 1.0 + min(trendChange/100, 0.5),  // Max 50% increase
  stable: 1.0,
  decreasing: max(0.7, 1.0 + trendChange/100)   // Min 70% of normal
}

orderQuantity = (leadTimeConsumption + bufferConsumption) × trendMultiplier
```

### 3. Duplicate Prevention Logic

```typescript
// Check last order date
if (daysSinceLastOrder < 30 AND currentStock > reorderPoint × 0.5) {
  → SKIP (prevent duplicate)
  → Log: "Ordered recently, not critical"

} else if (daysSinceLastOrder < 30 AND currentStock ≤ reorderPoint × 0.5) {
  → ALLOW AUTO-ORDER (critical override)
  → Log: "Critical stock despite recent order"
}
```

### 4. Complete Decision Tree

```
For each item:
  │
  ├─ Is stock = 0?
  │  └─ YES → AUTO-ORDER (Priority 1: Emergency)
  │
  ├─ Is item in active schedule?
  │  ├─ YES:
  │  │  ├─ Will stockout before scheduled delivery?
  │  │  │  ├─ YES → AUTO-ORDER with ⚠️ EMERGENCY flag
  │  │  │  └─ NO → SKIP (defer to schedule)
  │  │  │
  │  └─ NO:
  │     ├─ Ordered within 30 days?
  │     │  ├─ YES:
  │     │  │  ├─ Stock critical (<50% reorder point)?
  │     │  │  │  ├─ YES → AUTO-ORDER (critical override)
  │     │  │  │  └─ NO → SKIP (prevent duplicate)
  │     │  │
  │     │  └─ NO:
  │     │     ├─ Stock ≤ reorder point?
  │     │     │  └─ YES → AUTO-ORDER (normal flow)
  │     │     │
  │     │     └─ Stock approaching reorder AND stockout < leadTime?
  │     │        └─ YES → AUTO-ORDER (preventive)
  │
  └─ Calculate order quantity based on:
     - Monthly consumption (weighted)
     - Demand trend (increasing/stable/decreasing)
     - Lead time
     - Manual overrides (maxQuantity, reorderQuantity)
```

## Manual Override Respect

### Max Quantity Override

```typescript
if (isManualMaxQuantity === true) {
  // User manually set this value - respect it
  targetQuantity = min(calculatedQuantity, maxQuantity - currentStock)

  if (calculatedQuantity > maxQuantity - currentStock) {
    → Log WARNING: "Manual maxQuantity may be insufficient for demand trend"
    → Still respect user's decision
  }

} else {
  // System can auto-adjust
  if (trend === 'increasing') {
    → Consider increasing maxQuantity automatically
  }
}
```

### Reorder Point Override

```typescript
if (isManualReorderPoint === true) {
  // User manually set - do not auto-update
  → Use user's value
  → Log: "Using manual reorder point"

} else {
  // Auto-calculate based on consumption
  newReorderPoint = avgDailyConsumption × leadTime × (1 + safetyFactor)

  if (abs(newReorderPoint - currentReorderPoint) / currentReorderPoint > 0.10) {
    → Update reorder point
    → Log change to changelog
  }
}
```

## Examples

### Example 1: Normal Scheduled Order

```
Item: Tinta Branca
Current Stock: 50 units
Reorder Point: 30 units
Monthly Consumption: 20 units/month
Lead Time: 15 days
Scheduled Order: Next run in 10 days

Calculation:
- Daily consumption: 20/30 = 0.67 units/day
- Days until stockout: 50/0.67 = 75 days
- Days until scheduled delivery: 10 + 15 = 25 days
- Stock will last? YES (75 > 25)

Decision: SKIP auto-order (covered by schedule)
```

### Example 2: Emergency Override

```
Item: Tinta Vermelha
Current Stock: 10 units
Reorder Point: 30 units
Monthly Consumption: 60 units/month (INCREASING TREND +40%)
Lead Time: 20 days
Scheduled Order: Next run in 15 days

Calculation:
- Daily consumption: 60/30 = 2 units/day
- Days until stockout: 10/2 = 5 days
- Days until scheduled delivery: 15 + 20 = 35 days
- Stock will last? NO (5 < 35)

Decision: ⚠️ EMERGENCY AUTO-ORDER
Reason: "Will stockout in 5 days, scheduled order not until 35 days"
Quantity: Adjusted for +40% demand trend
```

### Example 3: Increasing Demand Adjustment

```
Item: Tinta Azul (NO SCHEDULE)
Current Stock: 40 units
Monthly Consumption: 30 units/month (INCREASING +35%)
Trend: Last 3 months avg = 35, Previous 3 months avg = 25
Lead Time: 15 days
Last Order: 45 days ago

Calculation:
- Weighted monthly: 32 units (recent months weighted more)
- Trend multiplier: 1.0 + min(0.35, 0.5) = 1.35
- Daily consumption: 32/30 = 1.07 units/day
- Lead time consumption: 1.07 × 15 = 16 units
- Buffer: 32 units
- Target quantity: (16 + 32) × 1.35 = 65 units
- Need to order: 65 - 40 = 25 units

Decision: AUTO-ORDER 25 units (trend-adjusted)
Reason: "Stock below reorder point with increasing demand trend"
```

## Integration Points

### Database Schema

```prisma
model Item {
  // Manual override tracking
  isManualMaxQuantity     Boolean   @default(false)
  isManualReorderPoint    Boolean   @default(false)
  lastAutoOrderDate       DateTime?

  // Stock configuration
  maxQuantity             Float?
  reorderPoint            Float?
  reorderQuantity         Float?
}

model OrderSchedule {
  items        String[]   // Array of item IDs in schedule
  nextRun      DateTime?  // Next scheduled order date
  isActive     Boolean
  finishedAt   DateTime?  // Completed schedules excluded
}
```

### API Endpoints

```typescript
// Analyze items for auto-order (preview)
GET /api/auto-orders/analyze
Returns: AutoOrderRecommendation[]

// Create auto-orders from recommendations
POST /api/auto-orders/create
Body: { recommendationIds: string[] }

// Get items in schedules (for conflict detection)
GET /api/order-schedules/scheduled-items
Returns: { itemId: string, nextRun: Date, scheduleId: string }[]
```

## Benefits

1. **No Conflicts**: Auto-orders never duplicate scheduled orders
2. **Safety Net**: Emergency orders created if schedules won't arrive in time
3. **Intelligent**: Respects user planning while ensuring stock availability
4. **Trend-Aware**: Automatically adjusts for increasing/decreasing demand
5. **Manual Control**: Respects user overrides while warning of potential issues

## Monitoring & Alerts

The system logs:
- ✅ Items deferred to schedules
- ⚠️ Emergency overrides of schedules
- 📊 Demand trend changes
- 🔒 Manual override preservations
- 📉 Potential insufficiency warnings

All actions logged to ChangeLog for full audit trail.
