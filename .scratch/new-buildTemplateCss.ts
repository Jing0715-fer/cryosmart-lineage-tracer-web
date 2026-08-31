  /** Generate the full v3.17 stylesheet for one skin. Covers every class the
   *  body markup emits (outline / picture-flow / job cards / tables / image
   *  grids / map cells / gone-markers / responsive + print).
   *  v3.20 — full-width layout (widthMode), wider auto-fill image grids,
   *  larger media frames, 3-level visual layering (page → pane → inset
   *  boxes), sticky slim headers for minimal/slate, unified scrollbar +
   *  focus styling, and per-template flourish blocks in spec.extra. */
  function buildTemplateCss(
    spec: ReportTemplateSpec,
    fontPx: number,
    widthMode: ReportWidthMode = "full"
  ): string {
    const linkDeco =
      spec.linkUnderline === "always"
        ? "text-decoration:underline"
        : "text-decoration:none";
    const linkHoverDeco = spec.linkUnderline === "none" ? "" : "text-decoration:underline";
    const widthCap =
      widthMode === "boxed"
        ? "max-width:1280px;"
        : widthMode === "wide"
          ? "max-width:1680px;"
          : "";
    const headerCss = spec.centerHeader
      ? ".top{display:block;text-align:center}"
      : ".top{display:flex;align-items:center;gap:20px;padding:15px 28px}";
    const stickyCss = spec.stickyHeader ? "position:sticky;top:0;z-index:50" : "";
    // Boxed sections (minimal/slate): media/map blocks become inset panels on
    // panel-2 — the visible "card inside card" layering. Paper keeps the open
    // hairline-section look of a printed document.
    const sectionCss = spec.boxedSections
      ? ".source-block,.media-block,.map-block{margin-top:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2);padding:14px 16px}\n"
      : ".source-block,.media-block,.map-block{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}\n";
    const flowMax = spec.stickyHeader ? "calc(100vh - 94px)" : "calc(100vh - 32px)";
    return (
      `:root{--bg:${spec.bg};--bg-2:${spec.bg2};--panel:${spec.panel};--panel-2:${spec.panel2};--panel-3:${spec.panel3};--text:${spec.text};--text-2:${spec.text2};--text-3:${spec.text3};--muted:${spec.muted};--muted-2:${spec.muted2};--line:${spec.line};--line-2:${spec.line2};--micro:${spec.micro};--micro-bg:${spec.microBg};--micro-border:${spec.microBorder};--particle:${spec.particle};--particle-bg:${spec.particleBg};--particle-border:${spec.particleBorder};--volume:${spec.volume};--volume-bg:${spec.volumeBg};--volume-border:${spec.volumeBorder};--small-bg:${spec.smallBg};--small-border:${spec.smallBorder};--radius:${spec.radius};--radius-sm:${spec.radiusSm};--radius-lg:${spec.radiusLg};--font-ui:${spec.fontBody};--font-mono:${REPORT_FONT_MONO};--shadow-sm:${spec.shadowSm};--shadow:${spec.shadow};--link:${spec.link};--link-hover:${spec.linkHover};--th-bg:${spec.thBg};--row-hover:${spec.rowHover};--btn-bg:${spec.btnBg};--btn-text:${spec.btnText};--btn-border:${spec.btnBorder};--btn-hover-bg:${spec.btnHoverBg}}\n` +
      "*{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}\n" +
      "html{scroll-behavior:smooth;background:var(--bg)}\n" +
      `body{background:var(--bg);color:var(--text);font:${fontPx}px/1.62 var(--font-ui);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;min-height:100vh}\n` +
      "img{max-width:100%}\n" +
      `a{color:var(--link);${linkDeco}}\n` +
      `a:hover{color:var(--link-hover);${linkHoverDeco}}\n` +
      ":focus-visible{outline:2px solid var(--link);outline-offset:2px;border-radius:2px}\n" +
      "::-webkit-scrollbar{width:9px;height:9px}\n" +
      "::-webkit-scrollbar-track{background:transparent}\n" +
      "::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:5px}\n" +
      "::-webkit-scrollbar-thumb:hover{background:var(--muted-2)}\n" +
      `header{background:var(--panel);border-bottom:1px solid var(--line);${stickyCss}}\n` +
      `${headerCss}\n` +
      ".title h1{font-size:1.42em;font-weight:700;letter-spacing:-.012em;line-height:1.25;color:var(--text)}\n" +
      ".title p{margin-top:7px;color:var(--muted);font-size:.84em;letter-spacing:.01em}\n" +
      ".title p b{color:var(--text-3);font-weight:600;font-variant-numeric:tabular-nums}\n" +
      ".title .note{margin-top:5px;color:var(--text-3);font-size:.84em;font-style:italic}\n" +
      // v3.20: FULL-WIDTH workspace — no 1240px cap by default. The left
      // outline pane is proportional (capped at 540px so it never gets
      // absurd on ultra-wide monitors); the chain pane takes the rest.
      `.workspace{${widthCap}margin:0 auto;display:grid;grid-template-columns:minmax(360px,min(24vw,540px)) minmax(0,1fr);gap:24px;padding:24px clamp(20px,2.5vw,44px) 64px;width:100%;align-items:start}\n` +
      ".pane{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);overflow:hidden}\n" +
      `.flow-pane{position:sticky;top:${spec.flowTop};max-height:${flowMax};overflow:auto}\n` +
      ".flow-pane::-webkit-scrollbar{width:6px}\n" +
      ".flow-pane::-webkit-scrollbar-track{background:transparent}\n" +
      ".flow-pane::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:3px}\n" +
      ".flow-pane::-webkit-scrollbar-thumb:hover{background:var(--muted-2)}\n" +
      ".pane-head,.chain-head{display:flex;align-items:baseline;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel-2)}\n" +
      ".pane-head h2,.chain-head h2{margin:0;font-size:.8em;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}\n" +
      ".chain-head .hint{color:var(--text-3);margin-left:auto;font-size:.78em;font-weight:400;letter-spacing:0;text-transform:none}\n" +
      ".legend{display:flex;gap:14px;margin-left:auto}\n" +
      ".legend span{display:inline-flex;align-items:center;gap:6px;font-size:.7em;font-weight:600;color:var(--text-3);letter-spacing:.05em;text-transform:uppercase}\n" +
      ".legend span::before{content:\"\";width:9px;height:9px;border-radius:2px;background:var(--kc,var(--muted-2))}\n" +
      ".legend .micrograph{--kc:var(--micro)}\n" +
      ".legend .particle{--kc:var(--particle)}\n" +
      ".legend .volume{--kc:var(--volume)}\n" +
      ".outline{padding:14px}\n" +
      ".stage{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2);padding:12px;margin-bottom:10px}\n" +
      ".stage h3{margin:0 0 10px;font-size:.7em;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.09em}\n" +
      ".phase{display:grid;grid-template-columns:92px minmax(0,1fr);gap:12px;align-items:start;border-top:1px solid var(--line);padding-top:10px;margin-top:10px}\n" +
      ".phase:first-of-type{border-top:0;padding-top:0;margin-top:0}\n" +
      ".phase-label{font-size:.7em;font-weight:700;color:var(--text-3);line-height:1.4;padding-top:6px;letter-spacing:.03em;text-transform:uppercase}\n" +
      ".stage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}\n" +
      ".mini-node{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:start;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);padding:10px 12px;min-height:64px;color:var(--text);cursor:default;position:relative;overflow:hidden;transition:border-color .15s ease}\n" +
      ".mini-node::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--kc,var(--muted-2))}\n" +
      ".mini-node.micrograph{--kc:var(--micro);border-color:var(--micro-border);background:var(--micro-bg)}\n" +
      ".mini-node.particle{--kc:var(--particle);border-color:var(--particle-border);background:var(--particle-bg)}\n" +
      ".mini-node.volume{--kc:var(--volume);border-color:var(--volume-border);background:var(--volume-bg)}\n" +
      ".mini-node:hover{border-color:var(--line-2)}\n" +
      ".mini-node b{font-size:.88em;font-weight:700;display:block;grid-column:1;color:var(--text);font-family:var(--font-mono)}\n" +
      ".mini-node span{font-size:.72em;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-column:1;color:var(--text-2);margin-top:2px}\n" +
      ".mini-node em{font-style:normal;font-size:.68em;color:var(--muted);display:block;grid-column:1;margin-top:3px;line-height:1.3}\n" +
      ".mini-node p{grid-column:2;grid-row:1 / span 3;margin:0;display:grid;grid-template-columns:repeat(2,max-content);justify-content:end;align-content:start;gap:2px 3px;min-width:54px}\n" +
      ".ref-pill{display:block;border-radius:3px;padding:1px 5px;min-width:26px;text-align:center;font-size:.62em;line-height:1.2;font-style:normal;font-weight:700;border:1px solid;white-space:nowrap;letter-spacing:.02em;font-family:var(--font-mono)}\n" +
      ".ref-pill.exposure,.ref-pill.micrograph{color:var(--micro);background:var(--micro-bg);border-color:var(--micro-border)}\n" +
      ".ref-pill.particle{color:var(--particle);background:var(--particle-bg);border-color:var(--particle-border)}\n" +
      ".ref-pill.volume{color:var(--volume);background:var(--volume-bg);border-color:var(--volume-border)}\n" +
      ".ref-pill.template,.ref-pill.other{color:var(--muted);background:var(--small-bg);border-color:var(--small-border)}\n" +
      ".stage-arrow{text-align:center;color:var(--muted-2);font-weight:600;font-size:14px;margin:-2px 0 8px}\n" +
      ".picture-flow{margin:14px 0 0;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel);padding:14px 16px}\n" +
      ".picture-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:12px}\n" +
      ".picture-head h2{margin:0;font-size:.8em;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}\n" +
      ".picture-head span{font-size:.72em;color:var(--text-3)}\n" +
      ".pf-start,.pf-round,.pf-step,.pf-map-job,.pf-final{background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin:0 0 12px;transition:border-color .15s ease}\n" +
      ".pf-start:hover,.pf-round:hover,.pf-step:hover,.pf-map-job:hover,.pf-final:hover{border-color:var(--line-2)}\n" +
      ".pf-big{font-size:1.15em;font-weight:700;color:var(--text);text-align:center;font-family:var(--font-mono);letter-spacing:-.01em}\n" +
      ".pf-note{font-size:.78em;color:var(--text-3);line-height:1.55;text-align:center;margin-top:5px}\n" +
      ".pf-mic-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:10px 0}\n" +
      ".pf-mic-imgs img{width:100%;aspect-ratio:4/3;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2)}\n" +
      ".pf-arrow{text-align:center;font-size:15px;line-height:1;color:var(--muted-2);margin:6px 0 10px}\n" +
      ".pf-round-head h3{margin:0 0 10px;font-size:.95em;font-weight:700;color:var(--text)}\n" +
      ".pf-subhead{font-size:.68em;font-weight:700;text-align:center;margin:0 0 8px;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em}\n" +
      ".pf-particle-steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin-bottom:10px}\n" +
      ".pf-particle-step{display:block;border:1px solid var(--line);border-left:3px solid var(--particle);border-radius:var(--radius);background:var(--panel);padding:11px;color:var(--text);transition:border-color .15s ease}\n" +
      ".pf-particle-step:hover{border-color:var(--line-2)}\n" +
      ".pf-particle-step b{display:block;font-size:.85em;font-weight:700;font-family:var(--font-mono);color:var(--particle)}\n" +
      ".pf-particle-step span{display:block;font-size:.72em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-2);margin-top:3px}\n" +
      ".pf-particle-step em{display:block;font-style:normal;font-size:.72em;color:var(--muted);margin-top:2px}\n" +
      ".pf-step-title{font-weight:700;font-size:.75em;text-align:center;margin-bottom:6px;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;font-family:var(--font-mono)}\n" +
      ".pf-select-img img{display:block;width:100%;max-height:230px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2);margin-top:8px}\n" +
      ".pf-classes{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:10px}\n" +
      ".pf-class{margin:0;padding:9px;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm);text-align:center;transition:border-color .15s ease}\n" +
      ".pf-class:hover{border-color:var(--line-2)}\n" +
      ".pf-class.selected{border-color:var(--particle);box-shadow:inset 0 0 0 1px var(--particle)}\n" +
      ".pf-class img{display:block;width:100%;height:110px;object-fit:contain;background:var(--bg-2);border-radius:3px}\n" +
      ".pf-class figcaption{font-size:.66em;color:var(--muted);margin-top:5px}\n" +
      ".pf-class b{display:block;font-size:.88em;font-weight:700;color:var(--text);margin-top:2px;font-family:var(--font-mono)}\n" +
      ".pf-class span{display:block;font-size:.66em;color:var(--muted)}\n" +
      ".pf-final-img img{display:block;width:280px;max-width:100%;height:220px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2);margin:10px auto}\n" +
      ".cards{padding:16px;display:grid;gap:16px}\n" +
      ".job-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;border:1px solid var(--line);border-left:4px solid var(--jc,var(--muted-2));border-radius:var(--radius-lg);background:var(--panel);padding:16px 18px;position:relative;scroll-margin-top:24px;transition:border-color .18s ease,box-shadow .2s ease}\n" +
      ".job-card:hover{border-color:var(--line-2)}\n" +
      ".job-card.micrograph{--jc:var(--micro)}\n" +
      ".job-card.particle{--jc:var(--particle)}\n" +
      ".job-card.volume{--jc:var(--volume)}\n" +
      ".job-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:2px}\n" +
      ".job-head h2{margin:0;min-width:0;font-size:1.06em;font-weight:700;line-height:1.3;color:var(--text);letter-spacing:-.01em;font-family:var(--font-mono)}\n" +
      ".metrics{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}\n" +
      ".chip{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;border:1px solid var(--small-border);background:var(--small-bg);font-size:.72em;font-weight:600;white-space:nowrap;color:var(--text-2);font-family:var(--font-mono);letter-spacing:.01em}\n" +
      ".chip.micrograph{background:var(--micro-bg);border-color:var(--micro-border);color:var(--micro)}\n" +
      ".chip.particle{background:var(--particle-bg);border-color:var(--particle-border);color:var(--particle)}\n" +
      ".chip.volume,.chip.class{background:var(--volume-bg);border-color:var(--volume-border);color:var(--volume)}\n" +
      ".chip.aux{background:var(--small-bg);border-color:var(--small-border);color:var(--muted)}\n" +
      sectionCss +
      "h3{margin:0 0 8px;font-size:.7em;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.09em}\n" +
      ".source-table{width:100%;border-collapse:collapse;font-size:.84em;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--line)}\n" +
      ".source-table th,.source-table td{border-bottom:1px solid var(--line);padding:6px 10px;vertical-align:middle;text-align:left}\n" +
      ".source-table tr:last-child td{border-bottom:0}\n" +
      ".source-table th{background:var(--th-bg);color:var(--text-3);font-weight:700;font-size:.68em;text-transform:uppercase;letter-spacing:.07em}\n" +
      ".source-table tr:hover td{background:var(--row-hover)}\n" +
      ".kind-cell{width:56px;text-align:center;font-weight:700}\n" +
      ".kind-cell i{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:middle}\n" +
      ".kind-cell.exposure i{background:var(--micro)}\n" +
      ".kind-cell.particle i{background:var(--particle)}\n" +
      ".kind-cell.volume i{background:var(--volume)}\n" +
      ".kind-cell.template i,.kind-cell.other i{background:var(--muted-2)}\n" +
      ".source-table em{font-style:normal;color:var(--muted);margin-left:6px;font-size:.78em}\n" +
      ".up-cell{color:var(--text-2);line-height:1.55}\n" +
      ".up-route{display:block;font-weight:600;color:var(--text);border-bottom:1px solid var(--line-2);margin-bottom:5px;padding-bottom:4px;font-size:.84em;font-family:var(--font-mono)}\n" +
      ".up-list{display:grid;gap:4px}\n" +
      ".up-line{display:block;font-size:.84em;color:var(--text-3)}\n" +
      ".job-out{border-left:2px solid var(--line);padding-left:14px;color:var(--text-2)}\n" +
      ".job-out h3{white-space:nowrap}\n" +
      ".job-out div{margin:0 0 5px;padding:6px 10px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-sm);font-size:.84em;transition:border-color .15s ease}\n" +
      ".job-out div:hover{border-color:var(--line-2);background:var(--panel-3)}\n" +
      ".quiet{color:var(--muted);font-style:italic}\n" +
      ".class-toolbar{margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n" +
      ".class-toolbar span{font-weight:600;font-size:.84em;color:var(--text-2);margin-right:auto}\n" +
      ".classes{margin-top:8px;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:auto}\n" +
      "table{width:100%;border-collapse:collapse;font-size:.84em}\n" +
      "th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}\n" +
      "th{background:var(--th-bg);color:var(--text-3);font-weight:700;font-size:.68em;text-transform:uppercase;letter-spacing:.06em}\n" +
      "tr:hover td{background:var(--row-hover)}\n" +
      ".horizontal-table th:first-child{left:0;position:sticky;z-index:2;background:var(--th-bg)}\n" +
      ".horizontal-table td,.horizontal-table th{min-width:88px;text-align:center}\n" +
      ".download-head{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}\n" +
      ".download-head b{font-size:.84em}\n" +
      ".download-all{border:1px solid var(--btn-border);background:var(--btn-bg);color:var(--btn-text);border-radius:var(--radius-sm);padding:7px 16px;font-size:.76em;font-weight:700;cursor:pointer;font-family:var(--font-mono);letter-spacing:.02em;transition:background-color .15s ease,color .15s ease,transform .1s ease}\n" +
      ".download-all:hover{background:var(--btn-hover-bg)}\n" +
      ".download-all:active{transform:translateY(1px)}\n" +
      ".download-links{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}\n" +
      ".download-links a{padding:5px 12px;border:1px solid var(--line-2);border-radius:999px;font-size:.72em;font-weight:600;color:var(--text-2);font-family:var(--font-mono);text-decoration:none;transition:border-color .15s ease,color .15s ease}\n" +
      ".download-links a:hover{border-color:var(--link);color:var(--link);text-decoration:none}\n" +
      ".imgs{display:flex;gap:12px;flex-wrap:wrap}\n" +
      ".imgs-c{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:10px}\n" +
      ".cls-sec{margin-top:8px}\n" +
      ".cls-head{display:flex;align-items:center;gap:8px;margin:2px 0 6px;font-size:.66em;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em}\n" +
      ".cls-head .cnt{margin-left:auto;font-weight:500;color:var(--muted);font-family:var(--font-mono);font-size:1em}\n" +
      ".imgbox{flex:1 1 240px;min-width:200px;max-width:480px;margin:0;padding:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);transition:border-color .15s ease}\n" +
      ".imgbox:hover{border-color:var(--line-2)}\n" +
      ".imgbox img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius-sm)}\n" +
      ".imgbox figcaption{margin-top:6px;font-size:.72em;color:var(--muted);font-weight:500;font-family:var(--font-mono);display:flex;gap:6px;align-items:baseline;justify-content:space-between}\n" +
      ".imgbox.sm{padding:6px;border-radius:var(--radius-sm)}\n" +
      ".imgbox.sm img{border-radius:3px}\n" +
      ".imgbox.sm figcaption{margin-top:4px;font-size:.66em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}\n" +
      ".class-preview,.map-preview{max-width:130px;max-height:96px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2)}\n" +
      ".map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:10px}\n" +
      ".map-cell{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);padding:9px;text-align:center;transition:border-color .15s ease,transform .15s ease}\n" +
      ".map-cell:hover{border-color:var(--line-2)}\n" +
      ".map-cell-img{display:flex;align-items:center;justify-content:center;height:130px;background:var(--bg-2);border-radius:var(--radius-sm);overflow:hidden}\n" +
      ".map-cell-img .map-preview{max-width:100%;max-height:130px;width:auto;height:auto}\n" +
      ".map-cell-none{display:flex;align-items:center;justify-content:center;height:130px;background:var(--bg-2);border-radius:var(--radius-sm);color:var(--muted);font-size:.68em}\n" +
      ".map-cell-name{margin-top:6px;font-size:.7em;color:var(--text-2);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n" +
      ".map-dl{display:inline-block;margin-top:4px;font-size:.7em;font-weight:700;color:var(--link);text-decoration:underline}\n" +
      ".map-dl:hover{color:var(--link-hover)}\n" +
      ".img-gone{display:none!important}\n" +
      ".imgs-block.block-gone{display:none!important}\n" +
      "@media(max-width:1180px){.workspace{grid-template-columns:1fr;width:100%}.flow-pane{position:relative;top:auto;max-height:none}.job-card{grid-template-columns:minmax(0,1fr)}.metrics{margin-left:0}}\n" +
      "@media print{header{position:static}.workspace{grid-template-columns:1fr;padding:0}.flow-pane{position:relative;top:auto;max-height:none;overflow:visible}.download-all,.download-links{display:none}a{color:inherit}}\n" +
      (spec.extra ? `${spec.extra}\n` : "")
    );
  }
