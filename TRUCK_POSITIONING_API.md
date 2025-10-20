# Truck Positioning API Implementation

## Overview
This document describes the implementation of backend API endpoints for truck positioning in the truck paint company management system.

## Database Schema Changes

### Truck Model Updates
Added `laneId` field to the `Truck` model to support lane-based positioning:

```prisma
model Truck {
  id                String      @id @default(uuid())
  xPosition         Float?
  yPosition         Float?
  taskId            String      @unique
  garageId          String?
  laneId            String?     // NEW FIELD
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  backSideLayoutId  String?     @unique
  leftSideLayoutId  String?     @unique
  rightSideLayoutId String?     @unique

  // Relations
  backSideLayout    Layout?     @relation("TRUCK_BACK_SIDE", fields: [backSideLayoutId], references: [id])
  garage            Garage?     @relation("TRUCK_GARAGE", fields: [garageId], references: [id])
  lane              GarageLane? @relation("TRUCK_LANE", fields: [laneId], references: [id])  // NEW RELATION
  leftSideLayout    Layout?     @relation("TRUCK_LEFT_SIDE", fields: [leftSideLayoutId], references: [id])
  rightSideLayout   Layout?     @relation("TRUCK_RIGHT_SIDE", fields: [rightSideLayoutId], references: [id])
  task              Task        @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([garageId])
  @@index([laneId])  // NEW INDEX
}
```

### GarageLane Model Updates
Added `trucks` relation to support lane-based queries:

```prisma
model GarageLane {
  id           String        @id @default(uuid())
  width        Float
  length       Float
  xPosition    Float
  yPosition    Float
  garageId     String
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  garage       Garage        @relation(fields: [garageId], references: [id], onDelete: Cascade)
  parkingSpots ParkingSpot[]
  trucks       Truck[]       @relation("TRUCK_LANE")  // NEW RELATION

  @@index([garageId])
}
```

### Migration
Created migration file: `/prisma/migrations/20251017_add_lane_id_to_truck/migration.sql`

```sql
-- Add laneId field to Truck table for truck positioning in garage lanes
ALTER TABLE "Truck" ADD COLUMN "laneId" TEXT;

-- Create index on laneId for performance
CREATE INDEX "Truck_laneId_idx" ON "Truck"("laneId");

-- Add foreign key constraint to GarageLane
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_laneId_fkey"
  FOREIGN KEY ("laneId") REFERENCES "GarageLane"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

## API Endpoints

### 1. GET /api/tasks/in-production
Get tasks with status "PENDING" or "IN_PRODUCTION" that have layouts.

**Query Parameters:**
- Standard `TaskQueryFormData` parameters (include, orderBy, etc.)

**Response:**
```typescript
TaskGetManyResponse {
  success: boolean;
  message: string;
  data: Task[];
  count?: number;
}
```

**Features:**
- Filters tasks by status (PENDING or IN_PRODUCTION)
- Only returns tasks with trucks that have at least one layout (left, right, or back)
- Includes truck layout dimensions in response for positioning calculations
- Includes garage and lane information

**Example Usage:**
```typescript
const tasks = await getInProductionTasks({
  include: {
    truck: {
      include: {
        garage: true,
        lane: true,
        leftSideLayout: { include: { layoutSections: true } },
        rightSideLayout: { include: { layoutSections: true } },
        backSideLayout: { include: { layoutSections: true } },
      },
    },
  },
});
```

---

### 2. PUT /api/tasks/:id/position
Update truck position (xPosition, yPosition, garageId, laneId) for a single task.

**Path Parameters:**
- `id` (UUID): Task ID

**Body:**
```typescript
{
  xPosition?: number | null;
  yPosition?: number | null;
  garageId?: string | null;
  laneId?: string | null;
}
```

**Response:**
```typescript
TaskUpdateResponse {
  success: boolean;
  message: string;
  data: Task;
}
```

**Validations:**
- Task must exist
- Task must have an associated truck
- Truck must have at least one layout (left, right, or back) defined
- If positioning in a garage (not virtual "Patio"):
  - Truck dimensions must fit within garage dimensions
  - Truck must not overlap with other trucks in the same garage
  - If lane is specified, truck must fit within lane boundaries
  - Position must not conflict with other trucks

**Virtual "Patio" Garage:**
- Trucks without x/y positions (null values) are automatically assigned to the virtual "Patio" garage
- No dimension validation is performed for trucks in the "Patio"

**Example Usage:**
```typescript
// Position truck in garage
await updateTaskPosition('task-uuid', {
  xPosition: 5.0,
  yPosition: 10.0,
  garageId: 'garage-uuid',
  laneId: 'lane-uuid',
});

// Move truck to virtual "Patio"
await updateTaskPosition('task-uuid', {
  xPosition: null,
  yPosition: null,
  garageId: null,
  laneId: null,
});
```

---

### 3. POST /api/tasks/bulk-position
Bulk update positions for multiple trucks (for save operation).

**Body:**
```typescript
{
  updates: Array<{
    taskId: string;
    xPosition?: number | null;
    yPosition?: number | null;
    garageId?: string | null;
    laneId?: string | null;
  }>;
}
```

**Response:**
```typescript
TaskBatchUpdateResponse<Task> {
  success: boolean;
  message: string;
  data: Task[];
  errors?: Array<{
    input: any;
    error: string;
  }>;
}
```

**Features:**
- Processes each update sequentially
- Collects successful updates and errors
- Returns partial success if some updates fail
- Each update is validated independently

**Example Usage:**
```typescript
await bulkUpdatePositions({
  updates: [
    {
      taskId: 'task-1-uuid',
      xPosition: 5.0,
      yPosition: 10.0,
      garageId: 'garage-uuid',
      laneId: 'lane-uuid',
    },
    {
      taskId: 'task-2-uuid',
      xPosition: 15.0,
      yPosition: 10.0,
      garageId: 'garage-uuid',
      laneId: 'lane-uuid',
    },
  ],
});
```

---

### 4. POST /api/tasks/:id/swap
Swap positions of two trucks.

**Path Parameters:**
- `id` (UUID): First task ID

**Body:**
```typescript
{
  targetTaskId: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  message: string;
  data: {
    task1: Task;
    task2: Task;
  };
}
```

**Features:**
- Swaps all position-related fields between two trucks
- Validates both tasks exist and have trucks
- Logs swap operation in changelog for both trucks
- Returns both updated tasks

**Example Usage:**
```typescript
const result = await swapTaskPositions('task-1-uuid', 'task-2-uuid');
console.log('Swapped:', result.data.task1, result.data.task2);
```

## Validation Logic

### Truck Layout Requirements
Trucks must have at least one layout defined (left, right, or back side) before they can be positioned in a garage:

```typescript
if (!truck.leftSideLayout && !truck.rightSideLayout && !truck.backSideLayout) {
  throw new BadRequestException(
    'Caminhão não possui layout definido. Layouts são necessários para posicionamento.'
  );
}
```

### Dimension Calculations

**Truck Width Calculation:**
```typescript
private calculateTruckWidth(truck: any): number {
  const leftWidth = truck.leftSideLayout?.layoutSections?.reduce(
    (sum, section) => sum + section.width, 0
  ) || 0;

  const rightWidth = truck.rightSideLayout?.layoutSections?.reduce(
    (sum, section) => sum + section.width, 0
  ) || 0;

  // Use maximum width from available layouts, default to 2.5m if no layout
  return Math.max(leftWidth, rightWidth) || 2.5;
}
```

**Truck Length Calculation:**
```typescript
private calculateTruckLength(truck: any): number {
  const backLength = truck.backSideLayout?.height || 0;
  const leftLength = truck.leftSideLayout?.height || 0;
  const rightLength = truck.rightSideLayout?.height || 0;

  // Use maximum length from available layouts, default to 12.5m if no layout
  return Math.max(backLength, leftLength, rightLength) || 12.5;
}
```

### Garage Fit Validation
```typescript
// Validate truck fits within garage dimensions
if (xPosition + truckWidth > garage.width) {
  throw new BadRequestException(
    `Caminhão não cabe na garagem: largura do caminhão (${truckWidth}m) + posição X (${xPosition}m) excede largura da garagem (${garage.width}m)`
  );
}

if (yPosition + truckLength > garage.length) {
  throw new BadRequestException(
    `Caminhão não cabe na garagem: comprimento do caminhão (${truckLength}m) + posição Y (${yPosition}m) excede comprimento da garagem (${garage.length}m)`
  );
}
```

### Lane Fit Validation
```typescript
if (laneId) {
  const lane = garage.lanes.find(l => l.id === laneId);

  // Check if truck fits within lane boundaries
  if (xPosition < lane.xPosition || xPosition + truckWidth > lane.xPosition + lane.width) {
    throw new BadRequestException('Caminhão não cabe na faixa: posição horizontal fora dos limites');
  }

  if (yPosition < lane.yPosition || yPosition + truckLength > lane.yPosition + lane.length) {
    throw new BadRequestException('Caminhão não cabe na faixa: posição vertical fora dos limites');
  }
}
```

### Overlap Detection
```typescript
const overlaps =
  xPosition < (otherTruck.xPosition || 0) + otherWidth &&
  xPosition + truckWidth > (otherTruck.xPosition || 0) &&
  yPosition < (otherTruck.yPosition || 0) + otherLength &&
  yPosition + truckLength > (otherTruck.yPosition || 0);

if (overlaps) {
  throw new BadRequestException('Posição conflita com outro caminhão na garagem');
}
```

## Frontend API Client

The frontend API client has been updated with the positioning operations:

```typescript
// Get tasks in production with layouts
const tasks = await getInProductionTasks({ include: { truck: true } });

// Update single truck position
await updateTaskPosition('task-uuid', {
  xPosition: 5.0,
  yPosition: 10.0,
  garageId: 'garage-uuid',
  laneId: 'lane-uuid',
});

// Bulk update positions
await bulkUpdatePositions({
  updates: [
    { taskId: 'task-1-uuid', xPosition: 5.0, yPosition: 10.0, garageId: 'garage-uuid' },
    { taskId: 'task-2-uuid', xPosition: 15.0, yPosition: 10.0, garageId: 'garage-uuid' },
  ],
});

// Swap truck positions
await swapTaskPositions('task-1-uuid', 'task-2-uuid');
```

## Changelog Integration

All position updates are logged in the changelog system:

```typescript
await this.changeLogService.logChange({
  entityType: ENTITY_TYPE.TRUCK,
  entityId: truck.id,
  action: CHANGE_ACTION.UPDATE,
  userId,
  metadata: {
    taskId: task.id,
    oldPosition: {
      xPosition: task.truck.xPosition,
      yPosition: task.truck.yPosition,
      garageId: task.truck.garageId,
      laneId: task.truck.laneId,
    },
    newPosition: positionData,
  },
  transaction: tx,
});
```

## Files Modified

### Backend (API)
1. `/prisma/schema.prisma` - Added `laneId` field to Truck model and `trucks` relation to GarageLane
2. `/prisma/migrations/20251017_add_lane_id_to_truck/migration.sql` - Database migration
3. `/src/types/truck.ts` - Updated Truck interface with `laneId` and `lane` relation
4. `/src/types/garage.ts` - Updated GarageLane interface with `trucks` relation
5. `/src/schemas/task.ts` - Added positioning schemas (taskPositionUpdateSchema, taskBulkPositionUpdateSchema, taskSwapPositionSchema)
6. `/src/modules/production/task/task.controller.ts` - Added positioning endpoints
7. `/src/modules/production/task/task.service.ts` - Implemented positioning logic and validations

### Frontend (Web)
1. `/src/api-client/task.ts` - Added positioning operation methods to TaskService class

## Type Definitions

### TaskPositionUpdateFormData
```typescript
{
  xPosition?: number | null;
  yPosition?: number | null;
  garageId?: string | null;
  laneId?: string | null;
}
```

### TaskBulkPositionUpdateFormData
```typescript
{
  updates: Array<{
    taskId: string;
    xPosition?: number | null;
    yPosition?: number | null;
    garageId?: string | null;
    laneId?: string | null;
  }>;
}
```

### TaskSwapPositionFormData
```typescript
{
  targetTaskId: string;
}
```

## Usage Notes

1. **Virtual "Patio" Garage**: The system supports a virtual garage called "Patio" for trucks without assigned positions. Set all position fields to `null` to move a truck to the Patio.

2. **Layout Requirements**: Trucks must have layout dimensions defined before they can be positioned. The system calculates truck dimensions from the layout sections.

3. **Task Status Filtering**: Only tasks with status "PENDING" or "IN_PRODUCTION" are returned by the `/in-production` endpoint.

4. **Transaction Safety**: All position updates are wrapped in database transactions to ensure data consistency.

5. **Permission Requirements**: All positioning endpoints require PRODUCTION, LEADER, or ADMIN privileges.

6. **Changelog Tracking**: All position changes are logged in the changelog system with full metadata about old and new positions.

## Testing Recommendations

1. Test positioning a truck in a garage with valid dimensions
2. Test moving a truck to the virtual "Patio" garage
3. Test validation errors:
   - Truck without layout
   - Truck too large for garage
   - Truck too large for lane
   - Overlapping trucks
4. Test bulk positioning with mixed success/failure scenarios
5. Test swapping positions between two trucks
6. Test changelog entries are created correctly
7. Test permission-based access to endpoints

## Future Enhancements

1. Add real-time collision detection during drag-and-drop
2. Implement auto-positioning algorithms for optimal garage space usage
3. Add visual garage capacity indicators
4. Support for rotating trucks (orientation field)
5. Add position history and analytics
6. Implement position reservation system for scheduled tasks
