// LIGA Vídeo — editor de lances no celular (modos Manual e Fixo, sem tracking).
// Lê o vídeo, recorta e grava os MP4 no próprio aparelho (WebCodecs + mediabunny). Nada vai para servidor.
(() => {
  const CFG = window.LIGA_CONFIG;
  const VCFG = CFG.video || {};
  const formatos = (VCFG.formatos && VCFG.formatos.length) ? VCFG.formatos
    : [{ id: "REELS", largura: 1080, altura: 1920, marcado_por_padrao: true }, { id: "FEED", largura: 1080, altura: 1350 }];
  const BITRATE = lerBitrate(VCFG.bitrate_celular || "12M");
  const $ = U.$;
  const fmtPorId = (id) => formatos.find((f) => f.id === id);

  let MB = null;                       // mediabunny (carregado quando abre o 1º vídeo)
  let arquivo = null, urlVideo = null;
  let info = null;                     // { largura, altura, fps, duracao, chave }
  let lances = [], seq = 0, selId = null;
  let verFmt = formatos[0].id;
  let guias = localStorage.getItem("m.guias") === "1";
  let pend = { ini: null, fim: null };
  let tocandoLance = null;             // lance que está tocando (pausa no fim)
  let kfSel = null;
  let marcados = JSON.parse(localStorage.getItem("v.formatos") || "null") ||
    Object.fromEntries(formatos.map((f) => [f.id, f.marcado_por_padrao !== false]));

  const el = {};
  const sel = () => lances.find((l) => l.id === selId) || null;

  function lerBitrate(v) {
    const m = String(v).trim().match(/^([\d.]+)\s*([kKmM]?)$/);
    if (!m) return 12e6;
    return Number(m[1]) * (m[2].toLowerCase() === "m" ? 1e6 : m[2].toLowerCase() === "k" ? 1e3 : 1);
  }
  function fmtTempo(s, casas = 1) {
    if (s == null || !isFinite(s)) return "–";
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(casas).padStart(casas ? 3 + casas : 2, "0")}`;
  }

  /* ================================================================ abrir */
  async function carregarMB() {
    if (!MB) MB = await import("./mediabunny.min.mjs");
    return MB;
  }

  async function abrirArquivo(file) {
    LIGA.progresso(0.1, "Lendo o vídeo…");
    try {
      await carregarMB();
      const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(file) });
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error("o arquivo não tem vídeo");
      if (!(await vt.canDecode())) throw new Error(`o navegador não consegue ler este vídeo (${vt.codec || "codec desconhecido"})`);
      const stats = await vt.computePacketStats(200);
      const duracao = await input.computeDuration();
      const at = await input.getPrimaryAudioTrack();
      info = {
        largura: vt.displayWidth, altura: vt.displayHeight, fps: stats.averagePacketRate || 30, duracao,
        codec: vt.codec, audio: at ? at.codec : null, chave: `v.lances:${file.name}:${file.size}`,
      };
      input.dispose?.();
    } catch (e) {
      LIGA.progresso(null);
      U.toast("Não consegui abrir: " + e.message, "erro");
      return;
    }
    arquivo = file;
    if (urlVideo) URL.revokeObjectURL(urlVideo);
    urlVideo = URL.createObjectURL(file);
    el.player.src = urlVideo;
    el.palco.style.aspectRatio = `${info.largura} / ${info.altura}`;
    el.scrub.max = info.duracao;
    $("#v-arquivo").textContent = `${file.name} · ${info.largura}×${info.altura} · ${Math.round(info.fps)} fps · ${fmtTempo(info.duracao, 0)}`;
    $("#v-abrir-lab").firstChild.textContent = "Trocar vídeo";
    $("#v-vazio").hidden = true;
    $("#v-editor").hidden = false;
    carregarLances();
    pend = { ini: null, fim: null };
    LIGA.progresso(null);
    renderTudo();
  }

  /* ================================================================ lances (guardados no celular por arquivo) */
  function carregarLances() {
    try { lances = JSON.parse(localStorage.getItem(info.chave) || "[]"); } catch { lances = []; }
    seq = lances.reduce((m, l) => Math.max(m, l.id), 0);
    selId = lances[0]?.id ?? null;
    kfSel = null;
  }
  function salvar() { if (info) localStorage.setItem(info.chave, JSON.stringify(lances)); }

  function novoLance(ini, fim) {
    const anterior = sel();
    const l = {
      id: ++seq, inicio: ini, fim: Math.min(fim, info.duracao), modo: "manual",
      crop: anterior ? { ...anterior.crop } : U.cropPadrao(), keyframes: [], soCompilado: false,
    };
    lances.push(l);
    selId = l.id;
    salvar();
    return l;
  }

  function numeracao() {
    const nums = new Map();
    let n = 0;
    for (const l of lances) if (!l.soCompilado) nums.set(l.id, ++n);
    return { nums, total: n };
  }

  function renderLances() {
    const { nums } = numeracao();
    const frag = document.createDocumentFragment();
    lances.forEach((l, i) => {
      const c = document.createElement("div");
      c.className = "cartao v-lance" + (l.id === selId ? " ativo" : "");
      const topo = document.createElement("div");
      topo.className = "cartao-topo";
      const pos = document.createElement("span"); pos.className = "pos";
      pos.textContent = l.soCompilado ? "C" : nums.get(l.id);
      const txt = document.createElement("span"); txt.className = "nome";
      txt.textContent = `${fmtTempo(l.inicio)} → ${fmtTempo(l.fim)} · ${(l.fim - l.inicio).toFixed(1)}s · ` +
        (l.modo === "fixo" ? "fixo" : `${(l.keyframes || []).length} ◆`) + (l.soCompilado ? " · só compilado" : "");
      const b = (t, fn, dis) => { const x = document.createElement("button"); x.textContent = t; x.disabled = !!dis; x.onclick = (e) => { e.stopPropagation(); fn(); }; return x; };
      topo.append(pos, txt,
        b("↑", () => mover(i, -1), i === 0),
        b("↓", () => mover(i, 1), i === lances.length - 1),
        b("✕", () => { if (confirm("Apagar este lance?")) { lances.splice(i, 1); if (selId === l.id) selId = lances[0]?.id ?? null; salvar(); renderTudo(); } }));
      c.appendChild(topo);
      c.onclick = () => { selId = l.id; kfSel = null; irPara(l.inicio); renderTudo(); };
      frag.appendChild(c);
    });
    el.lances.replaceChildren(frag);
    const { total } = numeracao();
    const fs = formatos.filter((f) => marcados[f.id]);
    el.contagem.textContent = lances.length
      ? `${total} lance(s) · ${fs.map((f) => f.id).join(" + ") || "nenhum formato"}` + ($("#v-compilado").checked ? " · + compilado" : "")
      : "";
    el.exportar.disabled = !lances.length;
  }

  function mover(i, d) {
    const j = i + d;
    if (j < 0 || j >= lances.length) return;
    [lances[i], lances[j]] = [lances[j], lances[i]];
    salvar(); renderTudo();
  }

  function renderTudo() { renderLances(); atualizarEnq(); atualizarMarcar(); desenhar(); }

  /* ================================================================ player */
  function irPara(t) {
    if (!info) return;
    el.player.currentTime = U.clamp(t, 0, info.duracao - 0.001);
  }
  function alternarPlay() {
    if (el.player.paused) { tocandoLance = null; el.player.play().catch(() => {}); } else el.player.pause();
  }
  function tocarLance(l) {
    tocandoLance = l;
    irPara(l.inicio);
    el.player.play().catch(() => {});
  }
  function aoTempo() {
    const t = el.player.currentTime;
    if (tocandoLance && t >= tocandoLance.fim) { el.player.pause(); el.player.currentTime = tocandoLance.fim; tocandoLance = null; }
    el.tempo.textContent = fmtTempo(t, 2);
    if (document.activeElement !== el.scrub) el.scrub.value = t;
    desenhar();
  }
  function loopVideo() {
    aoTempo();
    if (!el.player.paused) {
      if (el.player.requestVideoFrameCallback) el.player.requestVideoFrameCallback(loopVideo);
      else requestAnimationFrame(loopVideo);
    }
  }

  function atualizarMarcar() {
    const p = [];
    if (pend.ini != null) p.push("início " + fmtTempo(pend.ini));
    if (pend.fim != null) p.push("fim " + fmtTempo(pend.fim));
    el.pend.textContent = p.join(" · ");
    el.add.disabled = !(pend.ini != null && pend.fim != null && pend.fim > pend.ini);
  }

  /* ================================================================ caminho (keyframes → posição da caixa) */
  function janelaFmt(f, zoom) {
    const aOut = f.largura / f.altura, W = info.largura, H = info.altura;
    if (W / H > aOut) return { jw: (H * aOut / W) / zoom, jh: 1 / zoom };
    return { jw: 1 / zoom, jh: (W / aOut / H) / zoom };
  }

  // Curva suave que passa pelos keyframes sem passar do ponto (Hermite monotônica) — igual ao Mac
  function interpolarKF(pts, n) {
    const out = new Float64Array(n);
    if (pts.length === 1) return out.fill(pts[0][1]);
    const m = pts.length, d = [], tg = new Array(m).fill(0);
    for (let k = 0; k < m - 1; k++) d.push((pts[k + 1][1] - pts[k][1]) / Math.max(1e-6, pts[k + 1][0] - pts[k][0]));
    for (let k = 1; k < m - 1; k++) tg[k] = d[k - 1] * d[k] <= 0 ? 0 : 2 / (1 / d[k - 1] + 1 / d[k]);
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (i <= pts[0][0]) { out[i] = pts[0][1]; continue; }
      if (i >= pts[m - 1][0]) { out[i] = pts[m - 1][1]; continue; }
      while (i > pts[k + 1][0]) k++;
      const [t0, v0] = pts[k], [t1, v1] = pts[k + 1], h = t1 - t0, u = (i - t0) / h;
      out[i] = (2 * u ** 3 - 3 * u ** 2 + 1) * v0 + (u ** 3 - 2 * u ** 2 + u) * h * tg[k] +
               (-2 * u ** 3 + 3 * u ** 2) * v1 + (u ** 3 - u ** 2) * h * tg[k + 1];
    }
    return out;
  }

  const memo = new Map();
  function caminho(l, fmtId) {
    const dur = l.fim - l.inicio;
    const kfs = (l.keyframes || []).filter((k) => k.t >= -0.01 && k.t <= dur + 0.01);
    const ass = [l.inicio, l.fim, l.crop.zoom, l.crop.cx, l.crop.cy, JSON.stringify(kfs)].join("|");
    const ch = l.id + ":" + fmtId, m = memo.get(ch);
    if (m && m.ass === ass) return m.c;
    const fps = info.fps, n = Math.max(2, Math.round(dur * fps) + 1);
    const { jw, jh } = janelaFmt(fmtPorId(fmtId), Math.max(1, l.crop.zoom));
    let cx, cy;
    if (kfs.length) {
      const ord = [...kfs].sort((a, b) => a.t - b.t), qs = ord.map((k) => Math.round(k.t * fps));
      cx = interpolarKF(ord.map((k, i) => [qs[i], k.cx]), n);
      cy = interpolarKF(ord.map((k, i) => [qs[i], k.cy]), n);
    } else {
      cx = new Float64Array(n).fill(l.crop.cx ?? 0.5);
      cy = new Float64Array(n).fill(l.crop.cy ?? 0.5);
    }
    for (let i = 0; i < n; i++) {
      cx[i] = jw >= 1 ? 0.5 : U.clamp(cx[i], jw / 2, 1 - jw / 2);
      cy[i] = jh >= 1 ? 0.5 : U.clamp(cy[i], jh / 2, 1 - jh / 2);
    }
    const c = { cx, cy, jw, jh, fps, n };
    memo.set(ch, { ass, c });
    return c;
  }
  const indice = (l, c, t) => U.clamp(Math.round((t - l.inicio) * c.fps), 0, c.n - 1);

  // Janela (px do vídeo original) de um lance num instante
  function janelaNoTempo(l, fmtId, t) {
    const f = fmtPorId(fmtId);
    if (l.modo === "fixo") return U.retanguloCrop(info.largura, info.altura, f.largura, f.altura, l.crop);
    const c = caminho(l, fmtId), i = indice(l, c, t);
    const w = c.jw * info.largura, h = c.jh * info.altura;
    return { x: c.cx[i] * info.largura - w / 2, y: c.cy[i] * info.altura - h / 2, w, h };
  }

  /* ================================================================ keyframes */
  function kfPerto(l, t, raio) {
    let melhor = null, md = raio;
    for (const k of l.keyframes || []) { const d = Math.abs(k.t - t); if (d <= md) { melhor = k; md = d; } }
    return melhor;
  }
  function kfAqui(l) {
    const t = el.player.currentTime - l.inicio;
    if (t < -0.01 || t > l.fim - l.inicio + 0.01) { U.toast("Vá para um instante dentro do lance (toque no lance ou use a linha do lance).", "erro"); return null; }
    l.keyframes = l.keyframes || [];
    let k = kfPerto(l, t, 3 / info.fps);
    if (!k) {
      const c = caminho(l, verFmt), i = indice(l, c, el.player.currentTime);
      k = { t: U.clamp(t, 0, l.fim - l.inicio), cx: c.cx[i], cy: c.cy[i] };
      l.keyframes.push(k);
      l.keyframes.sort((a, b) => a.t - b.t);
    }
    kfSel = k;
    return k;
  }
  function removerKF(l) {
    if (!l.keyframes?.length) return;
    const alvo = kfSel && l.keyframes.includes(kfSel) ? kfSel : kfPerto(l, el.player.currentTime - l.inicio, 0.5);
    if (!alvo) { U.toast("Nenhum ◆ selecionado ou perto do instante atual."); return; }
    l.keyframes = l.keyframes.filter((k) => k !== alvo);
    kfSel = null;
    salvar(); renderTudo();
  }

  /* ================================================================ painel do lance */
  function atualizarEnq() {
    const l = sel();
    el.enq.hidden = !l;
    if (!l) return;
    const { nums } = numeracao();
    $("#v-enq-titulo").textContent = l.soCompilado ? "Lance (só compilado)" : `Lance ${nums.get(l.id)}`;
    $("#v-modo").value = l.modo;
    el.zoom.value = l.crop.zoom;
    $("#v-zoom-valor").textContent = l.crop.zoom.toFixed(2) + "×";
    $("#v-so-comp").checked = !!l.soCompilado;
    const movel = l.modo !== "fixo";
    el.tl.hidden = !movel;
    for (const id of ["#v-kf-add", "#v-kf-del", "#v-kf-limpar"]) $(id).hidden = !movel;
    $("#v-centralizar").hidden = movel;
    $("#v-kf-status").textContent = movel
      ? `${(l.keyframes || []).length} keyframe(s). Pause e arraste a caixa no vídeo para criar um ◆. Entre os ◆ a câmera vai suave; antes do 1º e depois do último fica parada.`
      : "Fixo: arraste a caixa no vídeo. O mesmo enquadramento vale o lance todo.";
  }

  /* ================================================================ desenho: caixa sobre o vídeo + linha do lance */
  function areaVideo() {
    const W = el.palco.clientWidth, H = el.palco.clientHeight, A = info.largura / info.altura;
    let w = W, h = W / A;
    if (h > H) { h = H; w = H * A; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, W, H };
  }

  let pedido = 0;
  function desenhar() { cancelAnimationFrame(pedido); pedido = requestAnimationFrame(desenharAgora); }
  function desenharAgora() {
    if (!info) return;
    desenharOverlay();
    desenharTL();
  }

  function ajustarCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }

  function desenharOverlay() {
    const { ctx, W, H } = ajustarCanvas(el.overlay);
    const l = sel();
    if (!l) return;
    const a = areaVideo(), s = a.w / info.largura, t = el.player.currentTime;
    const fora = t < l.inicio - 0.05 || t > l.fim + 0.05;
    for (const f of formatos) {
      if (f.id === verFmt) continue;
      const r = janelaNoTempo(l, f.id, t);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.setLineDash([5, 5]);
      ctx.strokeRect(a.x + r.x * s, a.y + r.y * s, r.w * s, r.h * s);
      ctx.restore();
    }
    const f = fmtPorId(verFmt), r = janelaNoTempo(l, f.id, t);
    const q = { x: a.x + r.x * s, y: a.y + r.y * s, w: r.w * s, h: r.h * s };
    ctx.fillStyle = fora ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, q.y); ctx.fillRect(0, q.y + q.h, W, H - q.y - q.h);
    ctx.fillRect(0, q.y, q.x, q.h); ctx.fillRect(q.x + q.w, q.y, W - q.x - q.w, q.h);
    ctx.strokeStyle = fora ? "rgba(61,139,253,0.5)" : "#3d8bfd"; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.strokeRect(q.x, q.y, q.w, q.h);
    if (guias) U.desenharGuias(ctx, q.x, q.y, q.w, q.h, f, true);
    ctx.fillStyle = "#3d8bfd"; ctx.font = "700 11px -apple-system, sans-serif";
    ctx.fillText(f.id, q.x + 4, q.y + 13);
    if (fora) {
      ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.font = "600 11px -apple-system, sans-serif";
      ctx.fillText("fora do lance selecionado", a.x + 6, a.y + a.h - 8);
    }
  }

  function desenharTL() {
    const l = sel();
    if (!l || el.tl.hidden) return;
    const { ctx, W, H } = ajustarCanvas(el.tl);
    const m = 10, dur = l.fim - l.inicio, X = (t) => m + (t / dur) * (W - 2 * m);
    ctx.fillStyle = "#24272b"; ctx.fillRect(m, H / 2 - 4, W - 2 * m, 8);
    for (const k of l.keyframes || []) {
      const x = X(k.t), y = H / 2, r = 8;
      ctx.fillStyle = k === kfSel ? "#ffd60a" : "#3d8bfd";
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    }
    const t = el.player.currentTime - l.inicio;
    if (t >= -0.01 && t <= dur + 0.01) {
      ctx.fillStyle = "#fff"; ctx.fillRect(X(U.clamp(t, 0, dur)) - 1, 4, 2, H - 8);
    }
  }

  function configurarTL() {
    const cv = el.tl;
    const tempoDe = (e) => {
      const l = sel(), b = cv.getBoundingClientRect(), m = 10;
      return U.clamp((e.clientX - b.left - m) / (b.width - 2 * m), 0, 1) * (l.fim - l.inicio);
    };
    cv.addEventListener("pointerdown", (e) => {
      const l = sel();
      if (!l) return;
      cv.setPointerCapture(e.pointerId);
      el.player.pause();
      const t0 = tempoDe(e);
      const k = kfPerto(l, t0, (l.fim - l.inicio) * 0.04);
      kfSel = k || null;
      irPara(l.inicio + (k ? k.t : t0));
      const mover_ = (ev) => { irPara(l.inicio + tempoDe(ev)); kfSel = kfPerto(l, tempoDe(ev), 1.5 / info.fps); };
      const soltar = () => { cv.removeEventListener("pointermove", mover_); cv.removeEventListener("pointerup", soltar); desenhar(); };
      cv.addEventListener("pointermove", mover_);
      cv.addEventListener("pointerup", soltar);
      desenhar();
    });
  }

  // Arrastar a caixa: Manual cria/edita o ◆ do instante; Fixo move o enquadramento
  function configurarArraste() {
    const cv = el.overlay;
    cv.addEventListener("pointerdown", (e) => {
      const l = sel();
      if (!info || !l) { alternarPlay(); return; }
      cv.setPointerCapture(e.pointerId);
      let ux = e.clientX, uy = e.clientY, moveu = false, kf = null;
      const movel = l.modo !== "fixo";
      const mover_ = (ev) => {
        const a = areaVideo(), s = a.w / info.largura;
        const dx = ev.clientX - ux, dy = ev.clientY - uy;
        if (!moveu && Math.abs(dx) + Math.abs(dy) <= 4) return;
        if (!moveu && movel) {
          el.player.pause();
          kf = kfAqui(l);
          if (!kf) { soltar(true); return; }
        }
        moveu = true;
        if (movel) {
          const { jw, jh } = janelaFmt(fmtPorId(verFmt), Math.max(1, l.crop.zoom));
          kf.cx = U.clamp(kf.cx + dx / (s * info.largura), Math.min(0.5, jw / 2), Math.max(0.5, 1 - jw / 2));
          kf.cy = U.clamp(kf.cy + dy / (s * info.altura), Math.min(0.5, jh / 2), Math.max(0.5, 1 - jh / 2));
        } else {
          const f = fmtPorId(verFmt);
          l.crop.cx += dx / (s * info.largura);
          l.crop.cy += dy / (s * info.altura);
          U.prenderCrop(info.largura, info.altura, f.largura, f.altura, l.crop);
        }
        ux = ev.clientX; uy = ev.clientY;
        desenhar();
      };
      const soltar = (cancelado) => {
        cv.removeEventListener("pointermove", mover_);
        cv.removeEventListener("pointerup", soltar);
        cv.removeEventListener("pointercancel", soltar);
        if (cancelado === true) return;
        if (moveu) { salvar(); renderLances(); atualizarEnq(); } else alternarPlay();
      };
      cv.addEventListener("pointermove", mover_);
      cv.addEventListener("pointerup", soltar);
      cv.addEventListener("pointercancel", soltar);
    });
  }

  /* ================================================================ prévia do corte */
  const Previa = (() => {
    const cv = $("#v-prev-canvas");
    let lance = null, fmtId = null, ativo = false;
    function abrir() {
      lance = sel();
      if (!lance) return;
      fmtId = verFmt;
      ativo = true;
      $("#v-prev").hidden = false;
      document.body.style.overflow = "hidden";
      $("#v-prev-titulo").textContent = `${fmtTempo(lance.inicio)} → ${fmtTempo(lance.fim)}`;
      botoes();
      tocandoLance = null;
      irPara(lance.inicio);
      el.player.play().catch(() => {});
      loop();
    }
    function botoes() {
      const c = $("#v-prev-formatos");
      c.replaceChildren();
      for (const f of formatos) {
        const b = document.createElement("button");
        b.textContent = f.id; b.className = f.id === fmtId ? "ativo" : "";
        b.onclick = () => { fmtId = f.id; botoes(); };
        c.appendChild(b);
      }
    }
    function loop() {
      if (!ativo) return;
      const v = el.player;
      if (v.currentTime >= lance.fim || v.ended) { irPara(lance.inicio); v.play().catch(() => {}); }
      desenharP();
      requestAnimationFrame(loop);
    }
    function desenharP() {
      const { ctx, W, H } = ajustarCanvas(cv);
      ctx.fillStyle = "#0b0c0d"; ctx.fillRect(0, 0, W, H);
      const v = el.player;
      if (!v.videoWidth) return;
      const f = fmtPorId(fmtId), A = f.largura / f.altura, m = 12;
      let qh = H - 2 * m, qw = qh * A;
      if (qw > W - 2 * m) { qw = W - 2 * m; qh = qw / A; }
      const q = { x: (W - qw) / 2, y: (H - qh) / 2, w: qw, h: qh };
      const r = janelaNoTempo(lance, f.id, v.currentTime), k = v.videoWidth / info.largura;
      ctx.drawImage(v, r.x * k, r.y * k, r.w * k, r.h * k, q.x, q.y, q.w, q.h);
      if (guias) U.desenharGuias(ctx, q.x, q.y, q.w, q.h, f);
    }
    function fechar() {
      ativo = false;
      el.player.pause();
      $("#v-prev").hidden = true;
      document.body.style.overflow = "";
      desenhar();
    }
    $("#v-prev-fechar").onclick = fechar;
    return { abrir };
  })();

  /* ================================================================ exportar (no próprio celular) */
  class Cancelado extends Error {}

  async function exportar() {
    if (!info || !lances.length) return;
    const c = LIGA.campos();
    if (!c.ok) { U.toast(c.erro, "erro"); return; }
    const fmts = formatos.filter((f) => marcados[f.id]);
    if (!fmts.length) { U.toast("Marque pelo menos um formato (REELS/FEED).", "erro"); return; }
    const comp = $("#v-compilado").checked;
    const { nums } = numeracao();
    if (!comp && lances.every((l) => l.soCompilado)) { U.toast("Todos os lances estão como \"só no compilado\": ligue o Compilado.", "erro"); return; }
    if (!comp && lances.some((l) => l.soCompilado)) U.toast("Lances \"só no compilado\" ficam de fora (Compilado desligado).");
    el.player.pause();

    let cancelar = false;
    const abertas = [];
    const pastaNome = `${c.atleta}_${c.data}`;
    const nome = (n, f) => U.montarNome(CFG.nome.template, { N: n, FORMATO: f.id, ATLETA: c.atleta, DATA: c.data }, c.padding) + ".mp4";
    const porFormato = Object.fromEntries(fmts.map((f) => [f.id, []]));
    const compilados = {};
    const inicio = performance.now();
    LIGA.progresso(0, "Preparando…", () => { cancelar = true; });

    let input = null;
    try {
      await carregarMB();
      const codec = (await MB.canEncodeVideo("avc", { width: 1080, height: 1920, bitrate: BITRATE })) ? "avc"
        : (await MB.canEncodeVideo("hevc", { width: 1080, height: 1920, bitrate: BITRATE })) ? "hevc" : null;
      if (!codec) throw new Error("este navegador não consegue gravar vídeo (precisa de iOS 17 ou mais novo)");
      input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(arquivo) });
      const vt = await input.getPrimaryVideoTrack();
      const at = await input.getPrimaryAudioTrack();
      const formatoSaida = new MB.Mp4OutputFormat({ fastStart: "in-memory" });
      const audioOk = !!at && formatoSaida.getSupportedAudioCodecs().includes(at.codec);
      if (at && !audioOk) U.toast(`O áudio deste vídeo (${at.codec}) não dá para copiar; os vídeos vão sem som.`, "erro");
      const audioCfg = audioOk ? await at.getDecoderConfig() : null;
      const amostras = new MB.VideoSampleSink(vt);
      const pacotesAudio = audioOk ? new MB.EncodedPacketSink(at) : null;

      // um canvas por formato (o quadro recortado é desenhado nele e vai para o codificador)
      const telas = {};
      for (const f of fmts) {
        const cv = document.createElement("canvas");
        cv.width = f.largura; cv.height = f.altura;
        const ctx = cv.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        telas[f.id] = { cv, ctx };
      }
      async function novaSaida(f) {
        const out = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
        const src = new MB.CanvasSource(telas[f.id].cv, { codec, bitrate: BITRATE, keyFrameInterval: 1 });
        out.addVideoTrack(src, { frameRate: Math.round(info.fps) });
        let asrc = null;
        if (audioOk) { asrc = new MB.EncodedAudioPacketSource(at.codec); out.addAudioTrack(asrc); }
        await out.start();
        const s = { out, src, asrc, primeiroAudio: true };
        abertas.push(s);
        return s;
      }
      async function addAudio(s, pkt, ts) {
        if (!s.asrc) return;
        await s.asrc.add(pkt.clone({ timestamp: ts }), s.primeiroAudio ? { decoderConfig: audioCfg } : undefined);
        s.primeiroAudio = false;
      }
      async function fechar(s) {
        await s.out.finalize();
        abertas.splice(abertas.indexOf(s), 1);
        return new Blob([s.out.target.buffer], { type: "video/mp4" });
      }

      const lista = comp ? lances : lances.filter((l) => !l.soCompilado);
      const totalQ = lista.reduce((s, l) => s + (l.fim - l.inicio) * info.fps, 0);
      let feitos = 0;
      const saidasComp = {};
      if (comp) for (const f of fmts) saidasComp[f.id] = await novaSaida(f);
      let deslocamento = 0;

      for (const [li, l] of lista.entries()) {
        const individual = !l.soCompilado;
        const saidas = {};
        if (individual) for (const f of fmts) saidas[f.id] = await novaSaida(f);
        let base = null, ultimo = 0;
        let pkt = pacotesAudio ? await pacotesAudio.getPacket(l.inicio) : null;
        const empurrarAudio = async (ate) => {
          while (pkt && pkt.timestamp - base < ate - 1e-4) {
            const rel = pkt.timestamp - base;
            if (rel >= -1e-4) {
              const r = Math.max(0, rel);
              for (const f of fmts) {
                if (individual) await addAudio(saidas[f.id], pkt, r);
                if (comp) await addAudio(saidasComp[f.id], pkt, deslocamento + r);
              }
            }
            pkt = await pacotesAudio.getNextPacket(pkt);
          }
        };
        for await (const am of amostras.samples(l.inicio, l.fim)) {
          try {
            if (cancelar) throw new Cancelado();
            if (base == null) base = am.timestamp;
            const t = am.timestamp - base;
            const d = am.duration > 0 ? am.duration : 1 / info.fps;
            for (const f of fmts) {
              const { ctx } = telas[f.id];
              const r = janelaNoTempo(l, f.id, am.timestamp);
              am.draw(ctx, r.x, r.y, r.w, r.h, 0, 0, f.largura, f.altura);
              if (individual) await saidas[f.id].src.add(t, d);
              if (comp) await saidasComp[f.id].src.add(deslocamento + t, d);
            }
            ultimo = t + d;
            if (pacotesAudio) await empurrarAudio(ultimo);
          } finally { am.close(); }
          feitos++;
          if (feitos % 5 === 0) {
            const fr = feitos / totalQ, seg = (performance.now() - inicio) / 1000;
            const resta = fr > 0.03 ? ` · falta ~${Math.max(1, Math.round(seg / fr - seg))}s` : "";
            LIGA.progresso(Math.min(0.99, fr), `Lance ${li + 1}/${lista.length}${resta}`, () => { cancelar = true; });
          }
        }
        if (base == null) continue;  // lance sem quadros (fora do vídeo)
        if (pacotesAudio) await empurrarAudio(ultimo);
        if (individual) {
          for (const f of fmts) {
            const n = nums.get(l.id);
            porFormato[f.id].push({ nome: nome(n, f), blob: await fechar(saidas[f.id]) });
          }
        }
        deslocamento += ultimo;
      }
      if (comp) {
        LIGA.progresso(0.995, "Fechando o compilado…");
        for (const f of fmts) compilados[f.id] = { nome: nome("COMPILADO", f), blob: await fechar(saidasComp[f.id]) };
      }
    } catch (e) {
      for (const s of abertas.splice(0)) Promise.resolve().then(() => s.out.cancel()).catch(() => {});
      LIGA.progresso(null);
      if (e instanceof Cancelado) U.toast("Exportação cancelada.");
      else { console.error(e); U.toast("Erro ao exportar: " + (e.message || e), "erro"); }
      return;
    } finally {
      input?.dispose?.();
    }
    LIGA.progresso(null);

    const grupos = [], zip = [];
    for (const f of fmts) {
      const itens = porFormato[f.id];
      if (itens.length) grupos.push({ rotulo: f.id, itens, tipo: "video/mp4", texto: `Salvar ${itens.length} ${f.id}` });
      if (compilados[f.id]) grupos.push({ rotulo: "COMPILADO_" + f.id, itens: [compilados[f.id]], tipo: "video/mp4", texto: `Salvar compilado ${f.id}` });
      for (const x of itens) zip.push({ nome: `${pastaNome}/VIDEO/${f.id}/${x.nome}`, blob: x.blob });
      if (compilados[f.id]) zip.push({ nome: `${pastaNome}/VIDEO/${f.id}/${compilados[f.id].nome}`, blob: compilados[f.id].blob });
    }
    const seg = Math.round((performance.now() - inicio) / 1000);
    LIGA.telaSalvar({
      titulo: `Vídeos prontos (${seg}s)`, grupos, zip, zipNome: `${pastaNome}_VIDEO.zip`, pasta: pastaNome,
      dica: 'Toque em cada botão e escolha <b>"Salvar Vídeo"</b> (vai para a galeria) ou <b>"Salvar em Arquivos"</b> (mantém os nomes).',
    });
  }

  /* ================================================================ init */
  function init() {
    for (const id of ["player", "overlay", "palco", "scrub", "tempo", "pend", "add", "enq", "zoom", "tl", "lances", "contagem", "exportar"])
      el[id] = $("#v-" + id);

    $("#v-input").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) abrirArquivo(f); };
    const v = el.player;
    v.addEventListener("play", () => { el.play.textContent = "❚❚"; loopVideo(); });
    v.addEventListener("pause", () => { el.play.textContent = "▶︎"; aoTempo(); });
    v.addEventListener("seeked", aoTempo);
    v.addEventListener("loadedmetadata", aoTempo);
    el.play = $("#v-play");
    el.play.onclick = alternarPlay;
    $("#v-menos5").onclick = () => irPara(v.currentTime - 5);
    $("#v-mais5").onclick = () => irPara(v.currentTime + 5);
    $("#v-menos1").onclick = () => { v.pause(); irPara(v.currentTime - 1 / info.fps); };
    $("#v-mais1").onclick = () => { v.pause(); irPara(v.currentTime + 1 / info.fps); };
    el.scrub.addEventListener("input", () => { tocandoLance = null; irPara(Number(el.scrub.value)); });

    $("#v-ini").onclick = () => { pend.ini = v.currentTime; if (pend.fim != null && pend.fim <= pend.ini) pend.fim = null; atualizarMarcar(); };
    $("#v-fim").onclick = () => { pend.fim = v.currentTime; if (pend.ini != null && pend.ini >= pend.fim) pend.ini = null; atualizarMarcar(); };
    el.add.onclick = () => {
      if (!(pend.ini != null && pend.fim > pend.ini)) return;
      novoLance(pend.ini, pend.fim);
      pend = { ini: null, fim: null };
      renderTudo();
    };

    const ver = $("#v-ver");
    const botoesVer = () => {
      ver.replaceChildren();
      for (const f of formatos) {
        const b = document.createElement("button");
        b.textContent = f.id; b.className = f.id === verFmt ? "ativo" : "";
        b.onclick = () => { verFmt = f.id; botoesVer(); desenhar(); };
        ver.appendChild(b);
      }
    };
    botoesVer();
    $("#v-guias").checked = guias;
    $("#v-guias").onchange = (e) => { guias = e.target.checked; localStorage.setItem("m.guias", guias ? "1" : "0"); desenhar(); };

    const saida = $("#v-saida-fmts");
    saida.append(Object.assign(document.createElement("span"), { className: "sutil", textContent: "Exportar:" }));
    for (const f of formatos) {
      const lab = document.createElement("label"); lab.className = "check";
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = !!marcados[f.id];
      chk.onchange = () => { marcados[f.id] = chk.checked; localStorage.setItem("v.formatos", JSON.stringify(marcados)); renderLances(); };
      lab.append(chk, `${f.id} ${f.largura}×${f.altura}`);
      saida.appendChild(lab);
    }
    $("#v-compilado").checked = localStorage.getItem("v.compilado") !== "0";
    $("#v-compilado").onchange = (e) => { localStorage.setItem("v.compilado", e.target.checked ? "1" : "0"); renderLances(); };

    $("#v-modo").onchange = (e) => { const l = sel(); if (!l) return; l.modo = e.target.value; salvar(); renderTudo(); };
    el.zoom.addEventListener("input", () => {
      const l = sel(); if (!l) return;
      l.crop.zoom = Number(el.zoom.value);
      const f = fmtPorId(verFmt);
      U.prenderCrop(info.largura, info.altura, f.largura, f.altura, l.crop);
      $("#v-zoom-valor").textContent = l.crop.zoom.toFixed(2) + "×";
      desenhar();
    });
    el.zoom.addEventListener("change", salvar);
    $("#v-centralizar").onclick = () => { const l = sel(); if (!l) return; l.crop = { ...U.cropPadrao(), zoom: l.crop.zoom }; salvar(); desenhar(); };
    $("#v-kf-add").onclick = () => { const l = sel(); if (!l) return; v.pause(); if (kfAqui(l)) { salvar(); renderTudo(); } };
    $("#v-kf-del").onclick = () => { const l = sel(); if (l) removerKF(l); };
    $("#v-kf-limpar").onclick = () => { const l = sel(); if (l && l.keyframes?.length && confirm("Apagar todos os keyframes deste lance?")) { l.keyframes = []; kfSel = null; salvar(); renderTudo(); } };
    $("#v-ini-agora").onclick = () => {
      const l = sel(); if (!l) return;
      const t = v.currentTime;
      if (t >= l.fim) { U.toast("O início precisa ser antes do fim do lance.", "erro"); return; }
      const d = l.inicio - t;  // mantém os keyframes no mesmo instante do vídeo
      (l.keyframes || []).forEach((k) => (k.t += d));
      l.keyframes = (l.keyframes || []).filter((k) => k.t >= 0);
      l.inicio = t; salvar(); renderTudo();
    };
    $("#v-fim-agora").onclick = () => {
      const l = sel(); if (!l) return;
      const t = v.currentTime;
      if (t <= l.inicio) { U.toast("O fim precisa ser depois do início do lance.", "erro"); return; }
      l.fim = t;
      l.keyframes = (l.keyframes || []).filter((k) => k.t <= l.fim - l.inicio);
      salvar(); renderTudo();
    };
    $("#v-so-comp").onchange = (e) => { const l = sel(); if (!l) return; l.soCompilado = e.target.checked; salvar(); renderTudo(); };
    $("#v-tocar").onclick = () => { const l = sel(); if (l) tocarLance(l); };
    $("#v-previa").onclick = () => Previa.abrir();
    el.exportar.onclick = exportar;

    configurarArraste();
    configurarTL();
    window.addEventListener("resize", desenhar);
    window.addEventListener("liga:aba", (e) => { if (e.detail !== "video") el.player.pause(); else desenhar(); });
  }
  init();
})();
