# Project parameters and results

The Interplanetary Transfer Planner compares trips from Earth to Venus, Mars, or Jupiter. The cost map ranks the sampled trajectories. Choose a cell to inspect its path, play the flight, and see an estimate of the propellant needed for that specific trip.

## Mission and search

| Parameter | Meaning | Example |
| --- | --- | --- |
| **Destination** | Picks the arrival planet. Earth is the departure planet. Changing the destination sets an initial flight-duration range. | Mars starts at 100–400 days. Venus starts at 80–220 days and Jupiter at 450–1,200 days. |
| **First departure** | The earliest Earth departure date to sample, in UTC. | 1 July 2026 in the default Mars search. |
| **Last departure** | The latest Earth departure date to sample, in UTC. | 1 March 2027 in the default Mars search. |
| **Shortest flight** | The minimum travel time to sample, in days. | 100 days for the default Mars search. |
| **Longest flight** | The maximum travel time to sample, in days. | 400 days for the default Mars search. Arrival equals departure plus the chosen travel time. |
| **Samples per axis** | The number of departure dates and flight times to try. The range is 2–120 per axis. | 60 means 60 departure dates × 60 flight times, or 3,600 cells. Setting both axes to 70 gives 4,900 cells. |
| **Budget type** | Selects the feasibility filter. **None** accepts all valid cells. **Cost proxy** caps the combined speed mismatch. **Departure C3** caps the Earth escape energy indicator. | Choose **Departure C3** to focus on Earth departures within a limit. |
| **Budget limit** | The highest value the chosen filter accepts. | The preset is 6 km/s for the cost proxy or 15 km²/s² for C3. The VR buttons step by 0.5 km/s or 5 km²/s² respectively. |

Use **Search settings** on desktop or **Search** in VR to change dates, flight duration, or samples. VR date buttons move in 7-day steps and flight duration buttons in 10-day steps. Press **Compute grid** after changing search inputs. Budget changes apply to the current grid. **Best transfer** selects the lowest-proxy sampled cell that meets the active budget.

## Reading the cost map

The horizontal axis is departure date. The vertical axis is flight duration. Each cell represents one pairing of these inputs. Blue shows lower proxy values and amber shows higher values. The budget dims cells above its limit. Cells with unsuccessful solves are masked.

The planner looks up where Earth and the target will be and uses a Lambert solver to find a Sun-centered path between them in the specified time. It subtracts the planet's velocity vector from the spacecraft's velocity vector at each endpoint. The lengths of those differences are the departure and arrival **hyperbolic excess speeds**, written as departure and arrival v∞. These represent speeds relative to each planet far from it in the patched-conic model.

| Result | Meaning |
| --- | --- |
| **Transfer-cost proxy** (km/s) | Departure v∞ + arrival v∞. This is the chart's ranking score. A lower score means a smaller combined velocity mismatch. |
| **Departure C3** (km²/s²) | Departure v∞ squared. It measures how demanding the Earth escape is. For a departure v∞ of about 3.045 km/s, C3 is about 9.273 km²/s². |
| **Unrestricted minimum** | The lowest-proxy valid cell in the current search. It depends on the chosen bounds and sample count. |
| **Budget-feasible minimum** | The lowest-proxy valid cell within the active budget. If all cells exceed the limit, there is no feasible minimum. |
| **Transfer branch** | Type I sweeps at most 180° around the Sun. Type II sweeps more than 180° and less than 360°. |

## Propellant for the selected transfer

Open **Propellant settings** below the selected transfer results on desktop to edit the spacecraft assumptions. VR shows the estimate using those same settings. The estimate covers the burns from a circular Earth parking orbit to a circular orbit at the destination. The cost chart and budget use the trajectory metrics above.

| Setting | Default | Meaning |
| --- | --- | --- |
| **Dry mass** | 1,000 kg | Spacecraft and payload mass remaining after both burns. Doubling it doubles estimated propellant for the same trip and engine. |
| **Engine specific impulse (Isp)** | 320 s | An engine-efficiency measure. Higher Isp uses less propellant for the same burns and dry mass. |
| **Assumed propellant price** | 10 USD/kg | An illustrative price multiplied by the propellant mass. Clear it to show the mass without a price. Zero is accepted. |
| **Departure orbit** | 300 km above Earth | Fixed circular parking orbit for the estimate. |
| **Capture orbit** | 300 km above Venus or Mars, 10,000 km above Jupiter | Fixed circular destination orbit for the estimate. Altitudes use reference planet radii. |

### How C3 and the proxy lead to kilograms

1. **Recover the endpoint speeds.** Departure v∞ = √C3. Arrival v∞ = cost proxy − √C3. The code uses the equivalent unrounded speeds directly from the solver, so displayed rounding does not affect the estimate.
2. **Calculate each burn.** Take the orbit radius `r` as the planet radius plus the orbit altitude. With the planet's gravity parameter `μ`, circular speed is `√(μ/r)`. The escape or arrival speed at the orbit radius is `√(v∞² + 2μ/r)`. Take the difference to get the speed change, Δv, for the departure or capture burn. [Planet radii](https://ssd.jpl.nasa.gov/planets/phys_par.html) and [gravity parameters](https://ssd.jpl.nasa.gov/astro_par.html).
3. **Convert speed change to propellant.** Add the two burns and convert km/s to m/s. For a single stage using the same engine efficiency for both burns, the ideal rocket equation gives `propellant kg = dry mass × (exp(total Δv / (Isp × 9.80665)) − 1)`. [NASA Glenn ideal rocket equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ideal-rocket-equation/).
4. **Estimate the bill.** Multiply propellant kilograms by the assumed USD/kg. Propellant is the mass expelled by the engine, including oxidizer where applicable.

### Worked Mars example

The default grid's best sampled transfer departs on **1 November 2026** and arrives on **6 September 2027**, after **308.47 days**.

| Calculation | Result |
| --- | ---: |
| Departure v∞ | 3.045140 km/s |
| Arrival v∞ | 2.569459 km/s |
| C3 | 9.273 km²/s² |
| Transfer-cost proxy | 5.615 km/s |
| Earth departure burn from a 300 km circular orbit | 3.617 km/s |
| Mars capture burn into a 300 km circular orbit | 2.054 km/s |
| Total burn Δv, from unrounded values | 5.670 km/s |
| Propellant at 1,000 kg dry mass and 320 s Isp | 5,091.2 kg |
| Propellant bill at the example price of 10 USD/kg | $50,912.05 |

The estimate assumes instantaneous, tangential burns aligned with the circular orbits, a single stage, constant Isp, and no reserves. Launch from the surface, landing, plane changes, course corrections, boil-off, tank sizing, and launch-provider pricing are outside this model.

## Display, playback, and measurements

| Control | Meaning |
| --- | --- |
| **Play / Pause** and **timeline** | Move the selected spacecraft and planets through the same simulated mission dates. In VR, hold the trigger and sweep along the timeline or use the thumbstick. At 50% of the default Mars transfer, about 154 days have passed. |
| **Larger model** | Enlarges orbital distances on the display. Jupiter uses a fit scale to keep the orrery in view. |
| **Radii enlarged / Physical radii** | Changes how big the planet spheres look. Physical radii make the planets small compared with their orbits. |
| **Recenter** | Places the VR workbench in front of your current position and heading. |
| **Reset display** | Restores the default display scale and enlarged radii. |
| **Restore Mars defaults** | Resets the search to Mars and clears the budget. Press **Compute grid** afterwards. |
| **Exit VR** | Returns to the desktop planner with the current mission. |

Rendering measurements describe browser frame cadence, callback timing, and renderer work in the current environment. The [demonstration guide](vr-demo-guide.md) provides a five-minute evaluator walkthrough.
