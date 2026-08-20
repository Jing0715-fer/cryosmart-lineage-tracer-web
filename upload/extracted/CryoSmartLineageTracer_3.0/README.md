# CryoSmart Lineage Tracer 3.0

This local Web Extension exports CryoSmart project metadata, traces particle/map lineage for a target job, and downloads a readable HTML report.

Current focus:

- Final particle count
- Micrograph source counts
- Per-job normal map download URLs
- Particle/map upstream lineage
- Same-type upstream tracing in merged source rows: particle rows trace particle inputs only, map rows trace map inputs only, and micrograph rows trace micrograph inputs only
- Ab initio and hetero class splits, including class particle count and percentage
- Compact HTML report with a left lineage outline and right main data-chain cards; all traced jobs are listed on the right
- Normal `map` downloads only in lineage reports, without `map_sharp`
- `import_micrographs` cards show representative micrograph images when metadata has image links
- `select_2D` cards show selected/excluded particle and class counts plus available preview images
- Optional download of the preview images shown in the report; the HTML report prefers local relative image paths and falls back to CryoSmart URLs
- Optional download of all normal map/MRC files found in the traced chain
- The report folder includes ChimeraX Python scripts. The recommended pair is `CryoSmart_align_maps_check_view.py` first, then `CryoSmart_export_current_view_ppt.py` in the same ChimeraX session after checking or manually adjusting the view. `CryoSmart_auto_align_export_ppt.py` is the one-shot version.

Recommended workflow:

1. Open the CryoSmart Project page, for example `http://192.168.4.3:8080/#/projects/P52`.
2. Enter a start Job, for example `427`, then click `追溯颗粒和 Map 来源`.
3. The extension opens only the target Job and its upstream Metadata pages.
4. Choose whether to download preview images and normal map/MRC files.
5. Click `下载追溯报告`; the extension downloads JSON, Mermaid, preview text, and an HTML report in one folder.
6. If map/MRC files were downloaded, open `CryoSmart_align_maps_check_view.py` in ChimeraX first. It writes `chimerax_rendered_maps/alignment_debug.log`, `chimerax_alignment_log.txt`, and `.tsv`, including original/z-flip correlations and inherited map transforms. After checking or manually adjusting the view, run `CryoSmart_export_current_view_ppt.py` in the same ChimeraX session to save images and update the PPTX. Use `CryoSmart_auto_align_export_ppt.py` only when you want a single automatic run.

Notes:

- `extract_micrographs_multi` and cleanup jobs inherit the upstream particle round; they do not start a new repicking round by themselves.
- Job rounds are based on the particle lineage carried by the job, not on job numbers or page order.
- `topaz_train` and its downstream `topaz_extract` are treated as one repicking unit. If `topaz_train` is driven by a previous map/class/refinement source, both jobs enter the same new repicking round.
- A new repicking round starts only when a real particle-picking/repicking job, such as `topaz_train` + `topaz_extract`, `template_picker_gpu`, `blob_picker_gpu`, or `deep_picker_inference`, creates a new particle lineage from map/class/refinement-derived inputs.
- Map rows keep preview images and direct map downloads only.
- Preview images are downloaded through the current CryoSmart browser session, so `images/J1`, `images/J10`, and map preview images use the same authenticated fetch path as final FSC/Guinier/Direction images.

Optional full export:

- Click `可选：导出当前 Project 全部 metadata` only when you want a complete Project backup.

Fallback mode: select an already exported Project metadata JSON file manually.
