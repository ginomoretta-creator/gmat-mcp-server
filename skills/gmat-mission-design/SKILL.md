---
name: gmat-mission-design
description: Design, run, and verify spacecraft mission scenarios with NASA GMAT through the gmat MCP tools (runGmat, getGmatIdioms, listGmatSamples, getGmatSample, searchDocs). Use this skill whenever the user asks for orbital maneuvers, transfers, rendezvous, phasing, station-keeping, orbit decay/de-orbit, impulsive or low-thrust burn design, targeting/optimization of trajectories, or anything involving GMAT scripts — even if they don't name GMAT explicitly but want a numerically verified orbital-mechanics result rather than a textbook estimate.
---

# GMAT mission design

You have a real astrodynamics simulator in the loop. The core discipline: **never cite an
orbital-mechanics number you computed in your head — cite numbers from a GMAT report.** Your
analytic estimates are the *acceptance test* for the simulation, not the deliverable.

## The loop

1. **Read the idioms first.** Call `getGmatIdioms` before writing any script. It is a curated
   list of gotchas that each cost a failed run to discover (cumulative ElapsedSecs, ASCII-only
   scripts, conditional syntax limits, finite-burn multi-spacecraft rules...). Skipping this
   step reliably costs more calls than it saves.

2. **Seed from a sample when one matches.** `listGmatSamples` / `getGmatSample` give you
   NASA's known-good scripts (lunar transfer, Mars B-plane, electric propulsion, finite-burn
   targeting, station-keeping...). Adapt rather than invent for anything beyond basic LEO work.
   When adapting for headless runs: strip `OrbitView`/`XYPlot` subscribers, keep the force
   models and targeter structure, add a `ReportFile`.

3. **Write down analytic expectations before running.** Vis-viva, Hohmann ΔVs, phasing-orbit
   periods, plane-change costs, drag ballpark from scale heights. Two reasons: they seed your
   `Vary` initial guesses and bounds, and they are how you'll know the run is *right* and not
   merely *converged*.

4. **Write the script.** Pure ASCII (no accented characters, not even in comments). One
   statement per line. Create a `ReportFile` with `WriteHeaders = false` and `Report` every
   number you intend to cite. Output lands in GMAT's `output/` dir and comes back in the
   `reports` field of the result.

5. **Run with `runGmat` and branch on `stage`:**
   - `parse` — syntax/object error; the message names the line. Re-check against the idioms.
   - `convergence` — if a Vary variable is pinned at a bound with large constant variance,
     the design is infeasible (rethink goals/bounds); otherwise widen bounds, loosen
     tolerance past physical oscillations, or pick a less degenerate goal.
   - `run` — propagation/stop-condition failure. Classic causes: stop on an apsis of a
     (near-)circular orbit, stop condition already satisfied (cumulative ElapsedSecs).
   - timeout — raise `timeoutSec` only when the propagation is genuinely long (multi-day
     low-thrust spirals); otherwise suspect an infinite loop and check `raw_tail` to see
     where it hung.

6. **Physics-check the report against step 3.** Agreement within a few percent: report it.
   Disagreement: investigate — wrong frame, wrong dependency (`Sat.Earth.SMA` vs
   `Sat.EarthMJ2000Eq.INC`), saturated goal, or your analytic model is missing a real effect
   (that itself is a finding worth reporting, e.g. J2 shifting a phasing solution).

## Targeting patterns that work

- Impulsive maneuvers: `ImpulsiveBurn` + `Maneuver` inside `Target/EndTarget`, with
  `ExitMode = SaveAndContinue`. Seed `Vary` initial values with the analytic estimate and
  give honest bounds plus a sane `MaxStep`.
- **Goal degeneracy:** `Achieve RadPer = r` saturates once the burn point becomes periapsis —
  any extra ΔV still satisfies it. To circularize, target `ECC = 0` (small tolerance) instead.
- Two coupled unknowns (e.g. burn size + coast time, B-plane components) converge fine in one
  targeter with two `Vary`/two `Achieve`; keep perturbations small relative to MaxStep.
- Don't tightly target osculating elements under J2 — tolerance must exceed the per-orbit
  oscillation, or target a smoother quantity.
- Finite burns (electric): `Vary BurnTime` → `BeginFiniteBurn` → `Propagate {ElapsedSecs}` →
  `EndFiniteBurn` → `Achieve`. The full EP stack is tank + thruster + power system, all three
  attached to the spacecraft, `DecrementMass = true`.

## Stop conditions that fail silently or loudly

- A circular orbit has no periapsis/apoapsis: `Propagate {Sat.Earth.Periapsis}` on ECC≈0
  dies with "Unable to interpolate a stop epoch". Burn at t=0 or use a timed stop instead.
- `ElapsedSecs`/`ElapsedDays` are cumulative from epoch — after earlier propagates, a literal
  duration is already satisfied. Track an accumulator variable.
- Hardware quantities in `Report` are spacecraft-qualified parameters (e.g. the fuel mass of
  tank `ETank` on `Sat` is `Sat.ETank.FuelMass`); a bare `ETank.FuelMass` in a Report is a
  parse error even though assignments to `ETank.FuelMass` are fine.

## Reporting to the user

Lead with the verified result and its provenance: ΔV (per burn and total), time of flight,
final orbit elements or relative range — all read from the report file. State the force model
(two-body vs J2 vs full) because results differ and the difference is often the interesting
finding. If the analytic estimate and the simulation diverged, say why — that narrative
("textbook says X, simulator under J2 says Y") is the most valuable thing you produce.
