# GMAT idioms & gotchas (discovered via the validation loop)

Hard-won rules the generator must follow — each was caught by actually running GMAT.
This is the "idiom prompt" knowledge asset: feed it to the model so it stops guessing.

## Parameter dependencies (central body vs. coordinate system)
- `Sat.Earth.SMA`, `.ECC`, `.TA`, `.RadApo`, `.RadPer`, `.Altitude` — take a **central-body**
  dependency (`.Earth.`).
- `Sat.EarthMJ2000Eq.INC`, `.RAAN`, `.AOP` — take a **coordinate-system** dependency, NOT
  `.Earth.`. Inclination/node/argument are frame-relative. `Sat.Earth.INC` is an ERROR:
  *"Invalid dependency name 'Earth' found for Parameter type 'INC'"*.

## Object names vs. type names
- `Propagate Prop(Sat)` uses the **instance** name (`Prop`), not the type (`Propagator`).
  Wrong instance → *"references missing object(s): Propagator"*.

## Stopping conditions
- `Sat.ElapsedSecs`, `Sat.ElapsedDays` — correct. `ElapsedSeconds` is NOT a valid field
  (*"Undefined ... Sat.ElapsedSeconds"*).

## Solver output is not an error
- `*** The Targeter converged!` is a SUCCESS banner. Do not pattern-match "Targeter" as an
  error token. Real failure marker: `*** Targeting did not converge in N iterations`.
- Non-convergence with a variable pinned at its Vary `Upper`/`Lower` bound and a large, constant
  goal variance ⇒ **mission-design infeasibility** (widen bounds / rethink), not a syntax bug.

## Electric propulsion
- `ElectricThruster` requires BOTH an `ElectricTank` and a `PowerSystem` (e.g.
  `SolarPowerSystem`) attached to the spacecraft, or it won't fire.
- Even with `ThrustModel = ConstantThrustAndIsp`, available power must exceed
  `MinimumUsablePower`. Set `MinimumUsablePower` low and `InitialMaxPower` generous to avoid
  spurious thrust cutoffs while targeting. `ShadowModel='None'` removes eclipse power dropouts
  (full-power modeling assumption — state it).
- Set `DecrementMass = true` to track fuel.

## Low-thrust modeling
- Electric thrust is tiny (e.g. 0.1 N on 300 kg ⇒ ~0.3 mm/s²): maneuvers are multi-day
  finite-burn spirals, not impulsive.
- Osculating SMA/ECC oscillate each orbit under J2 (±~20 km in SMA at LEO) — the *mean* trend is
  what the targeter drives. Expect oscillation in reports; it's physical, not error.
- Targeting pattern: `Vary BurnTime` → `BeginFiniteBurn` → `Propagate {ElapsedSecs=BurnTime}` →
  `EndFiniteBurn` → `Achieve` element. Converges in a few iterations for SMA.

## Low-thrust plane change (mission-design technique)
- A continuous out-of-plane (±N) burn across the whole orbit is ~6x too costly: most Δv
  rotates the node (RAAN), not the inclination. di/dt ∝ cos(u) (u = arg of latitude), so
  inclination only responds near the NODES.
- Efficient technique: **gate the out-of-plane thrust to short arcs straddling each node**
  (|u| within ~30°, cos(u)≈1), coast the rest of the orbit. Flip the sign each node.
  Implement by anchoring on equator crossings: `Propagate {Sat.EarthMJ2000Eq.Z = 0}` to reach
  a node, burn `ElapsedSecs = Tarc` (~±30° of arc), coast to next `Z=0`. Choose sign by
  `sign(VZ)` (north/south-bound); if inclination moves the wrong way, flip — don't trust the
  algebra, let the run decide.
- Measured on a representative LEO case: node-gating cut Δv and propellant ~7x vs a
  continuous out-of-plane burn for the same sub-degree inclination change (efficiency
  ~16% → ~76%).
- Always add an elapsed-time guard to relative/element While loops
  (`While cond & Sat.ElapsedDays < N`) so a wrong sign can't infinite-loop until fuel-out.

## One statement per line
- GMAT does NOT accept multiple `;`-separated assignments on one physical line:
  `Sat.Cd = 2.2;  Sat.Cr = 1.3;` ERRORs (*"... is not a valid RHS of assignment"*).
  One assignment per line.

## Relative motion / safety ellipse (passive safety, the RIGHT way)
- Don't fight station-keeping with per-axis PID (the 600-variable trap). Use natural relative
  motion: **same SMA** between chaser and target ⇒ no along-track drift (a held V-bar standoff).
- A small **relative inclination δi** gives a bounded cross-track oscillation of amplitude
  `a·δi` (verified in-run: e.g. δi=0.01° at a=7000 km → ~1.22 km, matching analytic a·δi). Combined with the V-bar
  standoff, the chaser traces a bounded ellipse that never reaches the target ⇒ passively safe
  even with thrusters off. This satisfies "safe path under nav/control error" by design.
- Frame: `CoordinateSystem` Origin=Target, Axes=ObjectReferenced, XAxis=R, ZAxis=N ⇒ X=radial,
  Y=along-track (V-bar), Z=cross-track. Report `Chaser.<frame>.X/Y/Z`.
- `ReportFile` auto-logs every propagation step for its Add-list params (it's a subscriber);
  no need to call Report in a loop just to sample a coast.

## ElapsedSecs / ElapsedDays are CUMULATIVE from epoch (critical!)
- `Sat.ElapsedSecs` in a Propagate stop condition measures time since the spacecraft's
  EPOCH (mission start), NOT since the start of that Propagate command. So once the S/C is
  at e.g. 80000 s, `Propagate {Sat.ElapsedSecs = 1600}` is already satisfied → it takes ~one
  min-step and stops (looks like "the burn/coast didn't run"; fuel barely moves).
- To advance by a relative duration in a loop or after earlier props, track an absolute
  accumulator: `tsec = tsec + dt; Propagate {Sat.ElapsedSecs = tsec};`. The first burn from
  epoch (cumulative 0) works with a literal, later ones do NOT.
- Symptom that caught this: a "completed" run where a coast/burn produced no time advance,
  or a maneuver that didn't change the state. Always validate with a post-step delta.

## During a FiniteBurn, propagate ONLY the burning spacecraft
- `Propagate Prop(ChaserSat, TargetSat)` with a FiniteBurn active on ChaserSat ERRORs:
  *"No tank is present on TargetSat for modeling of propulsion system mass flow."* Propagate
  the burning S/C through the burn, then advance the other(s) separately by the same time to
  stay synced. Coasting multiple S/C together (no burn) is fine.

## Don't tightly target osculating elements
- Osculating SMA/INC oscillate (±~10 km in SMA at LEO under J2). `Achieve SMA = X` with a
  ±0.2 km tolerance often won't converge. Either loosen tol past the oscillation, or target a
  smoother/physical quantity (relative along-track velocity for "stop drifting"), or use
  equal-and-opposite symmetric burns instead of targeting the element.

## Two-spacecraft propagation during a finite burn -> use `Propagate Synchronized`
- `Propagate Prop(ChaserSat, TargetSat)` with a finite burn active ERRORs: *"Multiple Spacecraft
  are not allowed in a propagator driving a finite burn ... try 'Propagate Synchronized
  prop(sat1) prop(sat2)'"*. GMAT tells you the fix in the message.
- Use `Propagate Synchronized Prop(ChaserSat) Prop(TargetSat) {ChaserSat.ElapsedSecs = t}` — keeps
  both time-synced while the burn acts on ChaserSat. Coasting both together (no burn) with
  `Prop(A, B)` is fine.

## Conditionals: NO parentheses, and avoid compound `&`/`|` guards
- GMAT rejects parentheses in While/If: *"A conditional command is not allowed to contain
  brackets, braces, or parentheses"*. So you cannot force precedence.
- Compound guards like `While a < b & c < d` evaluate UNRELIABLY (observed: a loop blew past its
  intended `Y < -13` exit all the way to `Y = +31`, then a downstream runaway to sim day 1591).
- ROBUST pattern: one comparison per condition, combine via a flag computed with nested If:
  `goflag = 1; While goflag > 0.5; ...; goflag = 0; If cond1; goflag = 1; EndIf; If niter > N;
  goflag = 0; EndIf; EndWhile`. Always include a hard iteration cap (niter) for termination.

## Throttle ReportFile volume
- ReportFile auto-logs EVERY integration substep; a multi-day run with small steps can produce
  millions of rows. Toggle `Rep.WriteReport = true/false` around the segments you care about, and
  don't keep MaxStep tiny during long coasts (raise it; drop it only for fine prox-ops/burn arcs).

## Use ImpulsiveBurn for small maneuvers, FiniteBurn only for big spirals
- Tiny prox-ops / phasing maneuvers (dV ~ cm/s to ~1 m/s) should be `ImpulsiveBurn` + `Maneuver`
  (instantaneous, no propagation), NOT FiniteBurn. This sidesteps the whole finite-burn tangle:
  no `Synchronized`, no burn on/off state, no ElapsedSecs-during-burn corruption.
- Sizing a tangential impulse for a small SMA change: `dv = v_circ * da / (2a)`
  (e.g. a=7000 km, da=-1 km -> dv = -0.54 m/s). Equal-and-opposite impulses cancel exactly,
  so a lower-then-restore pair nulls the secular along-track drift cleanly.
- Reserve FiniteBurn (electric) for the maneuvers that genuinely take days: orbit-raise/lower
  spirals, plane change, de-orbit.

## Measure secular drift over >=1 full orbit, not a fraction
- Relative along-track Y oscillates +/- several km each orbit (the relative ellipse). Measuring
  "drift rate" over a fraction of an orbit reports the oscillation slope, not the secular drift
  (saw a spurious 138 km/day that was really ~3.7 km/day). Compare same-phase points >=1 orbit apart.

## Output location
- `ReportFile` output is written to `<GMAT>\output\`, not the script directory.
