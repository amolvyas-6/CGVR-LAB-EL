import * as THREE from 'three';

/** Reusable opaque canvas plane for concise, offline in-world text. */
export function createTextPanel({
  width,
  height,
  pixelWidth,
  pixelHeight,
  name = 'XR text panel',
  draw,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas context for an XR panel');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData.xrPanel = true;

  function repaint(painter = draw) {
    if (typeof painter !== 'function') return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    painter(context, canvas.width, canvas.height);
    texture.needsUpdate = true;
  }

  repaint();

  return {
    canvas,
    context,
    mesh,
    repaint,
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/** Draw one line while reducing its font size before it can clip or overflow. */
export function drawFittedText(context, text, x, y, maxWidth, {
  fontSize = 36,
  minFontSize = 18,
  weight = 500,
  color = '#243348',
  align = 'left',
  family = 'system-ui, sans-serif',
} = {}) {
  const value = String(text ?? '—');
  let size = fontSize;
  context.textAlign = align;
  context.textBaseline = 'middle';
  while (size > minFontSize) {
    context.font = `${weight} ${size}px ${family}`;
    if (context.measureText(value).width <= maxWidth) break;
    size -= 1;
  }
  context.font = `${weight} ${size}px ${family}`;
  if (context.measureText(value).width <= maxWidth) {
    context.fillStyle = color;
    context.fillText(value, x, y, maxWidth);
    return size;
  }

  let clipped = value;
  while (clipped.length > 1 && context.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  context.fillStyle = color;
  context.fillText(`${clipped}…`, x, y, maxWidth);
  return size;
}

export function drawRoundedRect(context, x, y, width, height, radius, fill, stroke = null) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.stroke();
  }
}

export function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

export function formatDate(value) {
  if (typeof value !== 'string' || value === '') return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toISOString().replace('T', ' ').replace(/:\d{2}\.000Z$/, 'Z');
}
