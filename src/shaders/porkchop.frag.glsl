uniform sampler2D costTexture;
uniform sampler2D c3Texture;
uniform vec2 gridResolution;
uniform vec2 colorRange;
uniform vec2 selectedCell;
uniform vec2 hoveredCell;
uniform float budgetLimit;
uniform int budgetType;
uniform vec3 color0;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;

varying vec2 vUv;

vec3 mapCost(float normalizedCost) {
  float position = clamp(normalizedCost, 0.0, 1.0) * 3.0;
  if (position < 1.0) return mix(color0, color1, position);
  if (position < 2.0) return mix(color1, color2, position - 1.0);
  return mix(color2, color3, position - 2.0);
}

void main() {
  float cost = texture2D(costTexture, vUv).r;
  float c3 = texture2D(c3Texture, vUv).r;
  vec2 cell = min(floor(vUv * gridResolution), gridResolution - vec2(1.0));
  vec2 cellUv = fract(vUv * gridResolution);
  float edgeDistance = min(
    min(cellUv.x, 1.0 - cellUv.x),
    min(cellUv.y, 1.0 - cellUv.y)
  );
  bool selected = all(equal(cell, selectedCell));
  bool hovered = all(equal(cell, hoveredCell));
  bool invalid = cost < 0.0 || c3 < 0.0;
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (invalid) {
    // Invalid cells stay transparent, but a selected/hovered NaN remains locatable.
    if (selected && edgeDistance < 0.055) {
      color = vec3(0.12, 0.19, 0.27);
      alpha = 1.0;
    } else if (hovered && edgeDistance < 0.055) {
      color = vec3(1.0);
      alpha = 1.0;
    }
  } else {
    float span = max(colorRange.y - colorRange.x, 0.000001);
    float normalizedCost = clamp((cost - colorRange.x) / span, 0.0, 1.0);
    color = mapCost(normalizedCost);

    // Muted, evenly spaced proxy-cost contours; cell values remain nearest-sampled.
    float contourDistance = abs(fract(normalizedCost * 10.0) - 0.5);
    float contour = 1.0 - smoothstep(0.018, 0.055, contourDistance);
    color = mix(color, vec3(0.15, 0.20, 0.26), contour * 0.18);

    float budgetMetric = budgetType == 2 ? c3 : cost;
    if (budgetType != 0 && budgetMetric > budgetLimit) {
      // Above-budget cells stay visible and pickable, but are clearly infeasible.
      color = mix(color, vec3(0.77, 0.80, 0.83), 0.68);
    }

    if (selected && edgeDistance < 0.055) {
      color = mix(color, vec3(0.12, 0.19, 0.27), 0.94);
    } else if (hovered && edgeDistance < 0.055) {
      color = mix(color, vec3(1.0), 0.96);
    }
    alpha = 1.0;
  }

  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
