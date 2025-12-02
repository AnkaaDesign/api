// packages/utils/src/routes.ts
// Route utility functions moved from constants package

import { routes } from '@constants';

/**
 * Helper function to generate dynamic routes
 */
export function generateRoute(template: (param: string) => string, param: string): string {
  return template(param);
}

/**
 * Helper function to get all routes as flat array
 */
export function getAllRoutePaths(): string[] {
  const paths: string[] = [];

  function extractPaths(obj: Record<string, unknown>, basePath = '') {
    for (const [, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        paths.push(value);
      } else if (typeof value === 'object' && value !== null) {
        extractPaths(value as Record<string, unknown>, basePath);
      }
    }
  }

  extractPaths(routes);
  return Array.from(new Set(paths)).sort();
}

/**
 * Helper function to validate if a path exists in routes
 */
export function isValidRoute(path: string): boolean {
  const allPaths = getAllRoutePaths();
  return allPaths.includes(path);
}

/**
 * Get parent route from a given path
 */
export function getParentRoute(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return '/';
  return '/' + segments.slice(0, -1).join('/');
}

/**
 * Get route depth (number of segments)
 */
export function getRouteDepth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/**
 * Build breadcrumb paths from a route
 */
export function buildBreadcrumbPaths(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const paths: string[] = ['/'];

  for (let i = 1; i <= segments.length; i++) {
    paths.push('/' + segments.slice(0, i).join('/'));
  }

  return paths;
}

/**
 * Check if route matches pattern (supports :param syntax)
 */
export function matchesPattern(route: string, pattern: string): boolean {
  const routeParts = route.split('/');
  const patternParts = pattern.split('/');

  if (routeParts.length !== patternParts.length) return false;

  return patternParts.every((part, index) => {
    return part.startsWith(':') || part === routeParts[index];
  });
}

/**
 * Extract route parameters from a route using a pattern
 */
export function extractRouteParams(route: string, pattern: string): Record<string, string> {
  const routeParts = route.split('/');
  const patternParts = pattern.split('/');
  const params: Record<string, string> = {};

  if (routeParts.length !== patternParts.length) return params;

  patternParts.forEach((part, index) => {
    if (part.startsWith(':')) {
      const paramName = part.substring(1);
      params[paramName] = routeParts[index];
    }
  });

  return params;
}

/**
 * Normalize route by removing trailing slashes
 */
export function normalizeRoute(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}
