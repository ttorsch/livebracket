/**
 * Logic and utilities for resolving mobile horizontal tab swipe gestures.
 */

export interface SwipeResolution<T extends string> {
  type: 'next' | 'prev' | 'none';
  targetTab: T | null;
}

export interface ResolveTabSwipeParams<T extends string> {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  tabs: readonly T[];
  activeTab: T;
  threshold?: number;
  slopeRatio?: number;
}

/**
 * Resolves whether a touch gesture is a valid horizontal swipe to switch tabs.
 *
 * Rules:
 * 1. Must exceed horizontal distance threshold (default: 45px).
 * 2. Must be predominantly horizontal (|deltaX| > |deltaY| * slopeRatio).
 * 3. Left swipe (deltaX < 0) advances to the next tab.
 * 4. Right swipe (deltaX > 0) goes to the previous tab.
 * 5. Does nothing when already at the first or last tab boundary.
 */
export function resolveTabSwipe<T extends string>({
  startX,
  startY,
  endX,
  endY,
  tabs,
  activeTab,
  threshold = 45,
  slopeRatio = 1.3,
}: ResolveTabSwipeParams<T>): SwipeResolution<T> {
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  // Must exceed threshold distance and be predominantly horizontal
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * slopeRatio) {
    return { type: 'none', targetTab: null };
  }

  const currentIndex = tabs.indexOf(activeTab);
  if (currentIndex === -1) {
    return { type: 'none', targetTab: null };
  }

  if (deltaX < 0) {
    // Swiped left -> Next tab
    if (currentIndex < tabs.length - 1) {
      return { type: 'next', targetTab: tabs[currentIndex + 1] };
    }
  } else {
    // Swiped right -> Previous tab
    if (currentIndex > 0) {
      return { type: 'prev', targetTab: tabs[currentIndex - 1] };
    }
  }

  return { type: 'none', targetTab: null };
}

/**
 * Checks whether the touch started within 20px of the viewport edge.
 * Useful to avoid conflicting with browser native back/forward history swipe gestures.
 */
export function isNearScreenEdge(clientX: number, edgeMargin = 20, windowWidth?: number): boolean {
  const width = windowWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  if (width <= 0) return false;
  return clientX < edgeMargin || clientX > width - edgeMargin;
}

/**
 * Known CSS class substrings that denote horizontally scrollable / pannable areas
 * where gestures should pan the content rather than switch tabs.
 */
const EXCLUDED_CLASS_PATTERNS = [
  'bracketScroll',
  'courtsGrid',
  'cardDivisionsSection',
  'segmentedControl',
  'tabBarInner',
  'filterBar',
  'tableScroll',
];

/**
 * Inspects an element or its ancestors to determine if touch gestures should be
 * excluded from tab switching.
 */
export function shouldExcludeSwipeTarget(target: HTMLElement | null): boolean {
  if (!target || typeof window === 'undefined') return false;

  // Form controls and interactive sliders
  if (target.closest('[data-no-swipe], input, textarea, select, [role="slider"]')) {
    return true;
  }

  // Walk up ancestor tree checking for known scroll containers or horizontally scrollable elements
  let curr: HTMLElement | null = target;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const className = typeof curr.className === 'string' ? curr.className : '';
    for (const pattern of EXCLUDED_CLASS_PATTERNS) {
      if (className.includes(pattern)) {
        return true;
      }
    }

    // Dynamic scroll check: overflow-x is auto/scroll and the content exceeds visible width
    try {
      const style = window.getComputedStyle(curr);
      const ox = style.overflowX;
      if ((ox === 'auto' || ox === 'scroll') && curr.scrollWidth > curr.clientWidth + 4) {
        return true;
      }
    } catch {
      // getComputedStyle may fail in non-browser or test environments
    }

    curr = curr.parentElement;
  }

  return false;
}
