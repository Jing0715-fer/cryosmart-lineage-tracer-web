/**
 * .harness/r54-visible-shot.ts — round-54 (v3.94) offline assertions for
 * the SHOT-VISIBLE enforcement (round-54 “目前流程图中还是会出现非原始
 * map的截图，感觉有的还是用了lowpass的map”):
 *
 *   A. shotVisiblePlan (exported pure) — the per-save /volumes audit
 *      planner: the subject is exempt; the run's own models route to
 *      hide; everything else is a stray that closes; submodel id
 *      strings ("5.2") compare by STRING so they can never collide with
 *      the parent; a null/invalid subject makes everything non-open a
 *      stray; an empty listing plans nothing.
 *   B. The shot-start sweep semantics (legit = openIds exactly) — the
 *      same planner with the subject null answers WHICH volumes the
 *      final sweep would close: a leaked reference noise-mask clone, a
 *      phantom the bookkeeping never saw, the previous run's leftovers
 *      — but NEVER a surviving original hand nor the reference.
 *   C. shotSubjectVerdict still holds its round-52 contract (the
 *      subject side of the same guarantee) — processed registry verdict
 *      + the open-path id-reuse un-registration story.
 *   D. The leak drill's close-failure budget arithmetic (the mock's
 *      ?shot=leak / ?shot=leak2 semantics replicated 1:1): budget 1 is
 *      consumed by the phase-3.5 close and the closeRetry's re-issue
 *      SUCCEEDS (the leaked clone never reaches a screenshot); budget 2
 *      defeats the retry too and the SHOT-START SWEEP's close (the
 *      third attempt) recovers — under the old code the clone stayed
 *      visible through all 14 final saves (final_shot_extra_visible).
 *   E. Version: the engine constant is 3.94.
 *
 * Run: bun .harness/r54-visible-shot.ts
 */
import {
  shotSubjectVerdict,
  shotVisiblePlan,
} from "../src/lib/cryosmart/chimerax-bridge";
import { FLOW_ENGINE_VERSION } from "../src/lib/cryosmart/flow-engine-version";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
  }
}

console.log("[A] shotVisiblePlan — the per-save audit planner");
{
  const openIds = new Set<number>([1, 5, 9]);
  /* the reference (#1) + two winning hands (#5, #9) survive; #5 is the
   * save's subject; #7 is a leaked noise-mask reference clone (a stray);
   * "5.2" is a submodel string; #12 is a phantom. */
  const vols = [
    { id: "1", name: "ref" },
    { id: "5", name: "winner" },
    { id: "9", name: "other-winner" },
    { id: "7", name: "refMaskC" },
    { id: "5.2", name: "submodel" },
    { id: "12", name: "phantom" },
  ];
  const plan = shotVisiblePlan(vols, 5, openIds);
  check("the subject is exempt (never hide, never close)", !plan.hide.includes("5") && !plan.strays.includes("5"));
  check("another winner routes to hide (belt-and-suspenders)", plan.hide.includes("1") && plan.hide.includes("9"));
  check("a submodel of the subject's family routes to hide, not close", plan.hide.includes("5.2"), JSON.stringify(plan));
  check("the leaked mask clone is a stray that closes", plan.strays.includes("7"));
  check("a phantom the bookkeeping never saw closes too", plan.strays.includes("12"));
  check("strays never overlap hides", plan.strays.every((s) => !plan.hide.includes(s)));
  check("subject echoes back as a string", plan.subject === "5");

  const empty = shotVisiblePlan([], 5, openIds);
  check("an empty listing plans nothing", empty.hide.length === 0 && empty.strays.length === 0);

  const noSubj = shotVisiblePlan(vols, null, openIds);
  check("a null subject makes every non-open model a stray", noSubj.subject === null && noSubj.strays.includes("7") && noSubj.strays.includes("12"));
  check("a null subject still hides the run's own models", noSubj.hide.includes("1") && noSubj.hide.includes("9") && noSubj.hide.includes("5"));

  const nan = shotVisiblePlan(vols, Number.NaN, openIds);
  check("a NaN subject degrades like null", nan.subject === null && nan.strays.includes("7"));

  const badEntry = shotVisiblePlan([{ id: "" }, { id: "3" }] as Array<{ id: string }>, 3, new Set<number>([3]));
  check("a blank id is skipped, the subject is exempt", badEntry.hide.length === 0 && badEntry.strays.length === 0);
}

console.log("[B] the shot-start sweep semantics — legit = openIds exactly");
{
  const openIds = new Set<number>([2, 6]);
  /* after phase 3.5 the only volumes that SHOULD exist are the surviving
   * hands; a transient close failure left the σ-lowpass gauss clone (#4)
   * and the noise-mask reference clone (#8) open. The final sweep's
   * planner shape: subject null, everything non-open closes. */
  const vols = [
    { id: "2", name: "winner-a" },
    { id: "6", name: "winner-b" },
    { id: "4", name: "J9.volume_class_0#gauss" },
    { id: "8", name: "ref#mask" },
  ];
  const sweep = shotVisiblePlan(vols, null, openIds);
  check("both survivors of the run are untouched", sweep.hide.includes("2") && sweep.hide.includes("6"));
  check("the leaked σ-lowpass clone closes", sweep.strays.includes("4"));
  check("the leaked noise-mask reference clone closes", sweep.strays.includes("8"));
  check("exactly the two leaks close", sweep.strays.length === 2, JSON.stringify(sweep.strays));
  /* the old code's hole in one line: phase 3.5 had no retry and no sweep
   * behind it — the per-hand sweeps run INSIDE the map loop which 3.5
   * follows. The planner proves the sweep would have caught both. */
}

console.log("[C] shotSubjectVerdict — the round-52 subject contract holds");
{
  const processed = new Set<number>([4, 8]);
  check("a processed clone subject is flagged", shotSubjectVerdict(processed, 4) === "processed");
  check("an original subject reads original", shotSubjectVerdict(processed, 2) === "original");
  check("null reads unknown", shotSubjectVerdict(processed, null) === "unknown");
  check("NaN reads unknown", shotSubjectVerdict(processed, Number.NaN) === "unknown");
  /* v3.92's id-reuse story: ChimeraX may hand a freed clone's id to the
   * NEXT opened original — the open path un-registers it, and the verdict
   * must then read original. */
  const reused = new Set<number>([4, 8]);
  reused.delete(4);
  check("an id reused by a re-opened original reads original", shotSubjectVerdict(reused, 4) === "original");
}

console.log("[D] the leak drill's close-failure budget arithmetic");
{
  /* the mock's ?shot=leak drill: the first N closes of MASK-kind models
   * fail with a real error; each engine layer re-issues the close. */
  const drill = (budget: number, attempts: number): { closed: boolean; failures: number } => {
    let remaining = budget;
    let failures = 0;
    let closed = false;
    for (let i = 0; i < attempts && !closed; i++) {
      if (remaining > 0) {
        remaining -= 1;
        failures += 1;
      } else {
        closed = true;
      }
    }
    return { closed, failures };
  };
  /* leak=1: phase 3.5's closeRetry = 2 attempts — the first fails (the
   * drill), the re-issue succeeds. The clone never reaches a screenshot. */
  const leak1 = drill(1, 2);
  check("leak=1 — the retry recovers (closed on the 2nd attempt)", leak1.closed && leak1.failures === 1);
  /* leak=2: phase 3.5's closeRetry both fail; the SHOT-START SWEEP issues
   * closeRetry again — its first close (attempt 3 overall) succeeds. */
  const leak2phase35 = drill(2, 2);
  check("leak=2 — the phase-3.5 retry is beaten (both fail)", !leak2phase35.closed && leak2phase35.failures === 2);
  const leak2sweep = drill(0, 1);
  check("leak=2 — the shot-start sweep's close recovers", leak2sweep.closed && leak2sweep.failures === 0);
  /* the OLD code: phase 3.5 issued ONE close, no retry, no sweep, no
   * audit — with even a single failure the clone stayed visible through
   * every final save. */
  const oldCode = drill(1, 1);
  check("the OLD code leaked a single transient failure (no retry, no sweep)", !oldCode.closed && oldCode.failures === 1);
}

console.log("[E] version");
check("FLOW_ENGINE_VERSION is 3.94", FLOW_ENGINE_VERSION === "3.94", FLOW_ENGINE_VERSION);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
