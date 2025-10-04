interface PageAccess {
  path: string;
  title: string;
  icon?: string;
  count: number;
  lastAccessed: string;
}

const PAGE_ACCESS_KEY = "ankaa_page_access";
const MAX_TRACKED_PAGES = 20;

export function trackPageAccess(path: string, title: string, icon?: string): void {
  try {
    const storedData = localStorage.getItem(PAGE_ACCESS_KEY);
    const pageAccesses: PageAccess[] = storedData ? JSON.parse(storedData) : [];

    const existingIndex = pageAccesses.findIndex((page) => page.path === path);

    if (existingIndex >= 0) {
      // Update existing entry
      pageAccesses[existingIndex].count += 1;
      pageAccesses[existingIndex].lastAccessed = new Date().toISOString();
      pageAccesses[existingIndex].title = title; // Update title in case it changed
      if (icon) pageAccesses[existingIndex].icon = icon;
    } else {
      // Add new entry
      pageAccesses.push({
        path,
        title,
        icon,
        count: 1,
        lastAccessed: new Date().toISOString(),
      });
    }

    // Keep only the most accessed pages
    if (pageAccesses.length > MAX_TRACKED_PAGES) {
      pageAccesses.sort((a, b) => b.count - a.count);
      pageAccesses.splice(MAX_TRACKED_PAGES);
    }

    localStorage.setItem(PAGE_ACCESS_KEY, JSON.stringify(pageAccesses));
  } catch (error) {
    // Fail silently if localStorage is not available
    console.error("Failed to track page access:", error);
  }
}

export function getMostAccessedPages(limit: number = 6): PageAccess[] {
  try {
    const storedData = localStorage.getItem(PAGE_ACCESS_KEY);
    if (!storedData) return [];

    const pageAccesses: PageAccess[] = JSON.parse(storedData);

    // Sort by count (descending) and then by last accessed (most recent first)
    return pageAccesses
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime();
      })
      .slice(0, limit);
  } catch (error) {
    console.error("Failed to get most accessed pages:", error);
    return [];
  }
}

export function clearPageAccessHistory(): void {
  try {
    localStorage.removeItem(PAGE_ACCESS_KEY);
  } catch (error) {
    console.error("Failed to clear page access history:", error);
  }
}

export function getPageAccessStats(): {
  totalPages: number;
  totalAccesses: number;
  mostVisited: PageAccess | null;
} {
  try {
    const storedData = localStorage.getItem(PAGE_ACCESS_KEY);
    if (!storedData) {
      return { totalPages: 0, totalAccesses: 0, mostVisited: null };
    }

    const pageAccesses: PageAccess[] = JSON.parse(storedData);
    const totalAccesses = pageAccesses.reduce((sum, page) => sum + page.count, 0);
    const mostVisited = pageAccesses.length > 0 ? pageAccesses.reduce((prev, current) => (prev.count > current.count ? prev : current)) : null;

    return {
      totalPages: pageAccesses.length,
      totalAccesses,
      mostVisited,
    };
  } catch (error) {
    console.error("Failed to get page access stats:", error);
    return { totalPages: 0, totalAccesses: 0, mostVisited: null };
  }
}
