function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defineDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneAndFreeze(value, ancestors = new WeakSet(), clones = new WeakMap()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('state numbers must be finite');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('state values must be JSON-like data');
  }

  if (ancestors.has(value)) {
    throw new TypeError('state values cannot contain cycles');
  }
  if (clones.has(value)) return clones.get(value);

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : !isPlainObject(value)) {
    throw new TypeError('state objects must be plain objects or plain arrays');
  }

  const copy = isArray ? new Array(value.length) : Object.create(prototype);
  clones.set(value, copy);
  ancestors.add(value);

  const keys = Reflect.ownKeys(value);
  let arrayItems = 0;
  for (const key of keys) {
    if (isArray && key === 'length') continue;
    if (typeof key !== 'string') {
      throw new TypeError('state objects cannot have symbol keys');
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('state properties must be enumerable data properties');
    }

    if (isArray) {
      const index = Number(key);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== key
      ) {
        throw new TypeError('state arrays cannot have extra properties');
      }
      arrayItems += 1;
    }

    defineDataProperty(copy, key, cloneAndFreeze(descriptor.value, ancestors, clones));
  }

  if (isArray && arrayItems !== value.length) {
    throw new TypeError('state arrays cannot be sparse');
  }

  ancestors.delete(value);
  return Object.freeze(copy);
}

function clonePlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return cloneAndFreeze(value);
}

function mergeShallow(current, patch) {
  const merged = Object.create(Object.getPrototypeOf(current));
  for (const key of Object.keys(current)) {
    defineDataProperty(merged, key, current[key]);
  }
  for (const key of Object.keys(patch)) {
    defineDataProperty(merged, key, patch[key]);
  }
  return merged;
}

/**
 * Create a small immutable-snapshot store. Values are finite JSON-like data;
 * updates shallow-merge a patch, replace the snapshot, then notify listeners.
 */
export function createState(initialState) {
  let snapshot = clonePlainObject(initialState, 'initialState');
  const listeners = new Set();

  return {
    getSnapshot() {
      return snapshot;
    },

    update(patch) {
      const clonedPatch = clonePlainObject(patch, 'patch');
      // Existing values are already deeply frozen; patch values were cloned
      // and frozen above, so freezing the merged root preserves shallow-update
      // identity without exposing mutable data.
      const nextSnapshot = Object.freeze(mergeShallow(snapshot, clonedPatch));
      snapshot = nextSnapshot;
      for (const listener of [...listeners]) {
        listener(nextSnapshot);
      }
      return nextSnapshot;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('listener must be a function');
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
