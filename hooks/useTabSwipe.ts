'use client';

import { useRef, useCallback } from 'react';
import {
  resolveTabSwipe,
  shouldExcludeSwipeTarget,
  isNearScreenEdge,
} from '../lib/tabSwipe';

export interface UseTabSwipeOptions<T extends string> {
  /** Ordered list of tab identifiers */
  tabs: readonly T[];
  /** Currently active tab identifier */
  activeTab: T;
  /** Callback fired when user swipes to an adjacent tab */
  onTabChange: (nextTab: T) => void;
  /** Minimum horizontal pixel distance to trigger swipe (default: 45) */
  threshold?: number;
  /**
   * Horizontal to vertical ratio requirement to ensure horizontal intent
   * (e.g. 1.3 means deltaX must be 1.3x larger than deltaY). Default: 1.3.
   */
  slopeRatio?: number;
  /** Optional custom check to ignore swipe from certain targets */
  isExcluded?: (target: HTMLElement) => boolean;
  /** Whether the swipe gesture is enabled (default: true) */
  enabled?: boolean;
}

export function useTabSwipe<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  threshold = 45,
  slopeRatio = 1.3,
  isExcluded,
  enabled = true,
}: UseTabSwipeOptions<T>) {
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const isIgnoredRef = useRef<boolean>(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        isIgnoredRef.current = true;
        return;
      }

      // Check mobile viewport width
      if (typeof window !== 'undefined' && window.innerWidth > 960) {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        isIgnoredRef.current = true;
        return;
      }

      const clientX = e.touches[0].clientX;
      const clientY = e.touches[0].clientY;

      // Ignore edge touches to avoid conflicting with browser back/forward history swipe
      if (isNearScreenEdge(clientX, 20)) {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        isIgnoredRef.current = true;
        return;
      }

      const target = e.target as HTMLElement;
      if (shouldExcludeSwipeTarget(target) || isExcluded?.(target)) {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        isIgnoredRef.current = true;
        return;
      }

      isIgnoredRef.current = false;
      touchStartXRef.current = clientX;
      touchStartYRef.current = clientY;
    },
    [enabled, isExcluded]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isIgnoredRef.current || touchStartXRef.current === null || touchStartYRef.current === null) {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        isIgnoredRef.current = false;
        return;
      }

      const target = e.target as HTMLElement;
      if (shouldExcludeSwipeTarget(target) || isExcluded?.(target)) {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        isIgnoredRef.current = false;
        return;
      }

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;

      const result = resolveTabSwipe({
        startX: touchStartXRef.current,
        startY: touchStartYRef.current,
        endX,
        endY,
        tabs,
        activeTab,
        threshold,
        slopeRatio,
      });

      touchStartXRef.current = null;
      touchStartYRef.current = null;
      isIgnoredRef.current = false;

      if (result.targetTab) {
        onTabChange(result.targetTab);
      }
    },
    [activeTab, tabs, onTabChange, threshold, slopeRatio, isExcluded]
  );

  const onTouchCancel = useCallback(() => {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    isIgnoredRef.current = false;
  }, []);

  return {
    onTouchStart,
    onTouchEnd,
    onTouchCancel,
  };
}
