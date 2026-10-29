/** Unit-agnostic vector math on finite [x, y, z] arrays; invalid inputs throw. */
function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function requireVector(vector, name) {
  if (
    !Array.isArray(vector) ||
    Object.getPrototypeOf(vector) !== Array.prototype ||
    vector.length !== 3
  ) {
    throw new TypeError(`${name} must be a plain array of three numbers`);
  }

  for (let index = 0; index < 3; index += 1) {
    requireFiniteNumber(vector[index], `${name}[${index}]`);
  }
}

function requireFiniteResult(value) {
  if (!Number.isFinite(value)) {
    throw new RangeError('vector operation produced a non-finite result');
  }
  return value;
}

/** Add two finite three-component plain-array vectors. */
export function add(left, right) {
  requireVector(left, 'left');
  requireVector(right, 'right');
  return [
    requireFiniteResult(left[0] + right[0]),
    requireFiniteResult(left[1] + right[1]),
    requireFiniteResult(left[2] + right[2]),
  ];
}

/** Subtract the right vector from the left vector. */
export function subtract(left, right) {
  requireVector(left, 'left');
  requireVector(right, 'right');
  return [
    requireFiniteResult(left[0] - right[0]),
    requireFiniteResult(left[1] - right[1]),
    requireFiniteResult(left[2] - right[2]),
  ];
}

/** Multiply a finite three-component vector by a finite scalar. */
export function scale(vector, scalar) {
  requireVector(vector, 'vector');
  requireFiniteNumber(scalar, 'scalar');
  return [
    requireFiniteResult(vector[0] * scalar),
    requireFiniteResult(vector[1] * scalar),
    requireFiniteResult(vector[2] * scalar),
  ];
}

/** Return the dot product of two finite three-component vectors. */
export function dot(left, right) {
  requireVector(left, 'left');
  requireVector(right, 'right');
  return requireFiniteResult(
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2],
  );
}

/** Return the cross product of two finite three-component vectors. */
export function cross(left, right) {
  requireVector(left, 'left');
  requireVector(right, 'right');
  return [
    requireFiniteResult(left[1] * right[2] - left[2] * right[1]),
    requireFiniteResult(left[2] * right[0] - left[0] * right[2]),
    requireFiniteResult(left[0] * right[1] - left[1] * right[0]),
  ];
}

/** Return the Euclidean magnitude of a finite three-component vector. */
export function magnitude(vector) {
  requireVector(vector, 'vector');
  return requireFiniteResult(Math.hypot(vector[0], vector[1], vector[2]));
}

/** Normalize a vector; the zero vector is invalid and throws RangeError. */
export function normalize(vector) {
  requireVector(vector, 'vector');
  // Scale first: the direction remains representable even when its original
  // magnitude overflows, or its components are subnormal.
  const largest = Math.max(Math.abs(vector[0]), Math.abs(vector[1]), Math.abs(vector[2]));
  if (largest === 0) {
    throw new RangeError('cannot normalize the zero vector');
  }
  const scaled = [vector[0] / largest, vector[1] / largest, vector[2] / largest];
  const length = Math.hypot(...scaled);
  return [scaled[0] / length, scaled[1] / length, scaled[2] / length];
}
