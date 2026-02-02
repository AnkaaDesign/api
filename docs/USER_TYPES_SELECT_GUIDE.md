# User Types - Select Functionality Guide

This guide demonstrates how to use the new selective type system for User entities, which provides type-safe field selection and optimized data fetching.

## Table of Contents

1. [Overview](#overview)
2. [Available Types](#available-types)
3. [Usage Examples](#usage-examples)
4. [Select Presets](#select-presets)
5. [Type Safety](#type-safety)
6. [Best Practices](#best-practices)

## Overview

The User type system now supports selective field fetching through:
- **UserSelect**: Interface for Prisma-style field selection
- **Specialized Types**: Pre-built types for common use cases
- **Select Presets**: Ready-to-use select configurations
- **Type Helpers**: Utilities for type inference

## Available Types

### Base Types

#### `User`
The complete user entity with all fields and relations.

```typescript
import { User } from '@types';
```

#### `UserSelect`
Interface for selective field fetching.

```typescript
import { UserSelect } from '@types';

const selectConfig: UserSelect = {
  id: true,
  name: true,
  email: true,
  position: true,
};
```

### Specialized Types

#### `UserMinimal`
Minimal fields for comboboxes and dropdowns.

```typescript
interface UserMinimal {
  id: string;
  name: string;
  email?: string | null;
  avatarId?: string | null;
  status?: USER_STATUS;
  isActive?: boolean;
}
```

**Use Case**: Dropdown lists, comboboxes, quick references

#### `UserWithPosition`
User with position relation included.

```typescript
interface UserWithPosition extends UserMinimal {
  position?: {
    id: string;
    name: string;
    hierarchy?: number | null;
  } | null;
  positionId?: string | null;
}
```

**Use Case**: Employee lists showing positions

#### `UserWithSector`
User with sector relation included.

```typescript
interface UserWithSector extends UserMinimal {
  sector?: {
    id: string;
    name: string;
  } | null;
  sectorId?: string | null;
}
```

**Use Case**: Department-based user lists

#### `UserWithEmployment`
User with comprehensive employment information.

```typescript
interface UserWithEmployment extends UserMinimal {
  position?: {
    id: string;
    name: string;
    hierarchy?: number | null;
  } | null;
  sector?: {
    id: string;
    name: string;
  } | null;
  positionId?: string | null;
  sectorId?: string | null;
  payrollNumber?: number | null;
  status: USER_STATUS;
  isActive: boolean;
}
```

**Use Case**: Employee management tables, HR dashboards

#### `UserDetailed`
Complete user with all common relations loaded.

```typescript
interface UserDetailed extends User {
  position?: Position;
  sector?: Sector;
  managedSector?: Sector;
  avatar?: File;
  ppeSize?: PpeSize;
}
```

**Use Case**: User profile pages, detailed views

## Usage Examples

### 1. Using Select in Queries

#### Basic Select
```typescript
// Fetch only specific fields
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
  },
});
// Type: Array<{ id: string; name: string; email: string | null }>
```

#### Select with Relations
```typescript
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    position: {
      select: {
        id: true,
        name: true,
      },
    },
  },
});
// Type includes nested position
```

### 2. Using Select Presets

```typescript
import { UserSelectPresets } from '@types';

// Minimal user data for dropdowns
const users = await prisma.user.findMany({
  select: UserSelectPresets.minimal,
});
// Returns: UserMinimal[]

// Users with position
const usersWithPosition = await prisma.user.findMany({
  select: UserSelectPresets.withPosition,
});
// Returns: UserWithPosition[]

// Users with employment info
const employees = await prisma.user.findMany({
  select: UserSelectPresets.employment,
});
// Returns: UserWithEmployment[]
```

### 3. Custom Select Configuration

```typescript
import { UserSelect } from '@types';

// Define custom select
const customSelect: UserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  sector: true,
  _count: {
    select: {
      tasks: true,
      activities: true,
    },
  },
};

const users = await prisma.user.findMany({
  select: customSelect,
});
```

### 4. In Repository Patterns

```typescript
class UserRepository {
  // Minimal user fetch
  async findMinimalUsers(where?: Prisma.UserWhereInput): Promise<UserMinimal[]> {
    return this.prisma.user.findMany({
      where,
      select: UserSelectPresets.minimal,
    });
  }

  // Users with position
  async findUsersWithPosition(where?: Prisma.UserWhereInput): Promise<UserWithPosition[]> {
    return this.prisma.user.findMany({
      where,
      select: UserSelectPresets.withPosition,
    });
  }

  // Detailed user fetch
  async findDetailedUser(id: string): Promise<UserDetailed | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        position: true,
        sector: true,
        managedSector: true,
        avatar: true,
        ppeSize: true,
      },
    });
  }
}
```

### 5. In Services

```typescript
class UserService {
  // Get users for a combobox
  async getUsersForCombobox(active: boolean = true): Promise<UserMinimal[]> {
    return this.userRepository.findMany({
      where: { isActive: active },
      select: UserSelectPresets.minimal,
      orderBy: { name: 'asc' },
    });
  }

  // Get users for employee table
  async getEmployees(sectorId?: string): Promise<UserWithEmployment[]> {
    return this.userRepository.findMany({
      where: sectorId ? { sectorId } : {},
      select: UserSelectPresets.employment,
      orderBy: [{ sector: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  // Get full user details
  async getUserDetails(id: string): Promise<UserDetailed> {
    const user = await this.userRepository.findUnique({
      where: { id },
      include: {
        position: true,
        sector: true,
        managedSector: true,
        avatar: true,
        ppeSize: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
```

### 6. In Controllers/API Responses

```typescript
@Controller('users')
class UserController {
  @Get('minimal')
  async getMinimalUsers(): Promise<UserMinimalGetManyResponse> {
    const users = await this.userService.getUsersForCombobox();
    return {
      success: true,
      message: 'Users retrieved successfully',
      data: users,
    };
  }

  @Get('employees')
  async getEmployees(
    @Query('sectorId') sectorId?: string,
  ): Promise<UserWithEmploymentGetManyResponse> {
    const users = await this.userService.getEmployees(sectorId);
    return {
      success: true,
      message: 'Employees retrieved successfully',
      data: users,
    };
  }

  @Get(':id/details')
  async getUserDetails(@Param('id') id: string): Promise<UserDetailedGetUniqueResponse> {
    const user = await this.userService.getUserDetails(id);
    return {
      success: true,
      message: 'User details retrieved successfully',
      data: user,
    };
  }
}
```

## Select Presets

### Available Presets

| Preset | Fields | Use Case |
|--------|--------|----------|
| `minimal` | id, name, email, avatarId, status, isActive | Dropdowns, comboboxes |
| `withPosition` | minimal + positionId, position | Employee lists with roles |
| `withSector` | minimal + sectorId, sector | Department-based lists |
| `employment` | minimal + position, sector, payrollNumber | HR management tables |
| `basic` | All scalar fields, no relations | Full data without joins |

### Creating Custom Presets

```typescript
// Define a custom preset
const customPreset = {
  id: true,
  name: true,
  email: true,
  position: {
    select: {
      name: true,
      hierarchy: true,
    },
  },
  _count: {
    select: {
      tasks: true,
    },
  },
} as const;

// Use it
const users = await prisma.user.findMany({
  select: customPreset,
});
```

## Type Safety

### Type Inference from Select

```typescript
import { UserFromSelect } from '@types';

// Define select configuration
const selectConfig = {
  id: true,
  name: true,
  email: true,
} as const;

// Infer type from select
type SelectedUser = UserFromSelect<typeof selectConfig>;
// Type: Pick<User, 'id' | 'name' | 'email'>
```

### Response Types

The module provides specialized response types:

```typescript
import {
  UserMinimalGetManyResponse,
  UserWithPositionGetManyResponse,
  UserWithSectorGetManyResponse,
  UserWithEmploymentGetManyResponse,
  UserDetailedGetUniqueResponse,
} from '@types';
```

## Best Practices

### 1. Use Minimal Types for Lists

```typescript
// Good - Only fetch needed fields
const users = await prisma.user.findMany({
  select: UserSelectPresets.minimal,
});

// Bad - Fetching unnecessary data
const users = await prisma.user.findMany(); // Returns all fields
```

### 2. Selective Relation Loading

```typescript
// Good - Load relations only when needed
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    name: true,
    position: {
      select: {
        name: true,
        hierarchy: true,
      },
    },
  },
});

// Bad - Loading all relation data
const user = await prisma.user.findUnique({
  where: { id },
  include: {
    position: true,
    sector: true,
    tasks: true, // Potentially hundreds of records
    activities: true,
    bonuses: true,
    // ... etc
  },
});
```

### 3. Use Typed Responses

```typescript
// Good - Type-safe response
async getUsers(): Promise<UserMinimalGetManyResponse> {
  const users = await this.userRepository.findMany({
    select: UserSelectPresets.minimal,
  });

  return {
    success: true,
    message: 'Users retrieved',
    data: users,
  };
}

// Bad - Untyped response
async getUsers(): Promise<any> {
  const users = await this.userRepository.findMany();
  return { data: users };
}
```

### 4. Avoid Over-fetching

```typescript
// Good - Fetch only what the UI needs
// For a user dropdown
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
  },
});

// Bad - Fetching entire user object
const users = await prisma.user.findMany();
// UI only uses id and name, but fetched all fields
```

### 5. Use Count Selectively

```typescript
// Good - Select specific counts
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    _count: {
      select: {
        tasks: true,
      },
    },
  },
});

// Bad - Count all relations
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    _count: true, // Counts ALL relations
  },
});
```

## Performance Benefits

### Database Query Optimization

Using selective types reduces:
- **Database load**: Fewer columns fetched
- **Network traffic**: Smaller result sets
- **Memory usage**: Less data in application memory
- **Serialization overhead**: Smaller JSON responses

### Example Performance Comparison

```typescript
// Heavy query - ~50KB per user
const allUsers = await prisma.user.findMany({
  include: {
    position: true,
    sector: true,
    tasks: true,
    activities: true,
    bonuses: true,
  },
});

// Optimized query - ~200 bytes per user
const minimalUsers = await prisma.user.findMany({
  select: UserSelectPresets.minimal,
});

// Performance gain: ~99.6% reduction in data size
```

## Migration Guide

### From Full User to Selective Types

**Before:**
```typescript
async getUsers(): Promise<User[]> {
  return this.prisma.user.findMany({
    include: {
      position: true,
      sector: true,
    },
  });
}
```

**After:**
```typescript
async getUsers(): Promise<UserWithEmployment[]> {
  return this.prisma.user.findMany({
    select: UserSelectPresets.employment,
  });
}
```

### Updating API Responses

**Before:**
```typescript
@Get()
async getUsers(): Promise<UserGetManyResponse> {
  const users = await this.userService.findAll();
  return {
    success: true,
    message: 'Users retrieved',
    data: users,
  };
}
```

**After:**
```typescript
@Get('minimal')
async getMinimalUsers(): Promise<UserMinimalGetManyResponse> {
  const users = await this.userService.findMinimal();
  return {
    success: true,
    message: 'Users retrieved',
    data: users,
  };
}
```

## Conclusion

The new select functionality provides:
- Type-safe field selection
- Performance optimization
- Clear intent in code
- Reduced over-fetching
- Better developer experience

Use the appropriate type for your use case, and leverage select presets for common scenarios.
