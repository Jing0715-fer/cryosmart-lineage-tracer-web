const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
(async () => {
  const t = process.argv[2];
  await fetch(`${APP}/api/cryosmart/import/session/${t}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { uid: "J2", images: [
          { fileid: "j2_fsc_r1", name: "fsc_r1.png", text: "FSC curve" },
          { fileid: "j2_fsc_r2", name: "fsc_r2.png", text: "FSC curve" },
        ] },
        { uid: "J3", images: [
          { fileid: "j3_sel_r1", name: "sel_r1.png", text: "Selected 21 classes" },
          { fileid: "j3_exc_r1", name: "exc_r1.png", text: "Excluded 179 classes" },
          { fileid: "j3_sel_r2", name: "sel_r2.png", text: "Selected 21 classes" },
          { fileid: "j3_exc_r2", name: "exc_r2.png", text: "Excluded 179 classes" },
        ] },
      ],
    }),
  });
  console.log("logs posted (interleaved rounds: sel,exc × 2)");
  await new Promise((r) => setTimeout(r, 1500));
  await fetch(`${APP}/api/cryosmart/import/session/${t}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { fileid: "j2_fsc_r2", data: `data:image/png;base64,${PNG}`, name: "fsc_r2.png" },
        { fileid: "j3_sel_r2", data: `data:image/png;base64,${PNG}`, name: "sel_r2.png" },
        { fileid: "j3_exc_r2", data: `data:image/png;base64,${PNG2}`, name: "exc_r2.png" },
        { fileid: "vol_prev", data: `data:image/png;base64,${PNG2}`, name: "vol_prev.png" },
        { fileid: "j3_vol_prev", data: `data:image/png;base64,${PNG}`, name: "j3_vol_prev.png" },
        { fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" },
      ],
    }),
  });
  console.log("images posted");
  await new Promise((r) => setTimeout(r, 1000));
  await fetch(`${APP}/api/cryosmart/import/session/${t}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  console.log("complete");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
