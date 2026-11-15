import numpy as np

def volstats_extras(flat):
    out = {}
    lo, hi = float(flat.min()), float(flat.max())
    edges = np.linspace(lo, hi, 257)
    hist, _ = np.histogram(flat, bins=edges)
    centers = 0.5 * (edges[:-1] + edges[1:])
    total = float(hist.sum())
    w0 = np.cumsum(hist).astype(np.float64); w1 = total - w0
    csum = np.cumsum(hist * centers); sum_all = float(csum[-1])
    valid = (w0 > 0) & (w1 > 0)
    mu0 = csum / np.maximum(w0, 1.0); mu1 = (sum_all - csum) / np.maximum(w1, 1.0)
    between = np.where(valid, w0 * w1 * (mu0 - mu1) ** 2, -1.0)
    otsu1 = float(centers[int(np.argmax(between))]); out["otsu"] = otsu1
    env_bins = centers >= otsu1
    eh = hist[env_bins].astype(np.float64); ec = centers[env_bins]
    if eh.sum() >= 64 and len(eh) >= 2:
        et = float(eh.sum()); ew0 = np.cumsum(eh); ew1 = et - ew0
        ecsum = np.cumsum(eh * ec); esum = float(ecsum[-1])
        evalid = (ew0 > 0) & (ew1 > 0)
        emu0 = ecsum / np.maximum(ew0, 1.0); emu1 = (esum - ecsum) / np.maximum(ew1, 1.0)
        ebetween = np.where(evalid, ew0 * ew1 * (emu0 - emu1) ** 2, -1.0)
        out["otsu2"] = float(ec[int(np.argmax(ebetween))])
    cum_ge = total - np.concatenate(([0.0], np.cumsum(hist)))
    lo_i = int(np.searchsorted(edges, otsu1, side="right")) - 1
    hi_i = len(edges) - 1
    lo_i = max(0, min(lo_i, hi_i - 1))
    if hi_i - lo_i >= 4:
        idx = np.unique(np.linspace(lo_i, hi_i, 24).round().astype(int))
        out["env_levels"] = [float(edges[i]) for i in idx]
        out["env_counts"] = [float(cum_ge[i]) for i in idx]
    return out

rng = np.random.default_rng(7)
# simulated P283-like reference map: box 180^3, solvent noise, protein, hot detergent
n = 180**3
solvent = rng.normal(0, 0.02, n)
protein = rng.normal(0.10, 0.03, int(n*0.004))
detergent = rng.normal(0.30, 0.05, int(n*0.002))  # hot phase incl. micelles
flat = np.concatenate([solvent, protein, detergent])
s = volstats_extras(flat)
print("REF  otsu=%.4f otsu2=%.4f max=%.3f  auto=min(0.25max, 0.85otsu2)=%.4f" % (
    s["otsu"], s["otsu2"], flat.max(), min(0.25*flat.max(), 0.85*s["otsu2"])))
print("     ladder[0..3]", [(round(l,3), int(c)) for l,c in zip(s["env_levels"][:4], s["env_counts"][:4])])

# a noisy class map: noise spike max 1.4, protein weaker/sharper
noise = rng.normal(0, 0.06, n)
spike = rng.normal(1.4, 0.1, 50)
protein2 = rng.normal(0.18, 0.06, int(n*0.003))
flat2 = np.concatenate([noise, protein2, spike])
s2 = volstats_extras(flat2)
print("CLS  otsu=%.4f otsu2=%.4f max=%.3f  0.25max=%.4f (speckle if < otsu!)" % (
    s2["otsu"], s2["otsu2"], flat2.max(), 0.25*flat2.max()))

# page-side matching: reference level from its own auto rule
refL = min(0.25*flat.max(), 0.85*s["otsu2"])
# interpolate ref ladder at refL -> N_ref
lv, ct = np.array(s["env_levels"]), np.array(s["env_counts"])
N_ref = np.interp(np.log(refL), np.log(lv), np.log(ct))  # crude; real page does bracketing
N_ref = float(np.exp(N_ref))
print("     ref level %.4f -> N_ref %d" % (refL, N_ref))
# class map count-match on ITS ladder
lv2, ct2 = np.array(s2["env_levels"]), np.array(s2["env_counts"])
# bracket
j = np.searchsorted(-ct2, -N_ref)  # counts decreasing; find first count <= N_ref
j = min(max(j, 1), len(ct2)-1)
c_hi, c_lo = ct2[j-1], ct2[j]  # c_hi >= N_ref >= c_lo
t = (np.log(c_hi) - np.log(N_ref)) / (np.log(c_hi) - np.log(c_lo))
L_m = float(np.exp(np.log(lv2[j-1]) + t*(np.log(lv2[j]) - np.log(lv2[j-1]))))
print("     class matched level %.4f (vs its otsu %.4f -> above noise floor: %s)" % (
    L_m, s2["otsu"], L_m >= s2["otsu"]))
