---
name: gmat-improve
description: Improve, debug, harden, or modernize an existing GMAT script through a verified run-diagnose-fix loop using the gmat MCP tools. Use this skill whenever the user provides or points to a .script file and wants it fixed, reviewed, optimized, made more robust, adapted to a new GMAT version, converted to run headless, or asks why a GMAT script fails or gives wrong numbers — even if they just say "mejorá este script" or "why doesn't this converge".
---

# GMAT script improvement loop

You improve a script the same way you'd review a colleague's mission design: first make
sure you understand what it *intends* to do, then verify what it *actually* does, then
change one thing at a time with a re-run after each change. Never deliver an edited
script you haven't re-run.

## The loop

1. **Establish intent.** Read the script and write one paragraph: mission type, spacecraft,
   force model, maneuvers, what the targeters/optimizers are solving for, what the outputs
   should be. If intent is ambiguous, ask the user before changing behavior.

2. **Baseline run.** `runGmat` the script untouched. Record: stage, errors, report values,
   wall time (from the result). This baseline is your regression test — every improvement
   must either preserve these numbers (within tolerance) or change them for an explained,
   intended reason.

3. **Diagnose against the known failure catalog.** Call `getGmatIdioms` and check the
   script against it. The highest-frequency offenders in real community scripts, in order:
   - **Hardcoded absolute paths** in `ReportFile.Filename`, SPICE kernels, gravity files —
     the #1 portability killer. Rewrite report filenames to bare names; flag missing data
     files to the user rather than guessing replacements.
   - Non-ASCII characters (accented comments break the whole parse).
   - Hardcoded burn values that should be targeted (`Maneuver` with magic numbers and no
     `Target` block — fragile to any upstream change).
   - Stop conditions that fail on circular orbits (apsides) or cumulative-ElapsedSecs bugs.
   - Tight `Achieve` tolerances on osculating elements under J2.
   - GUI subscribers (`OrbitView`, `XYPlot`) in scripts meant to run headless — harmless
     in console mode but noise; keep them only if the user uses the GUI.
   - Unthrottled `ReportFile` on long propagations (megabytes of substeps).
   - `While`/`If` with compound `&`/`|` guards or parentheses (unreliable / parse error).

4. **Fix in priority order, one re-run per change:**
   a. *Correctness* — it must run to `completed` and the physics must check out against a
      quick analytic estimate (vis-viva, periods, ΔV budgets). A converged-but-wrong
      script is worse than a broken one.
   b. *Robustness* — replace magic numbers with targeted variables, add iteration caps and
      elapsed-time guards to loops, seed `Vary` with analytic guesses and honest bounds.
   c. *Performance* — raise `MaxStep` on long coasts, drop it only for burn arcs and
      prox-ops, throttle reports with `WriteReport` toggles.

5. **Deliver a before/after table**: each change, why, and the verified effect (stage,
   key report numbers, runtime). If a number changed, explain the physics of why. State
   what you did NOT change (e.g. kept their force model even if unusual) and why.

## Improvement is not rewriting

Respect the author's structure, naming, and modeling choices unless they're wrong.
The user asked for *their* script improved, not *your* script. A diff a mission designer
can review in two minutes is worth more than a pristine rewrite they have to re-learn.
If a structural rewrite genuinely is the right call (e.g. the 600-variable station-keeping
PID trap), propose it with the reasoning and let the user choose.
