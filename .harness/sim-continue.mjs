const APP = "http://localhost:3000";
const TOKEN = "s3-f873dea37fc57d41";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// stream log batches (multi-round: older rounds first — must be dropped)
await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/logs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ uid: "J2", images: [
    { fileid: "j2_fsc_r1", name: "fsc_r1.png", text: "FSC curve", flags: null },
    { fileid: "j2_fsc_r2", name: "fsc_r2.png", text: "FSC curve", flags: null },
  ] }] }),
});
console.log("logs batch 1 (J2)");
await sleep(3000);
await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/logs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ uid: "J3", images: [
    { fileid: "j3_sel_r1", name: "sel_r1.png", text: "Selected 21 classes", flags: null },
    { fileid: "j3_sel_r2", name: "sel_r2.png", text: "Selected 21 classes", flags: null },
    { fileid: "j3_exc_r2", name: "exc_r2.png", text: "Excluded 179 classes", flags: null },
  ] }] }),
});
console.log("logs batch 2 (J3)");
await sleep(3000);

await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/images`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [
    { fileid: "j2_fsc_r2", data: `data:image/png;base64,${PNG}`, name: "fsc_r2.png" },
    { fileid: "j3_sel_r2", data: `data:image/png;base64,${PNG}`, name: "sel_r2.png" },
    { fileid: "j3_exc_r2", data: `data:image/png;base64,${PNG2}`, name: "exc_r2.png" },
    { fileid: "vol_prev", data: `data:image/png;base64,${PNG2}`, name: "vol_prev.png" },
    { fileid: "j3_vol_prev", data: `data:image/png;base64,${PNG}`, name: "j3_vol_prev.png" },
    { fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" },
  ] }),
});
console.log("image bytes posted");
await sleep(2000);
await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
console.log("complete");
