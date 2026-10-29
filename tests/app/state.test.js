import { describe, expect, it, vi } from 'vitest';
import { createState } from '../../src/app/state.js';

describe('createState', () => {
  it('clones initial input and deeply freezes the exposed snapshot', () => {
    const input = { settings: { target: 'Mars' }, points: [1, { x: 2 }] };
    const store = createState(input);
    const snapshot = store.getSnapshot();

    input.settings.target = 'Venus';
    input.points[1].x = 8;
    expect(snapshot.settings.target).toBe('Mars');
    expect(snapshot.points[1].x).toBe(2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.settings)).toBe(true);
    expect(Object.isFrozen(snapshot.points)).toBe(true);
    expect(Object.isFrozen(snapshot.points[1])).toBe(true);
    expect(() => {
      snapshot.settings.target = 'Venus';
    }).toThrow(TypeError);
  });

  it('shallowly replaces state and notifies subscribers after successful updates', () => {
    const store = createState({ target: 'Mars', settings: { scale: 1 } });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
    const oldSnapshot = store.getSnapshot();
    const patch = { target: 'Venus' };
    const nextSnapshot = store.update(patch);

    expect(nextSnapshot).toBe(store.getSnapshot());
    expect(nextSnapshot).not.toBe(oldSnapshot);
    expect(nextSnapshot).toEqual({ target: 'Venus', settings: { scale: 1 } });
    expect(nextSnapshot.settings).toBe(oldSnapshot.settings);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(nextSnapshot);

    patch.target = 'Jupiter';
    expect(nextSnapshot.target).toBe('Venus');
    unsubscribe();
    store.update({ target: 'Earth' });
    expect(listener).toHaveBeenCalledOnce();
    expect(oldSnapshot.target).toBe('Mars');
  });

  it('rejects invalid patches without replacing or notifying', () => {
    const store = createState({ safe: true, nested: { value: 1 } });
    const listener = vi.fn();
    store.subscribe(listener);
    const original = store.getSnapshot();

    for (const patch of [
      null,
      [],
      { value: Infinity },
      { value: new Date() },
      { value: new Map() },
      { value: new Set() },
      { value: undefined },
      { value: () => {} },
    ]) {
      expect(() => store.update(patch)).toThrow(TypeError);
      expect(store.getSnapshot()).toBe(original);
      expect(listener).not.toHaveBeenCalled();
    }
  });

  it('rejects non-JSON-like initial state and cyclic data', () => {
    for (const invalid of [
      null,
      [],
      new Date(),
      new Map(),
      new Set(),
      { value: NaN },
      { value: undefined },
    ]) {
      expect(() => createState(invalid)).toThrow(TypeError);
    }

    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => createState(cyclic)).toThrow(TypeError);
  });

  it('validates listeners and returns an effective unsubscribe function', () => {
    const store = createState({ count: 0 });
    expect(() => store.subscribe(null)).toThrow(TypeError);

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(unsubscribe()).toBe(true);
    expect(unsubscribe()).toBe(false);
    store.update({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
