# GMAT idioms & gotchas (discovered via the validation loop)

Hard-won rules the generator must follow -- each was caught by actually running GMAT.
This is the "idiom prompt" knowledge asset: feed it to the model so it stops guessing.

## Parameter dependencies (central body vs. coordinate system)
- `Sat.Earth.SMA`, `.ECC`, `.TA`, `.RadApo`, `.RadPer`, `.Altitude` -- take a **central-body**
  dependency (`.Earth.`).
- `Sat.EarthMJ2000Eq.INC`, `.RAAN`, `.AOP` -- take a **coordinate-system** dependency, NOT
  `.Earth.`. Inclination/node/argument are frame-relative. `Sat.Earth.INC` is an ERROR:
  *"Invalid dependency name 'Earth' found for Parameter type 'INC'"*.

## Object names vs. type names
- `Propagate Prop(Sat)` uses the **instance** name (`Prop`), not the type (`Propagator`).
  Wrong instance -> *"references missing object(s): Propagator"*.
- Command names are reserved and cannot name objects: `Create Spacecraft Target;` fails with
  *"Spacecraft object can not be named to a Command type "Target""* (same for `Report`, `Vary`,
  `Achieve`, `Maneuver`, `Propagate`, `Optimize`, `Minimize`). Name an RPO target `TgtSat`.

## Stopping conditions
- `Sat.ElapsedSecs`, `Sat.ElapsedDays` -- correct. `ElapsedSeconds` is NOT a valid field
  (*"Undefined ... Sat.ElapsedSeconds"*).
- As a Propagate stop they are RELATIVE to the start of that Propagate; elsewhere they read
  differently -- see "ElapsedSecs / ElapsedDays: what they measure depends on where" below.

## Solver output is not an error
- `*** The Targeter converged!` is a SUCCESS banner. Do not pattern-match "Targeter" as an
  error token. Real failure marker: `*** Targeting did not converge in N iterations`.
- Non-convergence with a variable pinned at its Vary `Upper`/`Lower` bound and a large, constant
  goal variance => **mission-design infeasibility** (widen bounds / rethink), not a syntax bug.

## Electric propulsion
- `ElectricThruster` requires BOTH an `ElectricTank` and a `PowerSystem` (e.g.
  `SolarPowerSystem`) attached to the spacecraft, or it won't fire.
- Even with `ThrustModel = ConstantThrustAndIsp`, available power must exceed
  `MinimumUsablePower`. Set `MinimumUsablePower` low and `InitialMaxPower` generous to avoid
  spurious thrust cutoffs while targeting. `ShadowModel='None'` removes eclipse power dropouts
  (full-power modeling assumption -- state it).
- Set `DecrementMass = true` to track fuel.

## Low-thrust modeling
- Electric thrust is tiny (e.g. 0.1 N on 300 kg => ~0.3 mm/s^2): maneuvers are multi-day
  finite-burn spirals, not impulsive.
- Osculating SMA/ECC oscillate each orbit under J2 (+/-~20 km in SMA at LEO) -- the *mean* trend is
  what the targeter drives. Expect oscillation in reports; it's physical, not error.
- Targeting pattern: `Vary BurnTime` -> `BeginFiniteBurn` -> `Propagate {ElapsedSecs=BurnTime}` ->
  `EndFiniteBurn` -> `Achieve` element. Converges in a few iterations for SMA. `BurnTime` is a
  plain duration (the stop is relative to that Propagate), so the pattern works at any point in
  the mission, not only from epoch.

## Low-thrust plane change (mission-design technique)
- A continuous out-of-plane (+/-N) burn across the whole orbit is ~6x too costly: most dV
  rotates the node (RAAN), not the inclination. di/dt ~ cos(u) (u = arg of latitude), so
  inclination only responds near the NODES.
- Efficient technique: **gate the out-of-plane thrust to short arcs straddling each node**
  (|u| within ~30 deg, cos(u) ~ 1), coast the rest of the orbit. Flip the sign each node.
  Implement by anchoring on equator crossings: `Propagate {Sat.EarthMJ2000Eq.Z = 0}` to reach
  a node, burn `ElapsedSecs = Tarc` (~+/-30 deg of arc), coast to next `Z=0`. Choose sign by
  `sign(VZ)` (north/south-bound); if inclination moves the wrong way, flip -- don't trust the
  algebra, let the run decide.
- Measured on a representative LEO case: node-gating cut dV and propellant ~7x vs a
  continuous out-of-plane burn for the same sub-degree inclination change (efficiency
  ~16% -> ~76%).
- Always add an elapsed-time guard to relative/element While loops so a wrong sign can't
  infinite-loop until fuel-out. In a While condition `Sat.ElapsedDays < N` counts from the
  moment the loop is entered (see the ElapsedSecs section), so N is "max days in this loop".
  Prefer the flag pattern in "Conditionals" over a compound `While cond & Sat.ElapsedDays < N`.

## One statement per line
- GMAT does NOT accept multiple `;`-separated assignments on one physical line:
  `Sat.Cd = 2.2;  Sat.Cr = 1.3;` ERRORs (*"... is not a valid RHS of assignment"*).
  One assignment per line.

## Relative motion / safety ellipse (passive safety, the RIGHT way)
- Don't fight station-keeping with per-axis PID (the 600-variable trap). Use natural relative
  motion: **same SMA** between chaser and target => no along-track drift (a held V-bar standoff).
- A small **relative inclination di** gives a bounded cross-track oscillation of amplitude
  `a*di` (verified in-run: e.g. di=0.01 deg at a=7000 km -> ~1.22 km, matching analytic a*di).
  Combined with the V-bar standoff, the chaser traces a bounded ellipse that never reaches the
  target => passively safe even with thrusters off. This satisfies "safe path under nav/control
  error" by design.
- Frame: `CoordinateSystem` Origin=TgtSat, Axes=ObjectReferenced, Primary=Earth,
  Secondary=TgtSat, XAxis=R, ZAxis=N => X=radial, Y=along-track (V-bar), Z=cross-track.
  Report `Chaser.<frame>.X/Y/Z`.
- `ReportFile` auto-logs every propagation step for its Add-list params (it's a subscriber);
  no need to call Report in a loop just to sample a coast.

## RIC (ObjectReferenced) frame gotchas for RPO
Verified with `TgtRIC`: Origin=TgtSat, Axes=ObjectReferenced, Primary=Earth, Secondary=TgtSat,
XAxis=R, ZAxis=N.
- `Chaser.TgtRIC.VX/VY/VZ` are velocities relative to the ROTATING frame (the omega x r term is
  removed), not inertial velocity differences. A chaser co-orbiting 5 km behind on the same
  circular orbit reads ~1e-16 km/s while its inertial relative speed is 5.5 m/s (n*rho). So they
  compare directly with CW, and VX = VY = VZ = 0 means "stationary relative to the target".
- The frame is RECTILINEAR (Cartesian), not curvilinear: a pure along-track separation Y shows a
  spurious radial offset X = -Y^2/(2a). Measured at a = 6878 km: X = -1.82 m at Y = 5 km and
  -16.4 m at Y = 15 km. Don't read it as a real radial offset or burn to "fix" it. Set up
  co-orbiting holds as same SMA + TA offset (X, Y and VX/VY/VZ then stay constant over a
  two-body coast) and compare with CW in curvilinear terms.
- `RMAG` rejects a relative coordinate system: `Chaser.TgtRIC.RMAG` -> *"Invalid dependency name
  "TgtRIC" found for Parameter type "RMAG""*. Compute range in a Variable:
  `rng = sqrt(Chaser.TgtRIC.X^2 + Chaser.TgtRIC.Y^2 + Chaser.TgtRIC.Z^2);`

## Inter-spacecraft tracking (Simulator / estimators)
- Config `AddTrackingConfig = {{Chaser, TgtSat, Chaser}, 'Range'}`, with a Transponder + Antenna
  on the target and Transmitter + Receiver + Antenna on the chaser.
- `Range` is TWO-WAY (round trip): a 1.000 km separation is simulated as 2.000 km. Halve it for
  the one-way distance. `RangeRate` (two-way coherent per the docs) also runs.
- Angles do not: `Azimuth` fails at run time with *"The measurement type Azimuth cannot be used
  for inter-spacecraft measurements."* Do camera/bearing-angle navigation outside GMAT.

## ElapsedSecs / ElapsedDays: what they measure depends on where (critical!)
Verified in GMAT R2025a:
- **Propagate stop condition -> RELATIVE to the start of THAT Propagate.** Three consecutive
  `Propagate Prop(Sat) {Sat.ElapsedSecs = 600};` advance the epoch 600 s EACH (1800 s total);
  `{Sat.ElapsedDays = 0.01}` twice advances 864 s each. Also verified in a While body, with a
  Variable as the value, inside a Target loop (`Vary BurnTime` -> `Propagate {ElapsedSecs =
  BurnTime}` after 2700 s of earlier propagation converged and advanced exactly BurnTime), and
  with a FiniteBurn active (ChemicalThruster; single S/C and `Propagate Synchronized`: equal
  stops gave equal time and equal fuel used). ElectricThruster was not re-run, but the stop
  semantics belong to Propagate, not the thruster.
- **Report / ReportFile, assignments (`x = Sat.ElapsedSecs`) and `If` conditions -> CUMULATIVE**
  since that spacecraft's initial epoch (600, 1200, 1800 ... above). It is per spacecraft: one
  that sat out a Propagate reports a smaller value.
- **`While` condition -> counts from the moment the loop is ENTERED** (re-armed on every entry,
  including each re-entry of a nested While). Entered at 1200 s, `While Sat.ElapsedSecs < 1499`
  with 300 s steps ran 5 times (to 2700 s), not once. Use it as a "time spent in this loop" cap;
  for an absolute mission-time limit, compare an epoch instead (`While Sat.A1ModJulian < tend`).
- So for a duration, write the duration: `Propagate Prop(Sat) {Sat.ElapsedSecs = dt};`.
  Do NOT keep a running total (`tsec = tsec + dt; ... {Sat.ElapsedSecs = tsec}`): every call
  would propagate the whole total again (asking for 7T after a 6T propagate ends at 13T).
- To stop at an ABSOLUTE time, capture the reference epoch once and stop on epoch:
  `t0 = Sat.A1ModJulian;` (at mission/phase start), later `tstop = t0 + tsec/86400;`
  `Propagate Prop(Sat) {Sat.A1ModJulian = tstop, Sat.ElapsedSecs = tmax};`
  (verified exact, also with a FiniteBurn active under `Propagate Synchronized`).
- DANGER: a stop epoch that is already in the PAST is never reached. GMAT prints *"Warning: The
  stopping condition ... cannot be met; propagation runs in the wrong direction"* and propagates
  INDEFINITELY (via runGmat: *"GMAT run exceeded Ns"*). Always pair an epoch stop with a relative
  timeout as a second condition (`Sat.ElapsedSecs = tmax` above): GMAT stops on whichever is hit
  first (verified: it stopped on the timeout). Check `tstop > Sat.A1ModJulian` if it may be stale.
- Symptom of the wrong mental model: segments that run far longer than planned (running-total
  stops), or a While guard that never trips when expected. Always validate with a post-step
  epoch delta.

## During a FiniteBurn, propagate ONLY the burning spacecraft
- `Propagate Prop(ChaserSat, TargetSat)` with a FiniteBurn active on ChaserSat ERRORs:
  *"No tank is present on TargetSat for modeling of propulsion system mass flow."* Propagate
  the burning S/C through the burn, then advance the other(s) separately by the same time to
  stay synced -- or use `Propagate Synchronized` (next sections). Coasting multiple S/C together
  (no burn) is fine.

## Don't tightly target osculating elements
- Osculating SMA/INC oscillate (+/-~10 km in SMA at LEO under J2). `Achieve SMA = X` with a
  +/-0.2 km tolerance often won't converge. Either loosen tol past the oscillation, or target a
  smoother/physical quantity (relative along-track velocity for "stop drifting"), or use
  equal-and-opposite symmetric burns instead of targeting the element.

## Two-spacecraft propagation during a finite burn -> use `Propagate Synchronized`
- `Propagate Prop(ChaserSat, TargetSat)` with a finite burn active ERRORs: *"Multiple Spacecraft
  are not allowed in a propagator driving a finite burn ... try 'Propagate Synchronized
  prop(sat1) prop(sat2)'"*. GMAT tells you the fix in the message.
- Use `Propagate Synchronized Prop(ChaserSat) Prop(TargetSat) {ChaserSat.ElapsedSecs = t}` -- keeps
  both time-synced while the burn acts on ChaserSat; `t` is the duration of THIS Propagate.
  Coasting both together (no burn) with `Prop(A, B)` is fine.

## Conditionals: NO parentheses, no expressions, and avoid compound `&`/`|` guards
- GMAT rejects parentheses in While/If: *"A conditional command is not allowed to contain
  brackets, braces, or parentheses"*. So you cannot force precedence.
- No expressions in a condition either: `If x^2 > y` -> *"Nonexistent object "x^2" referenced
  during creating Wrapper"*. Compute into a Variable first (`x2 = x^2;` then `If x2 > y`).
- Compound guards like `While a < b & c < d` evaluate UNRELIABLY (observed: a loop blew past its
  intended `Y < -13` exit all the way to `Y = +31`, then a downstream runaway to sim day 1591).
- ROBUST pattern: one comparison per condition, combine via a flag computed with nested If:
  `goflag = 1; While goflag > 0.5; ...; goflag = 0; If cond1; goflag = 1; EndIf; If niter > N;
  goflag = 0; EndIf; EndWhile`. Always include a hard iteration cap (niter) for termination.

## Throttle ReportFile volume
- ReportFile auto-logs EVERY integration substep; a multi-day run with small steps can produce
  millions of rows. Toggle `Rep.WriteReport = true/false` around the segments you care about, and
  don't keep MaxStep tiny during long coasts (raise it; drop it only for fine prox-ops/burn arcs).
- An explicit `Report Rep ...` command still writes while `Rep.WriteReport = false`, so mute the
  auto-log once and sample exactly where you want.

## Use ImpulsiveBurn for small maneuvers, FiniteBurn only for big spirals
- Tiny prox-ops / phasing maneuvers (dV ~ cm/s to ~1 m/s) should be `ImpulsiveBurn` + `Maneuver`
  (instantaneous, no propagation), NOT FiniteBurn. This sidesteps the whole finite-burn tangle:
  no `Synchronized`, no burn on/off state, no tank/propagator bookkeeping.
- Sizing a tangential impulse for a small SMA change: `dv = v_circ * da / (2a)`
  (e.g. a=7000 km, da=-1 km -> dv = -0.54 m/s). Equal-and-opposite impulses cancel exactly,
  so a lower-then-restore pair nulls the secular along-track drift cleanly.
- Reserve FiniteBurn (electric) for the maneuvers that genuinely take days: orbit-raise/lower
  spirals, plane change, de-orbit.

## Measure secular drift over >=1 full orbit, not a fraction
- Relative along-track Y oscillates +/- several km each orbit (the relative ellipse). Measuring
  "drift rate" over a fraction of an orbit reports the oscillation slope, not the secular drift
  (saw a spurious 138 km/day that was really ~3.7 km/day). Compare same-phase points >=1 orbit apart.

## Scripts must be pure ASCII (even comments)
- GMAT rejects the whole script if ANY character is non-ASCII -- including accented letters
  in comments (*"contains characters outside of the ASCII character set"*). Caught by writing
  a Spanish comment with an accent. Strip/transliterate before running.

## Output location
- `ReportFile` output is written to `<GMAT>\output\`, not the script directory.

## Portability failures in third-party scripts (catalog from validating 49 wild scripts)
When a downloaded/inherited script fails, it is usually the environment, not the physics.
Triage in this order -- the fix is mechanical for the first, external for the rest:
- **Hardcoded absolute `ReportFile.Filename`** (`'C:\Users\someone\...\out.txt'` or
  `'/home/user/.../out.txt'`) -- fails with *"Cannot open report file"* on any other machine.
  This is the #1 killer of community scripts. Fix: rewrite to a bare filename
  (basename) and let it land in `<GMAT>\output\`. Pure mechanical fix, no physics change.
- **Missing data assets** -- a referenced SPICE kernel (`.bsp`), custom gravity file
  (`.cof`/`.tab`), or `.bin` that *"is not an allowed value"* / *"does not exist"*. The script
  is fine; the data file isn't shipped. Fix only by obtaining the asset; flag to the user,
  don't invent a substitute.
- **Missing plugins** -- Optimal-control scripts (CSALT/Yukon `Optimize`, `EMTGSpacecraft`)
  and SNOPT/VF13 optimizers need plugins enabled in the GMAT startup file. Absent -> load/parse
  error. Not a script bug.
- **Stale syntax from old versions** -- e.g. a `DifferentialCorrector.Algorithm = NewtonRson`
  or a parameter dependency that a newer GMAT rejects (*"Invalid dependency name 'Jupiter' for
  Parameter type 'Vinf'"*). Modernize the offending line against current docs.
- **Template placeholders** -- unsubstituted tokens like `$SMA$`/`{{value}}` left by a
  generator (*"not an allowed value ... allowed value is Real number"*). Fill or remove.
A script that fails only on these is still a valuable pattern reference -- read it for the
technique even if you can't run it as-is.
