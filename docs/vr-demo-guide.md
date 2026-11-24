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

## Controls and parameters

Start with **Mission** on the right. The chart, **Play**, and the timeline
stay on the left. **Compute grid**, **Recenter**, and **Exit VR** are always
available below the tabs.

| Where | Control | What it changes |
| --- | --- | --- |
| Mission | **Destination** | Earth is fixed as the origin. Choose Venus, Mars, or Jupiter. The flight duration range starts at 80–220, 100–400, or 450–1200 days respectively. |
| Mission | **Budget filter** | **None** includes every valid cell. **Cost proxy** starts at 6 km/s and steps by 0.5. **Departure C3** starts at 15 km²/s² and steps by 5. Budget edits update feasibility on the existing grid. |
| Mission | **Best transfer** | Selects the lowest-cost valid cell that meets the current filter. The button is disabled when the grid is missing or the filter leaves no feasible cell. |
| Search | **First / Last departure (UTC)** | The earliest and latest launch dates considered. In VR each press changes one bound by 7 days. |
| Search | **Shortest / Longest flight** | The range of travel durations to evaluate, in days. In VR each press changes one bound by 10 days. |
| Search | **Samples per axis** | A value of 60 evaluates 60 dates × 60 flight durations, or 3,600 cells. The range is 2–120 and VR steps by 10. More samples cost more computation. |
| Display | **Larger model**, **Radii enlarged / Physical radii** | Changes the size of the orrery or the displayed body sizes. The transfer calculation uses the same positions and physics in either view. |
| Display | **Reset display**, **Restore Mars defaults** | Reset display restores the orrery scale and radius setting. Restore Mars defaults resets the destination, search bounds and sample count, and clears the budget. Compute again to get a fresh grid. |
| Always visible | **Compute grid**, **Recenter**, **Exit VR** | Compute uses the current destination and search ranges. Recenter moves the workbench to your current viewpoint. Exit returns to the browser view with the current mission. |

The desktop page offers the same search settings under **Search settings**.
Its budget limit appears when you choose a filter. The timeline controls have
the same mission-time meaning on desktop and in VR.

## Reading the chart and results

- Each **porkchop plot** cell represents one UTC departure date and one flight
  duration. Their sum gives the arrival date. Dark blue is lower cost and
  amber is higher cost. Hover to preview. Select to draw the transfer and
  update the result. The budget dims cells above the limit.
- **Transfer-cost proxy (km/s)** adds the departure and arrival hyperbolic
  excess speeds, written *v∞*. Each speed is measured relative to the relevant
  planet at that endpoint. The proxy ranks sampled transfers.
- **Departure C3 (km²/s²)** is departure *v∞* squared. It measures the
  energy required to leave Earth on that trajectory. The budget changes
  eligibility. The proxy remains the quantity minimized.
- **Type I / Type II** describes the transfer angle around the Sun. Type I
  sweeps at most 180°, and Type II sweeps more than 180°. Both arcs sweep less
  than 360°.
- The **unrestricted minimum** considers all valid cells in the sampled grid.
  The **feasible minimum** considers the cells within your budget. Search
  bounds and sample spacing affect which minimum you find.
- **Play** and the timeline follow the selected path from departure to arrival.
  The animation compresses the trip to presentation time. The planets and
  spacecraft move to the same simulated date.

## Five-minute evaluator walkthrough

Start from a fresh page so the default Mars grid is ready. It searches departures from 1 July 2026 to 1 March 2027 UTC. Use both controller
rays during rehearsal. On a single projector screen, show stereo briefly, then
turn it off in the emulator to give the audience a larger view. Maximize the
browser window and set browser zoom to 100%. Use **Search** to adjust the sample count for a finer map.

| Time | What to do | What to show or say |
| --- | --- | --- |
| 0:00–0:45 | Click **Enter VR**. Look at the central orrery, then turn left to the cost map. | Earth is the departure planet. The horizontal axis is the UTC departure date. The vertical axis is the flight time. Color encodes the sum of the departure and arrival hyperbolic excess speeds. |
| 0:45–1:30 | Aim slightly above and left of the Mars chart center. Pause on the preview, then press the trigger. | Compare the selected cell with the sampled minimum. The default Mars minimum is **5.615 km/s** with **308.47 days** of flight. The selected transfer shows departure, arrival, C3, and the propellant estimate. The default Mars minimum needs about **5,091 kg** under the example assumptions. |
| 1:30–2:10 | Press **Play**, let the spacecraft move, then pause. Hold the trigger on the timeline and sweep from roughly 25% to 75%. | The spacecraft and planets advance to the same mission date. The timeline uses a compressed presentation time. |
| 2:10–3:10 | In **Mission**, choose **Departure C3**. With the threshold at **15 km²/s²**, point out the dimmed cells and the feasibility of your selection. Press **Best transfer**, then press **−5** three times to reach zero. | C3 is the square of departure hyperbolic excess speed. The filter preserves the original grid. **Best transfer** chooses the lowest-cost feasible cell and disables when the feasible set is empty. |
| 3:10–4:25 | Clear the budget with **None**. Choose **Jupiter**, then open **Search**. Move the first departure **+7 d**, the longest flight **+10 d**, and the samples from 60 to 70. Press **Compute grid**. | The old grid clears as soon as inputs change. The worker computes the new grid while the scene remains interactive. Explain why Jupiter uses a fit scale. |
| 4:25–5:00 | Open **Display**, toggle **Larger model**, and switch the radii mode. Move the emulated headset lower, then select **Recenter**. End with **Exit VR**. | Scale and radii change the visualization. The current mission remains available in the desktop planner after exit. |

For a technical follow-up, point to the XR cadence, callback timing, and draw
counts in the results panel. Quote the browser and emulator setup if you report
those numbers. For a quick restart, reload the page or choose **Display → Restore Mars defaults**, then **Compute grid**.

See [Project parameters and results](project-parameters.md) for the propellant formula, spacecraft defaults, and worked Mars numbers.

## Scope of the scientific demonstration

Astronomy Engine supplies the planet positions offline. For each cell, a
zero-revolution Lambert solver finds the velocities that connect the
departure and arrival positions in the given time. The spacecraft is
propagated under the Sun's gravity between those endpoints. The model
assumes instantaneous maneuvers and uses patched conics at the planets.
Invalid solves are masked.

The cost proxy is suitable for comparing candidate trajectories. A flight
plan would also need parking-orbit and capture burns, launch-vehicle limits,
and perturbations. Gravity assists and low-thrust trajectories are outside
this model.
