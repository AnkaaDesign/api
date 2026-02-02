# Include Helpers - Usage Examples

This document provides practical examples of using the include helper utilities to build type-safe, performant Prisma queries.

## Table of Contents

1. [Basic Select Patterns](#basic-select-patterns)
2. [Building Custom Selects](#building-custom-selects)
3. [Common Query Patterns](#common-query-patterns)
4. [Performance Optimization](#performance-optimization)
5. [Type Safety](#type-safety)

## Basic Select Patterns

### Combobox/Dropdown Queries

```typescript
import { SelectPatterns, QueryPatterns } from '@utils';

// User combobox
const users = await prisma.user.findMany(QueryPatterns.combobox.user());
// Returns: { id, name, email, avatarId, status, isActive }

// Customer combobox
const customers = await prisma.customer.findMany(QueryPatterns.combobox.customer());
// Returns: { id, fantasyName, cnpj }

// Sector combobox
const sectors = await prisma.sector.findMany(QueryPatterns.combobox.sector());
// Returns: { id, name }
```

### Table/List Queries

```typescript
import { SelectPatterns, buildMinimalInclude } from '@utils';

// Task list with minimal data
const tasks = await prisma.task.findMany({
  select: {
    id: true,
    name: true,
    status: true,
    term: true,
    customerId: true,
    sectorId: true,
    // Include related entities with minimal fields
    customer: { select: SelectPatterns.customer.minimal },
    sector: { select: SelectPatterns.sector.minimal },
  },
});

// Alternative using buildMinimalInclude
const tasks2 = await prisma.task.findMany({
  select: {
    id: true,
    name: true,
    status: true,
    term: true,
    customerId: true,
    sectorId: true,
    ...buildMinimalInclude(['customer', 'sector']),
  },
});
```

### Detail View Queries

```typescript
import { SelectPatterns, buildUserSelect } from '@utils';

// Task detail with comprehensive data
const task = await prisma.task.findUnique({
  where: { id: taskId },
  include: {
    customer: { select: SelectPatterns.customer.withLogo },
    sector: { select: SelectPatterns.sector.withManager },
    createdBy: { select: buildUserSelect({ includeEmployment: true }) },
    budgets: { select: SelectPatterns.file.minimal },
    invoices: { select: SelectPatterns.file.minimal },
    serviceOrders: {
      include: {
        assignedTo: { select: SelectPatterns.user.minimal },
      },
    },
  },
});
```

## Building Custom Selects

### File Relations

```typescript
import { buildFileSelect, buildFileArraySelect } from '@utils';

// Single file with metadata
const layout = await prisma.layout.findUnique({
  where: { id: layoutId },
  include: {
    photo: { select: buildFileSelect(true) },
  },
});

// Array of files without metadata (performance optimized)
const task = await prisma.task.findUnique({
  where: { id: taskId },
  include: {
    budgets: buildFileArraySelect(false),
    invoices: buildFileArraySelect(false),
  },
});
```

### User Relations

```typescript
import { buildUserSelect } from '@utils';

// User with position only
const serviceOrder = await prisma.serviceOrder.findUnique({
  where: { id: orderId },
  include: {
    assignedTo: {
      select: buildUserSelect({ includePosition: true }),
    },
  },
});

// User with full employment details
const task = await prisma.task.findUnique({
  where: { id: taskId },
  include: {
    createdBy: {
      select: buildUserSelect({
        includeEmployment: true,
        includeAvatar: true,
      }),
    },
  },
});
```

### Customer Relations

```typescript
import { buildCustomerSelect } from '@utils';

// Customer without logo (faster)
const tasks = await prisma.task.findMany({
  include: {
    customer: { select: buildCustomerSelect(false) },
  },
});

// Customer with logo (for detail views)
const task = await prisma.task.findUnique({
  where: { id: taskId },
  include: {
    customer: { select: buildCustomerSelect(true) },
  },
});
```

### Paint Relations

```typescript
import { buildPaintSelect } from '@utils';

// Paint with minimal data (combobox)
const tasks = await prisma.task.findMany({
  include: {
    generalPainting: { select: buildPaintSelect(false) },
  },
});

// Paint with type and brand details
const task = await prisma.task.findUnique({
  where: { id: taskId },
  include: {
    generalPainting: { select: buildPaintSelect(true) },
    logoPaints: { select: buildPaintSelect(true) },
  },
});
```

## Common Query Patterns

### Selective Include

```typescript
import { buildSelectiveInclude, SelectPatterns } from '@utils';

// Build a selective include with custom selects
const include = buildSelectiveInclude({
  customer: SelectPatterns.customer.minimal,
  sector: SelectPatterns.sector.minimal,
  createdBy: SelectPatterns.user.withPosition,
});

const tasks = await prisma.task.findMany({ include });
```

### Merge Multiple Includes

```typescript
import { mergeIncludes, SelectPatterns } from '@utils';

// Base include for all queries
const baseInclude = {
  customer: { select: SelectPatterns.customer.minimal },
  sector: { select: SelectPatterns.sector.minimal },
};

// Additional includes for detail view
const detailInclude = {
  budgets: { select: SelectPatterns.file.minimal },
  invoices: { select: SelectPatterns.file.minimal },
  serviceOrders: true,
};

// Merge them
const fullInclude = mergeIncludes(baseInclude, detailInclude);

const task = await prisma.task.findUnique({
  where: { id: taskId },
  include: fullInclude,
});
```

### Count Relations

```typescript
import { buildCountSelect } from '@utils';

// Get entity with relation counts
const customer = await prisma.customer.findUnique({
  where: { id: customerId },
  include: {
    _count: buildCountSelect(['tasks', 'representatives']),
  },
});

console.log(customer._count.tasks); // Number of tasks
console.log(customer._count.representatives); // Number of representatives
```

## Performance Optimization

### Check Include Performance

```typescript
import { checkIncludePerformance } from '@utils';

const myInclude = {
  customer: {
    include: {
      tasks: {
        include: {
          serviceOrders: {
            include: {
              assignedTo: true,
            },
          },
        },
      },
    },
  },
};

const warning = checkIncludePerformance(myInclude);
if (warning) {
  console.warn('Performance Warning:', warning);
}
```

### Optimize Include to Select

```typescript
import { optimizeIncludeToSelect } from '@utils';

// Inefficient include
const slowInclude = {
  customer: {
    include: {
      logo: true,
    },
  },
  sector: {
    include: {
      manager: true,
    },
  },
};

// Automatically optimize to use selects
const fastSelect = optimizeIncludeToSelect(slowInclude);
// Result: {
//   customer: { select: { logo: { select: {...} } } },
//   sector: { select: { manager: { select: {...} } } }
// }
```

### Table Query Pattern

```typescript
import { QueryPatterns, SelectPatterns } from '@utils';

// Efficient table query with custom fields
const tasks = await prisma.task.findMany({
  ...QueryPatterns.table.create(
    {
      id: true,
      name: true,
      status: true,
      term: true,
      serialNumber: true,
    },
    ['customer', 'sector', 'createdBy'],
  ),
  orderBy: { createdAt: 'desc' },
});
```

## Type Safety

### Validate Select Fields

```typescript
import { validateSelectFields } from '@utils';

const allowedTaskFields = ['id', 'name', 'status', 'customerId', 'sectorId'];

const userSelect = {
  id: true,
  name: true,
  status: true,
  password: true, // Not allowed!
};

try {
  validateSelectFields(userSelect, allowedTaskFields);
} catch (error) {
  console.error(error.message);
  // "Select contains disallowed fields: password"
}
```

### Sanitize Select

```typescript
import { sanitizeSelect } from '@utils';

const allowedFields = ['id', 'name', 'status', 'customerId'];

const unsafeSelect = {
  id: true,
  name: true,
  password: true, // Will be removed
  secretField: true, // Will be removed
};

const safeSelect = sanitizeSelect(unsafeSelect, allowedFields);
// Result: { id: true, name: true }

const tasks = await prisma.task.findMany({ select: safeSelect });
```

### Type Guards

```typescript
import { isBooleanInclude, isSelectInclude, isNestedInclude } from '@utils';

const include = {
  customer: true,
  sector: { select: { id: true, name: true } },
  createdBy: { include: { position: true } },
};

console.log(isBooleanInclude(include.customer)); // true
console.log(isSelectInclude(include.sector)); // true
console.log(isNestedInclude(include.createdBy)); // true
```

## Advanced Examples

### Repository Pattern

```typescript
import { SelectPatterns, buildMinimalInclude } from '@utils';

export class TaskRepository {
  // Combobox query
  async findForCombobox() {
    return this.prisma.task.findMany({
      select: {
        id: true,
        name: true,
        serialNumber: true,
        status: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  // Table query
  async findForTable(page: number, take: number) {
    return this.prisma.task.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        term: true,
        serialNumber: true,
        ...buildMinimalInclude(['customer', 'sector']),
      },
      skip: (page - 1) * take,
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Detail query
  async findById(id: string) {
    return this.prisma.task.findUnique({
      where: { id },
      include: {
        customer: { select: SelectPatterns.customer.withLogo },
        sector: { select: SelectPatterns.sector.withManager },
        createdBy: { select: SelectPatterns.user.withEmployment },
        budgets: { select: SelectPatterns.file.minimal },
        invoices: { select: SelectPatterns.file.minimal },
        receipts: { select: SelectPatterns.file.minimal },
        serviceOrders: {
          include: {
            assignedTo: { select: SelectPatterns.user.minimal },
          },
        },
        pricing: {
          include: {
            items: { orderBy: { position: 'asc' } },
            layoutFile: true,
          },
        },
      },
    });
  }
}
```

### Service Layer

```typescript
import { SelectPatterns, QueryPatterns, buildUserSelect } from '@utils';

export class TaskService {
  // Get tasks for dropdown/combobox
  async getTasksForSelection() {
    return this.taskRepository.findMany(QueryPatterns.combobox.task());
  }

  // Get tasks for table with optimized includes
  async getTasksForTable(filters: TaskFilters) {
    return this.taskRepository.findMany({
      where: this.buildWhereClause(filters),
      select: {
        id: true,
        name: true,
        status: true,
        term: true,
        customer: { select: SelectPatterns.customer.minimal },
        sector: { select: SelectPatterns.sector.minimal },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get single task with all details
  async getTaskDetail(id: string) {
    const task = await this.taskRepository.findUnique({
      where: { id },
      include: {
        customer: { select: SelectPatterns.customer.withLogo },
        sector: { select: SelectPatterns.sector.minimal },
        createdBy: {
          select: buildUserSelect({
            includeEmployment: true,
            includeAvatar: true,
          }),
        },
        // ... other relations
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }
}
```

## Best Practices

1. **Use predefined patterns** for common queries (combobox, table, detail)
2. **Avoid deep nesting** - Keep include depth <= 3 levels
3. **Use select instead of include** when you don't need all fields
4. **Optimize file queries** - Only include thumbnailUrl when needed
5. **Count wisely** - Use `_count` instead of loading full relations when you only need counts
6. **Cache combobox data** - These queries are perfect for caching
7. **Validate selects** - Always sanitize user-provided select configurations
8. **Test performance** - Use `checkIncludePerformance` during development

## Migration Guide

### Before (Manual Includes)

```typescript
const tasks = await prisma.task.findMany({
  include: {
    customer: {
      select: {
        id: true,
        fantasyName: true,
        cnpj: true,
      },
    },
    sector: {
      select: {
        id: true,
        name: true,
      },
    },
    createdBy: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
  },
});
```

### After (Using Helpers)

```typescript
import { SelectPatterns, buildMinimalInclude } from '@utils';

const tasks = await prisma.task.findMany({
  include: buildSelectiveInclude({
    customer: SelectPatterns.customer.minimal,
    sector: SelectPatterns.sector.minimal,
    createdBy: SelectPatterns.user.minimal,
  }),
});

// Or even simpler:
const tasks = await prisma.task.findMany({
  select: {
    id: true,
    name: true,
    status: true,
    ...buildMinimalInclude(['customer', 'sector', 'createdBy']),
  },
});
```
