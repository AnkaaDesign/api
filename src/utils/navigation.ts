// packages/utils/src/navigation.ts
// Navigation utility functions moved from constants package

import type { MenuItem } from '@constants';
import { SECTOR_PRIVILEGES, TABLER_ICONS } from '@constants';

export type { MenuItem };

// Define minimal user interface for navigation
interface NavigationUser {
  sector?: {
    privileges?: SECTOR_PRIVILEGES;
  };
  position?: {
    sector?: {
      privileges?: SECTOR_PRIVILEGES;
    };
  };
}

/**
 * Get filtered menu for a specific user and platform
 */
export function getFilteredMenuForUser(
  menuItems: MenuItem[],
  user: NavigationUser,
  platform: 'web' | 'mobile',
): MenuItem[] {
  let filteredMenu = filterMenuByPlatform(menuItems, platform);

  // Apply privilege filtering if user has sector/privileges
  const userPrivilege = user?.sector?.privileges || user?.position?.sector?.privileges;
  if (userPrivilege) {
    filteredMenu = filterMenuByPrivileges(filteredMenu, userPrivilege as SECTOR_PRIVILEGES);
  }

  return filteredMenu;
}

/**
 * Get Tabler icon name for a given icon key
 */
export function getTablerIcon(iconKey: string): string {
  const icon = TABLER_ICONS[iconKey as keyof typeof TABLER_ICONS];
  if (!icon) return iconKey; // Return original if not found
  return icon;
}

/**
 * Check if user has access to menu item based on privilege requirements
 * Uses exact matching for navigation (not hierarchical)
 */
function hasMenuItemAccess(item: MenuItem, userPrivilege?: SECTOR_PRIVILEGES): boolean {
  // If no privilege required, show to all
  if (!item.requiredPrivilege) return true;

  // If user has no privilege, hide privileged items
  if (!userPrivilege) return false;

  // Handle array of privileges
  if (Array.isArray(item.requiredPrivilege)) {
    // OR logic - user needs to have EXACTLY one of the specified privileges
    return item.requiredPrivilege.includes(userPrivilege);
  }

  // Handle single privilege - exact match only
  return userPrivilege === item.requiredPrivilege;
}

/**
 * Filter menu items based on user privileges
 * Now supports both single privileges and arrays of privileges
 */
export function filterMenuByPrivileges(
  menuItems: MenuItem[],
  userPrivilege?: SECTOR_PRIVILEGES,
): MenuItem[] {
  return menuItems
    .filter(item => hasMenuItemAccess(item, userPrivilege))
    .map(item => {
      // Recursively filter children
      if (item.children) {
        return {
          ...item,
          children: filterMenuByPrivileges(item.children, userPrivilege),
        };
      }
      return item;
    })
    .filter(item => {
      // Remove items with no children after filtering
      if (item.children && item.children.length === 0) return false;
      return true;
    });
}

/**
 * Filter menu items by platform
 * Note: MenuItem interface doesn't have platforms field anymore, but keeping for backward compatibility
 */
export function filterMenuByPlatform(
  menuItems: MenuItem[],
  platform: 'web' | 'mobile',
): MenuItem[] {
  return menuItems
    .filter(() => {
      // Since platforms field was removed, show all items on all platforms
      return true;
    })
    .map(item => {
      // Recursively filter children
      if (item.children) {
        return {
          ...item,
          children: filterMenuByPlatform(item.children, platform),
        };
      }
      return item;
    });
}

/**
 * Get control panel items (dashboards for each domain)
 */
export function getControlPanelItems(menuItems: MenuItem[]): MenuItem[] {
  const controlPanels: MenuItem[] = [];

  function extractControlPanels(items: MenuItem[]) {
    items.forEach(item => {
      if (item.isControlPanel) {
        controlPanels.push(item);
      }
      if (item.children) {
        extractControlPanels(item.children);
      }
    });
  }

  extractControlPanels(menuItems);
  return controlPanels;
}

/**
 * Get flattened list of all routes
 */
export function getAllRoutes(menuItems: MenuItem[]): string[] {
  const routes: string[] = [];

  function extractRoutes(items: MenuItem[]) {
    items.forEach(item => {
      if (item.path && !item.isDynamic) {
        routes.push(item.path);
      }
      if (item.children) {
        extractRoutes(item.children);
      }
    });
  }

  extractRoutes(menuItems);
  return routes;
}

/**
 * Find menu item by path
 */
export function findMenuItemByPath(menuItems: MenuItem[], path: string): MenuItem | null {
  for (const item of menuItems) {
    if (item.path === path) return item;

    if (item.children) {
      const found = findMenuItemByPath(item.children, path);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get breadcrumb items for a given path
 */
export function getBreadcrumbs(menuItems: MenuItem[], path: string): MenuItem[] {
  const breadcrumbs: MenuItem[] = [];

  function matchPath(menuPath: string, actualPath: string): boolean {
    // Exact match
    if (menuPath === actualPath) return true;

    // Dynamic route match
    if (menuPath.includes(':')) {
      // Convert route pattern to regex
      // /estoque/produtos/detalhes/:id -> /estoque/produtos/detalhes/[^/]+
      const pattern = menuPath.replace(/:[^/]+/g, '[^/]+');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(actualPath);
    }

    return false;
  }

  function findPath(items: MenuItem[], currentPath: MenuItem[] = []): boolean {
    for (const item of items) {
      const newPath = [...currentPath, item];

      if (item.path && matchPath(item.path, path)) {
        breadcrumbs.push(...newPath);
        return true;
      }

      if (item.children) {
        if (findPath(item.children, newPath)) {
          return true;
        }
      }
    }
    return false;
  }

  findPath(menuItems);
  return breadcrumbs;
}

/**
 * Get menu items for a specific domain
 */
export function getMenuItemsByDomain(menuItems: MenuItem[], domain: string): MenuItem | undefined {
  return menuItems.find(item => item.id === domain);
}

/**
 * Check if user has access to a specific menu item
 * Uses exact matching for navigation (not hierarchical)
 */
export function hasAccessToMenuItem(item: MenuItem, userPrivilege?: SECTOR_PRIVILEGES): boolean {
  if (!item.requiredPrivilege) return true;
  if (!userPrivilege) return false;

  // Handle array of privileges
  if (Array.isArray(item.requiredPrivilege)) {
    // OR logic - user needs to have EXACTLY one of the specified privileges
    return item.requiredPrivilege.includes(userPrivilege);
  }

  // Handle single privilege - exact match only
  return userPrivilege === item.requiredPrivilege;
}
