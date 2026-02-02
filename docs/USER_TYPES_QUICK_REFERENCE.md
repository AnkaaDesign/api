# User Types Quick Reference

## At a Glance

### Available Types

| Type | Fields | Use Case | Example |
|------|--------|----------|---------|
| `UserMinimal` | id, name, email, avatarId, status, isActive | Dropdowns, comboboxes | User selector |
| `UserWithPosition` | UserMinimal + position, positionId | Employee lists with roles | Team roster |
| `UserWithSector` | UserMinimal + sector, sectorId | Department lists | Sector assignments |
| `UserWithEmployment` | UserMinimal + position, sector, payrollNumber | HR management | Employee table |
| `UserDetailed` | Full user + all relations | Detail views | Profile page |

### Select Presets

```typescript
import { UserSelectPresets } from '@types';

UserSelectPresets.minimal      // → UserMinimal
UserSelectPresets.withPosition  // → UserWithPosition
UserSelectPresets.withSector    // → UserWithSector
UserSelectPresets.employment    // → UserWithEmployment
UserSelectPresets.basic         // → All fields, no relations
```

## Common Patterns

### 1. Dropdown/Combobox

```typescript
const users = await prisma.user.findMany({
  select: UserSelectPresets.minimal,
  where: { isActive: true },
  orderBy: { name: 'asc' },
});
// Returns: UserMinimal[]
```

### 2. Employee List

```typescript
const employees = await prisma.user.findMany({
  select: UserSelectPresets.employment,
  where: { status: { not: 'DISMISSED' } },
});
// Returns: UserWithEmployment[]
```

### 3. User Details

```typescript
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    position: true,
    sector: true,
    managedSector: true,
    avatar: true,
  },
});
// Returns: UserDetailed | null
```

### 4. Custom Select

```typescript
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
    position: { select: { name: true } },
    _count: { select: { tasks: true } },
  },
});
```

## Response Types

```typescript
import {
  UserMinimalGetManyResponse,
  UserWithPositionGetManyResponse,
  UserWithSectorGetManyResponse,
  UserWithEmploymentGetManyResponse,
  UserDetailedGetUniqueResponse,
} from '@types';
```

## Performance Tips

### ❌ Avoid

```typescript
// Fetches ALL fields + ALL relations
const users = await prisma.user.findMany();
```

### ✅ Use

```typescript
// Fetches only needed fields
const users = await prisma.user.findMany({
  select: UserSelectPresets.minimal,
});
```

### Performance Gain

| Approach | Data Size | Performance |
|----------|-----------|-------------|
| Full fetch | ~5-10KB/user | Baseline |
| Minimal select | ~200 bytes/user | 95-99% faster |

## Type Safety

### Type Inference

```typescript
const select = {
  id: true,
  name: true,
  email: true,
} as const;

const users = await prisma.user.findMany({ select });
// TypeScript knows exact structure
```

### Type Helper

```typescript
import { UserFromSelect } from '@types';

type CustomUser = UserFromSelect<typeof select>;
```

## Repository Pattern

```typescript
class UserRepository {
  async findMinimal(): Promise<UserMinimal[]> {
    return this.prisma.user.findMany({
      select: UserSelectPresets.minimal,
    });
  }

  async findEmployees(): Promise<UserWithEmployment[]> {
    return this.prisma.user.findMany({
      select: UserSelectPresets.employment,
    });
  }
}
```

## Service Pattern

```typescript
class UserService {
  async getUsersForDropdown(): Promise<UserMinimalGetManyResponse> {
    const users = await this.repo.findMinimal();
    return {
      success: true,
      message: 'Users retrieved',
      data: users,
    };
  }
}
```

## Field Reference

### UserMinimal
- ✓ id
- ✓ name
- ✓ email
- ✓ avatarId
- ✓ status
- ✓ isActive

### UserWithPosition (extends UserMinimal)
- ✓ All UserMinimal fields
- ✓ positionId
- ✓ position { id, name, hierarchy }

### UserWithSector (extends UserMinimal)
- ✓ All UserMinimal fields
- ✓ sectorId
- ✓ sector { id, name }

### UserWithEmployment (extends UserMinimal)
- ✓ All UserMinimal fields
- ✓ positionId
- ✓ position { id, name, hierarchy }
- ✓ sectorId
- ✓ sector { id, name }
- ✓ payrollNumber
- ✓ status
- ✓ isActive

### UserDetailed (extends User)
- ✓ All User fields
- ✓ position (full)
- ✓ sector (full)
- ✓ managedSector (full)
- ✓ avatar (full)
- ✓ ppeSize (full)

## Common Queries

### Active Users Only
```typescript
where: { isActive: true }
```

### By Sector
```typescript
where: { sectorId: 'sector-id' }
```

### By Position
```typescript
where: { positionId: 'position-id' }
```

### Not Dismissed
```typescript
where: { status: { not: 'DISMISSED' } }
```

### With Search
```typescript
where: {
  OR: [
    { name: { contains: searchTerm, mode: 'insensitive' } },
    { email: { contains: searchTerm, mode: 'insensitive' } },
  ],
}
```

## Documentation

- **Full Guide**: `docs/USER_TYPES_SELECT_GUIDE.md`
- **Update Summary**: `docs/USER_TYPES_UPDATE_SUMMARY.md`
- **Examples**: `examples/user-types-usage-examples.ts`
- **Types**: `src/types/user.ts`
