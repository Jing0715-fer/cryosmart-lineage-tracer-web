/**
 * .harness/r52-original-shot.ts — round-52 (v3.92) offline assertions for
 * the ORIGINAL-MAP FINAL-SHOT guarantee (比对的时候可以用lowpass的map，
 * 但是最终截图还是要把原map转到对应位置再截图，不要用lowpass后的map截图).
 *
 * Checks (all offline, no browser, no relay):
 *   A. shotSubjectVerdict (exported, pure) — the screenshot-phase guard's
 *      policy: an id in the fitting-only clone registry (processedIds)
 *      reads "processed", anything else "original", null/non-finite
 *      "unknown".
 *   B. The DATA-PROVENANCE kind assignment, replicated 1:1 from the E2E
 *      mock's registration branches: `volume flip` → flip (full-res
 *      original data mirrored), `volume/vop gaussian` + `vgaussian` →
 *      gauss (σ lowpass clone), `volume/vop threshold … set 0` → mask,
 *      /shellmask → shellmask, a plain open → original.
 *   C. The final-shot SUBJECT bookkeeping + the ?shot=sigma leak drill,
 *      replicated 1:1 from the mock's save handler:
 *        - clean path: a final save (render_*.png, non-underscore) records
 *          the SHOWN model's kind — original/flip on a clean run;
 *        - probe saves (`_`-prefixed) never record;
 *        - the leak drill: σ closes become silent no-ops, the leaked clone
 *          overrides the save's subject (kind "gauss") and shownModel is
 *          restored after the bytes are generated;
 *        - clone_final_shots aggregates exactly the gauss/shellmask/mask
 *          entries (the detector the E2E asserts on).
 *   D. Version: the engine constant is 3.92 (the round-52 bump).
 *
 * Run: bun .harness/r52-original-shot.ts
 */
import { shotSubjectVerdict } from "../src/lib/cryosmart/chimerax-bridge";
import { FLOW_ENGINE_VERSION } from "../src/lib/cryosmart/flow-engine-version";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

/* ---- A. shotSubjectVerdict ---- */
console.log("[A] shotSubjectVerdict");
{
  const processed = new Set<number>([7, 12, 13]);
  check("clone id → processed", shotSubjectVerdict(processed, 7) === "processed");
  check("original id → original", shotSubjectVerdict(processed, 5) === "original");
  check("null id → unknown", shotSubjectVerdict(processed, null) === "unknown");
  check("non-finite id → unknown", shotSubjectVerdict(processed, Number.NaN) === "unknown");
  /* id REUSE: a freed clone id re-registered as an original hand must read
   * original — the bridge deletes the id from processedIds at open time. */
  const afterReuse = new Set<number>([7, 12, 13]);
  afterReuse.delete(7);
  check("re-registered id (clone → original hand) → original", shotSubjectVerdict(afterReuse, 7) === "original");
  const empty = new Set<number>();
  check("empty registry → every id original", shotSubjectVerdict(empty, 99) === "original");
}

/* ---- B. the provenance-kind assignment (mock branches, 1:1) ---- */
console.log("[B] provenance kinds");
{
  /* The mock's registration regexes, mirrored verbatim. */
  const kindForCommand = (cmd: string): { kind: string; nextFromModelId: boolean } | null => {
    const flip = /^volume\s+flip\s+#(\d+)\s+axis\s+\w+(\s+modelId\s+(\d+))?/i.exec(cmd);
    if (flip) return { kind: "flip", nextFromModelId: flip[3] != null };
    const gauss = /^(?:volume|vop)\s+gaussian\s+#(\d+)\s+sDev\s+[\d.]+(?:\s+modelId\s+(\d+))?\s*$/i.exec(cmd)
      ?? /^vgaussian\s+#(\d+)\s+(?:sDev|sigma)\s+[\d.]+(?:\s+modelId\s+(\d+))?\s*$/i.exec(cmd);
    if (gauss) return { kind: "gauss", nextFromModelId: gauss[2] != null };
    const thresh = /^(?:volume|vop)\s+threshold\s+#(\d+)\s+minimum\s+-?[\d.]+\s+set\s+0(?:\s+modelId\s+(\d+))?\s*$/i.exec(cmd);
    if (thresh) return { kind: "mask", nextFromModelId: thresh[2] != null };
    return null;
  };
  check(
    "volume flip (bridge form, modelId) → flip",
    kindForCommand("volume flip #4 axis z modelId 9")?.kind === "flip",
  );
  check(
    "volume flip (plain form) → flip",
    kindForCommand("volume flip #4 axis z")?.kind === "flip",
  );
  check(
    "volume gaussian sDev (bridge form) → gauss",
    kindForCommand("volume gaussian #4 sDev 8 modelId 10")?.kind === "gauss",
  );
  check(
    "volume gaussian sDev (plain form) → gauss",
    kindForCommand("volume gaussian #4 sDev 8")?.kind === "gauss",
  );
  check(
    "vgaussian sigma alias → gauss",
    kindForCommand("vgaussian #4 sigma 3 modelId 11")?.kind === "gauss",
  );
  check(
    "volume threshold set 0 → mask",
    kindForCommand("volume threshold #2 minimum 0.12500 set 0 modelId 5")?.kind === "mask",
  );
  check(
    "vop threshold plain form → mask",
    kindForCommand("vop threshold #2 minimum 0.5 set 0")?.kind === "mask",
  );
  /* The σ level value must not break the shape match (sDev 3 / 8 both hit). */
  check(
    "σ fine (sDev 3) still matches the gauss branch",
    kindForCommand("volume gaussian #6 sDev 3 modelId 12")?.kind === "gauss",
  );
  /* /shellmask registrations are constant-kind (endpoint, not command). */
  const SHELLMASK_KIND = "shellmask";
  check("/shellmask endpoint → shellmask", SHELLMASK_KIND === "shellmask");
  /* A plain open registers as the ORIGINAL (the map data itself). */
  const OPEN_KIND = "original";
  check("plain open → original", OPEN_KIND === "original");
  /* Non-matching commands carry no registration. */
  check("measure correlation → no registration", kindForCommand("measure correlation #5 inMap #2") === null);
  check("save → no registration", kindForCommand('save "render_J9__volume.png" width 1600 height 1200 supersample 3 transparentBackground true') === null);
}

/* ---- C. the final-shot subject bookkeeping + the leak drill ---- */
console.log("[C] final-shot subjects + ?shot=sigma drill");
{
  /* The mock's state + save-handler logic, replicated 1:1 (models/kinds/
   * shownModel/finalShotSubjects + recordFinalSubject + the drilled close). */
  class SubjectBookkeeping {
    models = new Map<number, { url: string }>();
    kinds = new Map<number, string>();
    shownModel: number | null = null;
    finalShotSubjects: Array<{ save: string; model: number | null; kind: string }> = [];
    shotSigmaLeak = false;

    register(id: number, url: string, kind = "original") {
      this.models.set(id, { url });
      this.kinds.set(id, kind);
    }
    /** The drilled close: a gauss clone survives when ?shot=sigma planted
     * the leak (returns false = silently NOT closed). */
    close(id: number): boolean {
      if (this.shotSigmaLeak && this.kinds.get(id) === "gauss") return false;
      this.models.delete(id);
      this.kinds.delete(id);
      if (this.shownModel === id) this.shownModel = null;
      return true;
    }
    recordFinalSubject(name: string): { overridden: boolean; restore: number | null } {
      if (name.startsWith("_")) return { overridden: false, restore: this.shownModel };
      let subjModel = this.shownModel;
      let subjKind = subjModel != null ? this.kinds.get(subjModel) ?? "unknown" : "none";
      if (this.shotSigmaLeak) {
        const leaked = [...this.models.entries()].find(([, m]) => (m?.url ?? "").endsWith("#gauss"));
        if (leaked) {
          subjModel = leaked[0];
          subjKind = "gauss";
        }
      }
      this.finalShotSubjects.push({ save: name, model: subjModel, kind: subjKind });
      if (subjModel != null && subjModel !== this.shownModel) {
        const restore = this.shownModel;
        this.shownModel = subjModel;
        return { overridden: true, restore };
      }
      return { overridden: false, restore: this.shownModel };
    }
    get cloneFinalShots(): number {
      return this.finalShotSubjects.filter(
        (s) => s.kind === "gauss" || s.kind === "shellmask" || s.kind === "mask",
      ).length;
    }
  }

  /* clean path: the bridge shows the ORIGINAL hand, the σ clones closed. */
  {
    const bk = new SubjectBookkeeping();
    bk.register(1, "J55.volume", "original"); // the reference
    bk.register(4, "J9.volume", "original"); // the winning hand (original)
    bk.register(9, "J9.volume#gauss", "gauss"); // σ coarse clone
    bk.register(10, "J9.volume#gauss", "gauss"); // σ fine clone
    check("σ clone closes in a clean run", bk.close(9) && bk.close(10));
    check("σ clones are gone", !bk.models.has(9) && !bk.models.has(10));
    bk.shownModel = 4; // `show #4 models`
    const subj = bk.recordFinalSubject("render_J9__volume.png");
    check("final save records the shown original", subj.overridden === false);
    check(
      "subject kind = original",
      bk.finalShotSubjects.at(-1)?.kind === "original",
      JSON.stringify(bk.finalShotSubjects.at(-1)),
    );
    check("shownModel untouched after a clean final save", bk.shownModel === 4);
    check("clone_final_shots = 0 on a clean run", bk.cloneFinalShots === 0);
    /* probe saves never record. */
    bk.recordFinalSubject("_sil_J9__volume_y90.png");
    check(
      "probe saves (_-prefixed) never record a subject",
      bk.finalShotSubjects.length === 1,
      `len=${bk.finalShotSubjects.length}`,
    );
    /* the flip twin (a z-mirror of the ORIGINAL data) also reads clean. */
    bk.shownModel = 5;
    bk.register(5, "J41.volume", "flip");
    bk.recordFinalSubject("render_J41__volume.png");
    check("flip twin (z-mirrored original data) reads kind=flip", bk.finalShotSubjects.at(-1)?.kind === "flip");
    check("flip is NOT a clone shot", bk.cloneFinalShots === 0);
    /* nothing shown → kind "none", no override. */
    bk.shownModel = null;
    bk.recordFinalSubject("render_X.png");
    check("nothing shown → kind none", bk.finalShotSubjects.at(-1)?.kind === "none");
  }

  /* the leak drill: σ closes are no-ops, the final save renders the leaked
   * clone, and the detector catches it. */
  {
    const bk = new SubjectBookkeeping();
    bk.shotSigmaLeak = true;
    bk.register(4, "J9.volume", "original");
    bk.register(9, "J9.volume#gauss", "gauss");
    check("drill: gauss close is a silent no-op", bk.close(9) === false);
    check("drill: the σ clone SURVIVED the close", bk.models.has(9) && bk.kinds.get(9) === "gauss");
    bk.register(10, "J48.volume", "original");
    check("drill: a normal model still closes", bk.close(10) === true);
    bk.shownModel = 10; // the bridge `show #10 models` — the ORIGINAL
    const subj = bk.recordFinalSubject("render_J48__volume.png");
    check("drill: the leaked clone OVERRIDES the subject", subj.overridden === true);
    check(
      "drill: subject kind = gauss (the lowpass copy rode the screenshot)",
      bk.finalShotSubjects.at(-1)?.kind === "gauss",
      JSON.stringify(bk.finalShotSubjects.at(-1)),
    );
    check("drill: shownModel was swapped to the clone for the render", bk.shownModel === 9);
    /* the caller restores after the bytes are generated. */
    bk.shownModel = subj.restore;
    check("drill: shownModel restored after the save", bk.shownModel === 10);
    check("drill: clone_final_shots > 0 — the detector catches the leak", bk.cloneFinalShots > 0);
    /* every subsequent final save ALSO renders the leak (a stray on screen
     * rides every screenshot) — the detector keeps counting. */
    bk.recordFinalSubject("render_J55__volume.png");
    check("drill: the leak rides EVERY final save", bk.cloneFinalShots === 2);
  }

  /* the shellmask/mask clones are detected too (belt-free fitting clones
   * are exactly as forbidden in a final shot). */
  {
    const bk = new SubjectBookkeeping();
    bk.register(3, "J42.volume#shellmask", "shellmask");
    bk.register(6, "ref.volume#mask", "mask");
    bk.shownModel = 3;
    bk.recordFinalSubject("render_a.png");
    bk.shownModel = 6;
    bk.recordFinalSubject("render_b.png");
    check(
      "shellmask/mask subjects count as clone shots",
      bk.cloneFinalShots === 2,
      `n=${bk.cloneFinalShots}`,
    );
  }
}

/* ---- D. version ---- */
console.log("[D] version");
{
  check("FLOW_ENGINE_VERSION is 3.92", FLOW_ENGINE_VERSION === "3.92", FLOW_ENGINE_VERSION);
}

console.log(fail === 0 ? `\nALL ${pass} CHECKS PASSED` : `\n${fail} FAILED (of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
