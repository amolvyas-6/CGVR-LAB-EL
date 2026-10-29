# VR-first demonstration guide

## Start the emulator

1. Run `npm run dev` and open the displayed localhost address in Chrome.
2. Install Meta's [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik).
3. Enable emulation for the current site using the extension toolbar button and
   reload. In IWE 2.0 choose the Meta Quest 3 controller profile and enable
   stereo rendering; older versions expose the controls in DevTools → WebXR.
4. Use the page's VR entry button. If it reports no support, check extension
   site access and reload. On a static host use HTTPS; localhost is also secure.

The emulator supplies headset/controller poses and button states. Use its
controller transform widgets and trigger controls to aim/select in the scene;
clicking the desktop mission form is not an in-VR demonstration. The in-world
instructions show the input mappings actually detected for the current device.

## Suggested recording sequence

- Show the tabletop ephemeris orrery, selected transfer arc, in-world cost plot,
  axes/legend, mission parameters and selected results.
- Aim at different plot cells and trigger-select. Read the new departure,
  arrival, TOF, cost proxy, C3 and transfer branch beside the visualization.
- Snap to the discrete grid optimum. Explain that the plotted objective is
  `v∞ departure + v∞ arrival`, not a launch-vehicle or parking-orbit burn.
- Play/pause the spacecraft. Scrub the time bar or horizontal thumbstick and
  show planets and spacecraft at the same mission date.
- Set a cost or departure-C3 budget. Show the masked/dimmed region, selected
  feasibility, and the feasible optimum; lower the limit to demonstrate the
  explicit no-feasible state. Switching budget type does not compute a new grid.
- Adjust departure dates and flight-time bounds with the in-world steppers,
  then Compute grid. Show the loading notice while the immersive scene keeps
  rendering; the previous grid must not masquerade as a current result.
- Change target to Venus or Jupiter and compute. For Jupiter point out the
  disclosed fit scale; the geometry scale does not change the mathematics.
- Toggle larger scale and physical/exaggerated body radii. Reset the workbench,
  exit VR, and show that desktop planning still works.
- Include measured XR cadence, callback time and draw calls/triangles, together
  with the emulator/browser/profile. These are measurements of the development
  computer, not predictions of Quest hardware performance.

## Scope of the scientific demonstration

Offline Astronomy Engine states, zero-revolution universal-variable Lambert,
impulsive patched-conic transfers, and Sun-only two-body flight propagation.
The minimum is restricted to the chosen grid and ranges. Invalid solves are
masked, not replaced with fictional trajectories. Planet radii and spacecraft
markers can be exaggerated for visibility. There are no gravity assists,
low-thrust trajectories, launch-vehicle model, backend or runtime astronomy API.
