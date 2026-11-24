import * as THREE from 'three';

const STAR_COUNT = 960;
const SKY_RADIUS = 60;

/** Fixed stars surrounding the viewer, outside the interactive workbench. */
export function createStarfield() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const cool = new THREE.Color('#a6c4ed');
  const warm = new THREE.Color('#ffe0bb');
  const color = new THREE.Color();
  // Stable brightness and color across reloads and both eyes.
  let seed = 0x759623fc;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const height = random() * 2 - 1;
    const longitude = random() * Math.PI * 2;
    const radius = SKY_RADIUS * Math.sqrt(1 - height * height);
    const offset = 3 * index;
    positions[offset] = radius * Math.cos(longitude);
    positions[offset + 1] = SKY_RADIUS * height;
    positions[offset + 2] = radius * Math.sin(longitude);
    color.copy(cool).lerp(warm, random()).multiplyScalar(0.06 + random() ** 3 * 0.67);
    color.toArray(colors, offset);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.8,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
    toneMapped: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = 'Distant stars';
  return {
    stars,
    dispose() {
      stars.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
