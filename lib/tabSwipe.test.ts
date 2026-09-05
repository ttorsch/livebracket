import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTabSwipe, isNearScreenEdge } from './tabSwipe.ts';

describe('tabSwipe logic', () => {
  const sampleTabs = ['Schedule', 'Round 1', 'Round 2', 'Teams', 'Rules'] as const;

  describe('resolveTabSwipe', () => {
    it('swiping left advances to the next tab', () => {
      const res = resolveTabSwipe({
        startX: 200,
        startY: 300,
        endX: 130, // deltaX = -70
        endY: 305, // deltaY = +5
        tabs: sampleTabs,
        activeTab: 'Round 1',
      });
      assert.equal(res.type, 'next');
      assert.equal(res.targetTab, 'Round 2');
    });

    it('swiping right moves to the previous tab', () => {
      const res = resolveTabSwipe({
        startX: 100,
        startY: 300,
        endX: 180, // deltaX = +80
        endY: 310, // deltaY = +10
        tabs: sampleTabs,
        activeTab: 'Round 2',
      });
      assert.equal(res.type, 'prev');
      assert.equal(res.targetTab, 'Round 1');
    });

    it('does nothing when swiping left on the last tab', () => {
      const res = resolveTabSwipe({
        startX: 250,
        startY: 300,
        endX: 150, // deltaX = -100
        endY: 300,
        tabs: sampleTabs,
        activeTab: 'Rules',
      });
      assert.equal(res.type, 'none');
      assert.equal(res.targetTab, null);
    });

    it('does nothing when swiping right on the first tab', () => {
      const res = resolveTabSwipe({
        startX: 100,
        startY: 300,
        endX: 200, // deltaX = +100
        endY: 300,
        tabs: sampleTabs,
        activeTab: 'Schedule',
      });
      assert.equal(res.type, 'none');
      assert.equal(res.targetTab, null);
    });

    it('does nothing if swipe distance is below threshold', () => {
      const res = resolveTabSwipe({
        startX: 100,
        startY: 200,
        endX: 70, // deltaX = -30 (< 45)
        endY: 200,
        tabs: sampleTabs,
        activeTab: 'Round 1',
        threshold: 45,
      });
      assert.equal(res.type, 'none');
      assert.equal(res.targetTab, null);
    });

    it('does nothing if swipe is primarily vertical (user is scrolling down/up)', () => {
      const res = resolveTabSwipe({
        startX: 150,
        startY: 200,
        endX: 90,  // deltaX = -60
        endY: 350, // deltaY = +150
        tabs: sampleTabs,
        activeTab: 'Round 1',
        threshold: 45,
        slopeRatio: 1.3,
      });
      assert.equal(res.type, 'none');
      assert.equal(res.targetTab, null);
    });

    it('does nothing if swipe is diagonal without dominant horizontal intent', () => {
      const res = resolveTabSwipe({
        startX: 100,
        startY: 100,
        endX: 160, // deltaX = 60
        endY: 155, // deltaY = 55 (60 is not > 55 * 1.3 = 71.5)
        tabs: sampleTabs,
        activeTab: 'Round 1',
        slopeRatio: 1.3,
      });
      assert.equal(res.type, 'none');
      assert.equal(res.targetTab, null);
    });

    it('does nothing if activeTab is not in tabs array', () => {
      const res = resolveTabSwipe({
        startX: 200,
        startY: 200,
        endX: 100,
        endY: 200,
        tabs: sampleTabs,
        activeTab: 'NonExistent' as any,
      });
      assert.equal(res.type, 'none');
      assert.equal(res.targetTab, null);
    });
  });

  describe('isNearScreenEdge', () => {
    const windowWidth = 390; // iPhone screen width

    it('detects touches within edgeMargin from left edge', () => {
      assert.equal(isNearScreenEdge(5, 20, windowWidth), true);
      assert.equal(isNearScreenEdge(19, 20, windowWidth), true);
    });

    it('detects touches within edgeMargin from right edge', () => {
      assert.equal(isNearScreenEdge(385, 20, windowWidth), true);
      assert.equal(isNearScreenEdge(372, 20, windowWidth), true);
    });

    it('allows touches safely inside the screen bounds', () => {
      assert.equal(isNearScreenEdge(50, 20, windowWidth), false);
      assert.equal(isNearScreenEdge(200, 20, windowWidth), false);
      assert.equal(isNearScreenEdge(350, 20, windowWidth), false);
    });
  });
});
