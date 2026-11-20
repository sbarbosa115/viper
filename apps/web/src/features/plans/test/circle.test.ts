import { describe, expect, test } from 'vitest';
import { circleRing, ringBounds } from '../lib/circle';

describe('FR-17: search area circle', () => {
  test('a closed ring about one radius from the centre', () => {
    const ring = circleRing(30.2672, -97.7431, 3);
    expect(ring[0]).toEqual(ring.at(-1));
    const [[west, south], [east, north]] = ringBounds(ring);
    // 3 miles is about 0.0434 degrees of latitude.
    expect((north - south) / 2).toBeCloseTo(0.0434, 3);
    expect((east + west) / 2).toBeCloseTo(-97.7431, 4);
  });
});
