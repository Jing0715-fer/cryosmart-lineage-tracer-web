import numpy as np
exec(open('test_volstats.py').read().split('rng =')[0])  # reuse volstats_extras

rng = np.random.default_rng(11)
# case 1: MASKED postprocessed map (90% exact zeros, protein + hot detergent)
n = 160**3
base = np.zeros(n)
idx = rng.choice(n, int(n*0.004), replace=False)
base[idx] = rng.normal(0.12, 0.04, len(idx))
idx2 = rng.choice(n, int(n*0.001), replace=False)
base[idx2] = rng.normal(0.35, 0.06, len(idx2))
s = volstats_extras(base)
print("MASKED  otsu=%.5f otsu2=%.5f max=%.3f auto=%.4f ladder_rungs=%d" % (
    s["otsu"], s.get("otsu2", -1), base.max(),
    min(0.25*base.max(), 0.85*s.get("otsu2", 1)), len(s.get("env_levels", []))))

# case 2: raw noisy map with NEGATIVE values
raw = rng.normal(0, 0.05, n)
sig = rng.normal(0.2, 0.07, int(n*0.003))
spk = rng.normal(1.0, 0.2, 40)
flat = np.concatenate([raw, sig, spk])
s2 = volstats_extras(flat)
lv, ct = np.array(s2["env_levels"]), np.array(s2["env_counts"])
print("RAW     otsu=%.5f otsu2=%.5f max=%.3f  ladder[0]=(%.4f,%d) monotone=%s" % (
    s2["otsu"], s2.get("otsu2", -1), flat.max(), lv[0], ct[0],
    bool(np.all(np.diff(ct) < 0) and np.all(np.diff(lv) > 0))))

# case 3: degenerate — constant map
try:
    s3 = volstats_extras(np.zeros(1000))
    print("CONST   keys:", sorted(k for k in s3 if k not in ("max","mean","sd","min")))
except Exception as e:
    print("CONST   exception:", type(e).__name__, str(e)[:60])
