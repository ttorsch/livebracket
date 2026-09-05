'use client';

import { useCallback, useEffect, useRef } from 'react';

/* Click-and-drag panning for a horizontal scroller.
 *
 * Touch already pans natively, and a touch drag that also ran this logic
 * would scroll twice as fast, so this binds to the mouse only — pointerType
 * is the gate, not a media query.
 *
 * Movement is applied 1:1 against the pointer: scrollLeft moves by exactly
 * the distance the pointer moved, and the scroller stops where the button is
 * released. That is why the caller must also drop scroll-snap; snap would
 * take the release position and slide it somewhere else, which is the
 * "snap to card" behaviour this replaces.
 *
 * Anything clickable inside the scroller (a player name, say) would
 * otherwise fire on release at the end of a drag. Past a few pixels of
 * travel the gesture is a pan rather than a click, so the next click is
 * swallowed in the capture phase before it reaches the target.
 */
const DRAG_THRESHOLD_PX = 4;

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const stateRef = useRef({ down: false, dragged: false, startX: 0, startScroll: 0, pointerId: -1 });

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    stateRef.current = {
      down: true,
      dragged: false,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      pointerId: e.pointerId,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const st = stateRef.current;
    const el = ref.current;
    if (!st.down || !el) return;
    const dx = e.clientX - st.startX;
    if (!st.dragged) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      st.dragged = true;
      // Captured only once the gesture is definitely a pan, so a plain click
      // on a card is never stolen from it.
      try { el.setPointerCapture(st.pointerId); } catch { /* capture is best-effort */ }
    }
    // Text selection would otherwise highlight team names as the pan runs.
    e.preventDefault();
    el.scrollLeft = st.startScroll - dx;
  }, []);

  const endDrag = useCallback(() => {
    const st = stateRef.current;
    const el = ref.current;
    if (el && st.dragged && el.hasPointerCapture?.(st.pointerId)) {
      try { el.releasePointerCapture(st.pointerId); } catch { /* already released */ }
    }
    st.down = false;
    // `dragged` is deliberately left set — the click that follows this
    // pointerup is the one to swallow. The capture listener clears it.
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const swallowClickAfterDrag = (e: MouseEvent) => {
      if (!stateRef.current.dragged) return;
      stateRef.current.dragged = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('click', swallowClickAfterDrag, true);
    return () => el.removeEventListener('click', swallowClickAfterDrag, true);
  }, []);

  return {
    ref,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
