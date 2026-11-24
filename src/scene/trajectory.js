import * as THREE from 'three';
import { AU_KM } from '../physics/constants.js';

function isFiniteVectorKm(vector) {
  return Array.isArray(vector)
    && vector.length === 3
    && [0, 1, 2].every((index) => typeof vector[index] === 'number' && Number.isFinite(vector[index]));
}

function setEclipticPosition(object, positionKm) {
  object.position.set(
    positionKm[0] / AU_KM,
    positionKm[2] / AU_KM,
    -positionKm[1] / AU_KM,
  );
}

/** Own the selected propagated conic and its non-animated position marker. */
export function createTrajectory(scene) {
  const material = new THREE.LineBasicMaterial({
    color: 0x245da8,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  let geometry = new THREE.BufferGeometry();
  const line = new THREE.Line(geometry, material);
  line.name = 'Selected transfer conic';
  line.visible = false;
  scene.add(line);

  const markerGeometry = new THREE.SphereGeometry(1, 12, 8);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xb45b28 });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  marker.name = 'Propagated spacecraft position';
  marker.scale.setScalar(0.018);
  marker.visible = false;
  scene.add(marker);

  let transferValid = false;
  let disposed = false;

  function clear() {
    transferValid = false;
    line.visible = false;
    marker.visible = false;
  }

  function setTransfer(transfer, samples) {
    if (
      !transfer?.valid
      || !samples?.valid
      || !Array.isArray(samples.points)
      || samples.points.length < 2
      || !samples.points.every(isFiniteVectorKm)
    ) {
      clear();
      return;
    }

    const pointCount = samples.points.length;
    const positions = new Float32Array(pointCount * 3);
    for (let index = 0; index < pointCount; index += 1) {
      const point = samples.points[index];
      const offset = index * 3;
      positions[offset] = point[0] / AU_KM;
      positions[offset + 1] = point[2] / AU_KM;
      positions[offset + 2] = -point[1] / AU_KM;
    }

    const existing = geometry.getAttribute('position');
    if (existing?.count === pointCount) {
      existing.array.set(positions);
      existing.needsUpdate = true;
      geometry.computeBoundingSphere();
    } else {
      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();
      line.geometry = geometry;
    }

    transferValid = true;
    line.visible = true;
    setEclipticPosition(marker, samples.points[0]);
    marker.visible = true;
  }

  function setPosition(spacecraftPositionKm) {
    if (transferValid && isFiniteVectorKm(spacecraftPositionKm)) {
      setEclipticPosition(marker, spacecraftPositionKm);
      marker.visible = true;
    } else {
      marker.visible = false;
    }
  }

  return {
    setTransfer,
    setPosition,
    setImmersiveStyle(immersive) {
      material.color.setHex(immersive ? 0x8be2db : 0x245da8);
      markerMaterial.color.setHex(immersive ? 0xffad60 : 0xb45b28);
    },
    clear,
    destroy() {
      if (disposed) return;
      disposed = true;
      scene.remove(line, marker);
      geometry.dispose();
      material.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
    },
  };
}
