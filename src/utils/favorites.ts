import { FAVORITE_PAGES } from '@constants';

const FAVORITES_KEY = 'ankaa_favorite_pages';

export interface FavoritePage {
  page: FAVORITE_PAGES;
  addedAt: string;
}

export function getFavoritePages(): FavoritePage[] {
  try {
    const storedData = localStorage.getItem(FAVORITES_KEY);
    if (!storedData) return [];

    return JSON.parse(storedData) as FavoritePage[];
  } catch (error) {
    console.error('Failed to get favorite pages:', error);
    return [];
  }
}

export function isFavoritePage(page: FAVORITE_PAGES): boolean {
  const favorites = getFavoritePages();
  return favorites.some(fav => fav.page === page);
}

export function toggleFavoritePage(page: FAVORITE_PAGES): boolean {
  try {
    const favorites = getFavoritePages();
    const existingIndex = favorites.findIndex(fav => fav.page === page);

    if (existingIndex >= 0) {
      // Remove from favorites
      favorites.splice(existingIndex, 1);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      return false; // Now not favorited
    } else {
      // Add to favorites
      favorites.push({
        page,
        addedAt: new Date().toISOString(),
      });
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      return true; // Now favorited
    }
  } catch (error) {
    console.error('Failed to toggle favorite page:', error);
    return false;
  }
}

export function addFavoritePage(page: FAVORITE_PAGES): boolean {
  try {
    const favorites = getFavoritePages();
    const alreadyExists = favorites.some(fav => fav.page === page);

    if (!alreadyExists) {
      favorites.push({
        page,
        addedAt: new Date().toISOString(),
      });
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }

    return true;
  } catch (error) {
    console.error('Failed to add favorite page:', error);
    return false;
  }
}

export function removeFavoritePage(page: FAVORITE_PAGES): boolean {
  try {
    const favorites = getFavoritePages();
    const filteredFavorites = favorites.filter(fav => fav.page !== page);

    if (filteredFavorites.length !== favorites.length) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(filteredFavorites));
      return true;
    }

    return false;
  } catch (error) {
    console.error('Failed to remove favorite page:', error);
    return false;
  }
}

export function clearFavoritePages(): void {
  try {
    localStorage.removeItem(FAVORITES_KEY);
  } catch (error) {
    console.error('Failed to clear favorite pages:', error);
  }
}

export function getFavoritePagesCount(): number {
  return getFavoritePages().length;
}

// Sort favorites by most recently added first
export function getFavoritePagesSorted(): FavoritePage[] {
  return getFavoritePages().sort(
    (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
  );
}
