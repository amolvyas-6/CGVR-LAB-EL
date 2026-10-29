// The numeric order follows the supplied embedded-texture sequence. Names were
// assigned after visually inspecting the maps; texture 6 is a ring stripe, not
// a spherical surface, and is intentionally excluded from the preview options.
const suppliedAssets = [
  {
    index: 0,
    id: 'mercury',
    label: 'Mercury',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_0.jpeg', import.meta.url).href,
  },
  {
    index: 1,
    id: 'venus',
    label: 'Venus',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_1.jpeg', import.meta.url).href,
  },
  {
    index: 2,
    id: 'earth',
    label: 'Earth',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_2.jpeg', import.meta.url).href,
  },
  {
    index: 3,
    id: 'mars',
    label: 'Mars',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_3.jpeg', import.meta.url).href,
  },
  {
    index: 4,
    id: 'jupiter',
    label: 'Jupiter',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_4.jpeg', import.meta.url).href,
  },
  {
    index: 5,
    id: 'saturn',
    label: 'Saturn',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_5.jpeg', import.meta.url).href,
  },
  {
    index: 6,
    id: 'saturn-rings',
    label: 'Saturn ring texture',
    type: 'ring',
    url: new URL('../../solar-system-model/textures/gltf_embedded_6.png', import.meta.url).href,
  },
  {
    index: 7,
    id: 'uranus',
    label: 'Uranus',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_7.jpeg', import.meta.url).href,
  },
  {
    index: 8,
    id: 'neptune',
    label: 'Neptune',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_8.jpeg', import.meta.url).href,
  },
  {
    index: 9,
    id: 'moon',
    label: 'Moon',
    type: 'body',
    url: new URL('../../solar-system-model/textures/gltf_embedded_9.jpeg', import.meta.url).href,
  },
  {
    index: 10,
    id: 'sun',
    label: 'Sun',
    type: 'body',
    selfLit: true,
    url: new URL('../../solar-system-model/textures/gltf_embedded_10.jpeg', import.meta.url).href,
  },
];

export const BODY_ASSETS = Object.freeze(suppliedAssets.map((asset) => Object.freeze(asset)));
export const PREVIEW_BODIES = Object.freeze(BODY_ASSETS.filter((asset) => asset.type === 'body'));
