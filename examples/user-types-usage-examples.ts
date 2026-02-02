/**
 * User Types Usage Examples
 *
 * This file demonstrates practical examples of using the new selective
 * user types in various scenarios throughout the application.
 */

import { PrismaClient } from '@prisma/client';
import {
  User,
  UserSelect,
  UserMinimal,
  UserWithPosition,
  UserWithSector,
  UserWithEmployment,
  UserDetailed,
  UserSelectPresets,
  UserFromSelect,
  UserMinimalGetManyResponse,
  UserWithEmploymentGetManyResponse,
  UserDetailedGetUniqueResponse,
} from '@types';

const prisma = new PrismaClient();

// ============================================================================
// Example 1: Basic Select Usage
// ============================================================================

/**
 * Fetch minimal user data for a dropdown/combobox
 */
async function getMinimalUsers(): Promise<UserMinimal[]> {
  return prisma.user.findMany({
    where: { isActive: true },
    select: UserSelectPresets.minimal,
    orderBy: { name: 'asc' },
  });
}

// Usage in a controller:
// const users = await getMinimalUsers();
// Returns: [{ id: '...', name: 'John Doe', email: '...', ... }]

// ============================================================================
// Example 2: Users with Position
// ============================================================================

/**
 * Get users with their position information for an employee list
 */
async function getUsersWithPosition(sectorId?: string): Promise<UserWithPosition[]> {
  return prisma.user.findMany({
    where: {
      isActive: true,
      ...(sectorId && { sectorId }),
    },
    select: UserSelectPresets.withPosition,
    orderBy: [
      { position: { hierarchy: 'asc' } },
      { name: 'asc' },
    ],
  });
}

// ============================================================================
// Example 3: Users with Sector
// ============================================================================

/**
 * Get users grouped by sector
 */
async function getUsersBySector(): Promise<UserWithSector[]> {
  return prisma.user.findMany({
    where: { isActive: true },
    select: UserSelectPresets.withSector,
    orderBy: [
      { sector: { name: 'asc' } },
      { name: 'asc' },
    ],
  });
}

// ============================================================================
// Example 4: Employment Information
// ============================================================================

/**
 * Get comprehensive employment data for HR dashboard
 */
async function getEmployeeData(): Promise<UserWithEmployment[]> {
  return prisma.user.findMany({
    where: {
      status: { not: 'DISMISSED' },
    },
    select: UserSelectPresets.employment,
    orderBy: { payrollNumber: 'asc' },
  });
}

// ============================================================================
// Example 5: Detailed User View
// ============================================================================

/**
 * Get complete user details for profile page
 */
async function getUserDetails(userId: string): Promise<UserDetailed | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      position: true,
      sector: true,
      managedSector: true,
      avatar: true,
      ppeSize: true,
    },
  });
}

// ============================================================================
// Example 6: Custom Select Configuration
// ============================================================================

/**
 * Custom select for specific use case
 */
async function getUsersWithTaskCount() {
  const customSelect: UserSelect = {
    id: true,
    name: true,
    email: true,
    position: true,
    _count: {
      select: {
        tasks: true,
        createdTasks: true,
      },
    },
  };

  return prisma.user.findMany({
    where: { isActive: true },
    select: customSelect,
  });
}

// ============================================================================
// Example 7: Repository Pattern
// ============================================================================

class UserRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find minimal users for comboboxes
   */
  async findMinimal(activeOnly: boolean = true): Promise<UserMinimal[]> {
    return this.prisma.user.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      select: UserSelectPresets.minimal,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Find users with position
   */
  async findWithPosition(sectorId?: string): Promise<UserWithPosition[]> {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(sectorId && { sectorId }),
      },
      select: UserSelectPresets.withPosition,
    });
  }

  /**
   * Find users with employment info
   */
  async findEmployees(): Promise<UserWithEmployment[]> {
    return this.prisma.user.findMany({
      where: {
        status: { not: 'DISMISSED' },
      },
      select: UserSelectPresets.employment,
    });
  }

  /**
   * Find user by ID with full details
   */
  async findDetailed(id: string): Promise<UserDetailed | null> {
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

  /**
   * Find users with custom select
   */
  async findWithSelect<S extends UserSelect>(
    select: S,
    where?: any,
  ): Promise<UserFromSelect<S>[]> {
    return this.prisma.user.findMany({
      where,
      select,
    }) as Promise<UserFromSelect<S>[]>;
  }
}

// ============================================================================
// Example 8: Service Layer
// ============================================================================

class UserService {
  constructor(private userRepository: UserRepository) {}

  /**
   * Get users for dropdown selection
   */
  async getUsersForDropdown(): Promise<UserMinimalGetManyResponse> {
    const users = await this.userRepository.findMinimal(true);
    return {
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      meta: {
        totalRecords: users.length,
        page: 1,
        take: users.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  /**
   * Get employees for HR dashboard
   */
  async getEmployees(): Promise<UserWithEmploymentGetManyResponse> {
    const employees = await this.userRepository.findEmployees();
    return {
      success: true,
      message: 'Employees retrieved successfully',
      data: employees,
      meta: {
        totalRecords: employees.length,
        page: 1,
        take: employees.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  /**
   * Get user details for profile page
   */
  async getUserProfile(userId: string): Promise<UserDetailedGetUniqueResponse> {
    const user = await this.userRepository.findDetailed(userId);

    if (!user) {
      return {
        success: false,
        message: 'User not found',
        error: 'NOT_FOUND',
      };
    }

    return {
      success: true,
      message: 'User details retrieved successfully',
      data: user,
    };
  }
}

// ============================================================================
// Example 9: Controller/API Layer
// ============================================================================

class UserController {
  constructor(private userService: UserService) {}

  /**
   * GET /users/minimal
   * Returns minimal user data for dropdowns
   */
  async getMinimalUsers(): Promise<UserMinimalGetManyResponse> {
    return this.userService.getUsersForDropdown();
  }

  /**
   * GET /users/employees
   * Returns employee data with position and sector
   */
  async getEmployees(): Promise<UserWithEmploymentGetManyResponse> {
    return this.userService.getEmployees();
  }

  /**
   * GET /users/:id/profile
   * Returns detailed user information
   */
  async getUserProfile(userId: string): Promise<UserDetailedGetUniqueResponse> {
    return this.userService.getUserProfile(userId);
  }
}

// ============================================================================
// Example 10: Performance Comparison
// ============================================================================

async function performanceComparison() {
  console.log('=== Performance Comparison ===\n');

  // Measure full user fetch
  console.time('Full User Fetch');
  const fullUsers = await prisma.user.findMany({
    include: {
      position: true,
      sector: true,
      tasks: true,
      activities: true,
    },
  });
  console.timeEnd('Full User Fetch');
  console.log(`Full Users Size: ~${JSON.stringify(fullUsers).length} bytes\n`);

  // Measure minimal user fetch
  console.time('Minimal User Fetch');
  const minimalUsers = await prisma.user.findMany({
    select: UserSelectPresets.minimal,
  });
  console.timeEnd('Minimal User Fetch');
  console.log(`Minimal Users Size: ~${JSON.stringify(minimalUsers).length} bytes\n`);

  const reduction = (
    ((JSON.stringify(fullUsers).length - JSON.stringify(minimalUsers).length) /
      JSON.stringify(fullUsers).length) *
    100
  ).toFixed(2);
  console.log(`Performance Gain: ${reduction}% reduction in data size`);
}

// ============================================================================
// Example 11: Type Inference
// ============================================================================

/**
 * Demonstrates type inference from select configuration
 */
async function typeInferenceExample() {
  // Define custom select
  const customSelect = {
    id: true,
    name: true,
    email: true,
    position: {
      select: {
        name: true,
        hierarchy: true,
      },
    },
  } as const;

  // TypeScript infers the exact type returned
  const users = await prisma.user.findMany({
    select: customSelect,
  });

  // Type of 'users' is automatically inferred:
  // Array<{
  //   id: string;
  //   name: string;
  //   email: string | null;
  //   position: { name: string; hierarchy: number | null } | null;
  // }>

  users.forEach(user => {
    console.log(user.name); // ✓ Type-safe
    console.log(user.position?.name); // ✓ Type-safe
    // console.log(user.phone); // ✗ Type error - phone not selected
  });
}

// ============================================================================
// Example 12: Advanced Filtering with Select
// ============================================================================

async function advancedFilteringExample() {
  // Get users in specific sectors with minimal data
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      sector: {
        name: {
          in: ['Production', 'Sales'],
        },
      },
    },
    select: UserSelectPresets.withSector,
    orderBy: [
      { sector: { name: 'asc' } },
      { name: 'asc' },
    ],
  });

  return users;
}

// ============================================================================
// Example 13: Pagination with Select
// ============================================================================

async function paginatedUsersExample(page: number = 1, pageSize: number = 20) {
  const skip = (page - 1) * pageSize;

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: UserSelectPresets.employment,
      skip,
      take: pageSize,
      orderBy: { name: 'asc' },
    }),
    prisma.user.count({
      where: { isActive: true },
    }),
  ]);

  return {
    data: users,
    meta: {
      totalRecords: totalCount,
      page,
      take: pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      hasNextPage: page * pageSize < totalCount,
      hasPreviousPage: page > 1,
    },
  };
}

// ============================================================================
// Example 14: Conditional Select
// ============================================================================

async function conditionalSelectExample(includePosition: boolean = false) {
  const selectConfig: UserSelect = {
    id: true,
    name: true,
    email: true,
    ...(includePosition && { position: true }),
  };

  return prisma.user.findMany({
    select: selectConfig,
  });
}

// ============================================================================
// Export examples for use in other files
// ============================================================================

export {
  getMinimalUsers,
  getUsersWithPosition,
  getUsersBySector,
  getEmployeeData,
  getUserDetails,
  getUsersWithTaskCount,
  UserRepository,
  UserService,
  UserController,
  performanceComparison,
  typeInferenceExample,
  advancedFilteringExample,
  paginatedUsersExample,
  conditionalSelectExample,
};
