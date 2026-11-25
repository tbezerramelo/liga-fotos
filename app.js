// LIGA Fotos — versão para celular (iPhone). Tudo roda no próprio aparelho; nada é enviado para servidor.
(() => {
  const CFG = window.LIGA_CONFIG;
  const formatos = CFG.fotos.formatos;
  const qualidade = (CFG.fotos.qualidade_jpg || 95) / 100;
  const LADO_MINI = 600, LADO_EDITOR = 2000, ALT_PREVIA = 100;
  const $ = U.$;

  let lista = [];            // [{ id, file, nome, w, h, mini, formatos: { ID: { on, dividir, crop } } }]
  let seq = 0;
  let guias = localStorage.getItem("m.guias") === "1";
  let prontos = null;        // resultado do "Preparar": { porFormato: { ID: [File] }, todos: [{nome, blob}] }

  /* ------------------------------------------------------------ nome */
  function campos() {
    const atleta = U.normalizarAtleta($("#atleta").value);
    const data = U.normalizarData($("#data").value);
    const padding = Number($("#padding").value) || 1;
    if (!atleta) return { ok: false, erro: "Preencha o nome do atleta." };
    if (!data) return { ok: false, erro: "Data inválida. Use DD_MM_AAAA." };
    return { ok: true, atleta, data, padding };
  }
  const nomeArquivo = (c, fmt, n) =>
    U.montarNome(CFG.nome.template, { N: n, FORMATO: fmt.id, ATLETA: c.atleta, DATA: c.data }, c.padding) + ".jpg";
  function atualizarExemplo() {
    const a = U.normalizarAtleta($("#atleta").value) || "ATLETA";
    const d = U.normalizarData($("#data").value) || "DD_MM_AAAA";
    const pad = Number($("#padding").value) || 1;
    $("#exemplo").textContent = localStorage.getItem("m.aba") === "video"
      ? U.montarNome(CFG.nome.template, { N: 1, FORMATO: (CFG.video?.formatos?.[0]?.id || "REELS"), ATLETA: a, DATA: d }, pad) + ".mp4"
      : nomeArquivo({ atleta: a, data: d, padding: pad }, formatos[0], 1);
    $("#data").classList.toggle("invalido", !U.normalizarData($("#data").value));
  }

  /* ------------------------------------------------------------ recorte */
  const partesDe = (fmt, e) => (e.dividir && fmt.divisao_carrossel > 1 ? fmt.divisao_carrossel : 1);
  const dims = (fmt, e) => { const p = partesDe(fmt, e); return { w: fmt.largura * p, h: fmt.altura, partes: p }; };
  const recorte = (foto, fmt) => { const e = foto.formatos[fmt.id], d = dims(fmt, e); return U.retanguloCrop(foto.w, foto.h, d.w, d.h, e.crop); };

  function guiasPartes(ctx, x, y, w, h, fmt, partes, comGuias, fino) {
    const pw = w / partes;
    if (comGuias) for (let i = 0; i < partes; i++) U.desenharGuias(ctx, x + i * pw, y, pw, h, fmt, fino);
    if (partes > 1) {
      ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = fino ? 1 : 2; ctx.setLineDash([6, 5]);
      for (let i = 1; i < partes; i++) { ctx.beginPath(); ctx.moveTo(x + i * pw, y); ctx.lineTo(x + i * pw, y + h); ctx.stroke(); }
      ctx.restore();
    }
  }

  function numeracao() {
    const nums = new Map(), totais = {};
    for (const fmt of formatos) {
      let n = 0;
      for (const f of lista) {
        const e = f.formatos[fmt.id];
        if (!e.on) continue;
        if (!nums.has(f.id)) nums.set(f.id, {});
        nums.get(f.id)[fmt.id] = n + 1;
        n += partesDe(fmt, e);
      }
      totais[fmt.id] = n;
    }
    return { nums, totais };
  }

  const invalidar = () => { prontos = null; };

  /* ------------------------------------------------------------ adicionar */
  async function adicionar(arquivos) {
    const imgs = arquivos.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|heic)$/i.test(f.name));
    if (!imgs.length) return;
    const falhas = [];
    for (let i = 0; i < imgs.length; i++) {
      progresso(i / imgs.length, `Carregando ${i + 1}/${imgs.length}`);
      try {
        const { img, liberar } = await U.carregarImagem(imgs[i]);
        const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, LADO_MINI / Math.max(w, h));
        const mini = U.reduzirRegiao(img, 0, 0, w, h, Math.round(w * k), Math.round(h * k));
        liberar();
        const pf = {};
        for (const fmt of formatos) pf[fmt.id] = { on: !!fmt.marcado_por_padrao, dividir: false, crop: U.cropPadrao() };
        lista.push({ id: ++seq, file: imgs[i], nome: imgs[i].name, w, h, mini, formatos: pf });
      } catch { falhas.push(imgs[i].name); }
    }
    progresso(null);
    invalidar();
    render();
    if (falhas.length) U.toast(`Não consegui abrir ${falhas.length} foto(s).`, "erro");
  }

  /* ------------------------------------------------------------ lista */
  function render() {
    const { nums, totais } = numeracao();
    $("#vazio").hidden = lista.length > 0;
    $("#contagem").textContent = lista.length ? `${lista.length} foto(s) · ` + formatos.map((f) => `${totais[f.id]} ${f.id}`).join(" · ") : "";
    $("#btn-preparar").disabled = !lista.length;
    const frag = document.createDocumentFragment();
    lista.forEach((foto, i) => frag.appendChild(cartao(foto, i, nums.get(foto.id) || {})));
    $("#lista").replaceChildren(frag);
  }

  function cartao(foto, i, nums) {
    const c = document.createElement("div");
    c.className = "cartao";
    const topo = document.createElement("div");
    topo.className = "cartao-topo";
    const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = i + 1;
    const nome = document.createElement("span"); nome.className = "nome"; nome.textContent = foto.nome;
    const b = (txt, fn, dis) => { const x = document.createElement("button"); x.textContent = txt; x.disabled = !!dis; x.onclick = fn; return x; };
    topo.append(pos, nome,
      b("↑", () => mover(i, -1), i === 0),
      b("↓", () => mover(i, 1), i === lista.length - 1),
      b("✕", () => { if (confirm("Tirar esta foto da lista?")) { lista.splice(i, 1); invalidar(); render(); } }));
    c.appendChild(topo);

    const previas = document.createElement("div");
    previas.className = "previas";
    for (const fmt of formatos) {
      const e = foto.formatos[fmt.id], d = dims(fmt, e);
      const p = document.createElement("div");
      p.className = "previa" + (e.on ? "" : " desligada");
      const cv = document.createElement("canvas");
      desenharPrevia(cv, foto, fmt);
      cv.onclick = () => Editor.abrir(lista.indexOf(foto), fmt.id);
      const lab = document.createElement("label"); lab.className = "check";
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = e.on;
      chk.onchange = () => { e.on = chk.checked; invalidar(); render(); };
      lab.append(chk, fmt.id);
      if (e.on && nums[fmt.id]) {
        const n = document.createElement("span"); n.className = "num";
        n.textContent = d.partes > 1 ? ` #${nums[fmt.id]}–${nums[fmt.id] + d.partes - 1}` : ` #${nums[fmt.id]}`;
        lab.appendChild(n);
      }
      p.append(cv, lab);
      if (fmt.divisao_carrossel > 1) {
        const ld = document.createElement("label"); ld.className = "check dividir";
        const cd = document.createElement("input"); cd.type = "checkbox"; cd.checked = e.dividir;
        cd.onchange = () => { e.dividir = cd.checked; if (cd.checked) e.on = true; const dd = dims(fmt, e); U.prenderCrop(foto.w, foto.h, dd.w, dd.h, e.crop); invalidar(); render(); };
        ld.append(cd, `dividir em ${fmt.divisao_carrossel}`);
        p.appendChild(ld);
      }
      const r = recorte(foto, fmt);
      if (e.on && r.w < d.w * 0.9) { const a = document.createElement("span"); a.className = "baixa"; a.textContent = "baixa resolução"; p.appendChild(a); }
      previas.appendChild(p);
    }
    c.appendChild(previas);
    return c;
  }

  function mover(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    invalidar(); render();
  }

  function desenharPrevia(cv, foto, fmt) {
    const dpr = window.devicePixelRatio || 1, e = foto.formatos[fmt.id], d = dims(fmt, e);
    const h = ALT_PREVIA, w = Math.round((h * d.w) / d.h);
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d"), r = recorte(foto, fmt), k = foto.mini.width / foto.w;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(foto.mini, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, cv.width, cv.height);
    guiasPartes(ctx, 0, 0, cv.width, cv.height, fmt, d.partes, guias, true);
  }

  /* ------------------------------------------------------------ progresso */
  function progresso(fr, txt = "", aoCancelar = null) {
    const el = $("#progresso");
    const bc = $("#progresso-cancelar");
    if (fr == null) { el.hidden = true; bc.hidden = true; bc.onclick = null; return; }
    if (aoCancelar) { bc.hidden = false; bc.onclick = aoCancelar; }
    el.hidden = false;
    el.querySelector(".enchimento").style.width = Math.round(fr * 100) + "%";
    el.querySelector(".texto").textContent = txt;
  }

  /* ------------------------------------------------------------ preparar e salvar */
  async function renderizar(img, foto, fmt) {
    const d = dims(fmt, foto.formatos[fmt.id]), r = recorte(foto, fmt);
    const canvas = U.reduzirRegiao(img, r.x, r.y, r.w, r.h, d.w, d.h, "#ffffff");
    const blobs = [];
    if (d.partes === 1) blobs.push(await U.canvasParaBlob(canvas, "image/jpeg", qualidade));
    else {
      const parte = document.createElement("canvas");
      parte.width = fmt.largura; parte.height = fmt.altura;
      const pc = parte.getContext("2d");
      for (let i = 0; i < d.partes; i++) {
        pc.drawImage(canvas, i * fmt.largura, 0, fmt.largura, fmt.altura, 0, 0, fmt.largura, fmt.altura);
        blobs.push(await U.canvasParaBlob(parte, "image/jpeg", qualidade));
      }
      parte.width = parte.height = 0;
    }
    canvas.width = canvas.height = 0;
    return blobs;
  }

  async function preparar() {
    const c = campos();
    if (!c.ok) { U.toast(c.erro, "erro"); return; }
    const { nums, totais } = numeracao();
    const total = Object.values(totais).reduce((a, b) => a + b, 0);
    if (!total) { U.toast("Nenhuma foto marcada em nenhum formato.", "erro"); return; }
    if (prontos && prontos.assinatura === assinatura(c)) { mostrarSalvar(); return; }

    const porFormato = {}, todos = [];
    for (const f of formatos) porFormato[f.id] = [];
    let feitos = 0;
    try {
      for (const foto of lista) {
        const ativos = formatos.filter((f) => foto.formatos[f.id].on);
        if (!ativos.length) continue;
        const { img, liberar } = await U.carregarImagem(foto.file);
        try {
          for (const fmt of ativos) {
            const blobs = await renderizar(img, foto, fmt);
            blobs.forEach((blob, k) => {
              const nome = nomeArquivo(c, fmt, nums.get(foto.id)[fmt.id] + k);
              porFormato[fmt.id].push({ nome, blob, n: nums.get(foto.id)[fmt.id] + k });
              todos.push({ nome: `${c.atleta}_${c.data}/${fmt.id}/${nome}`, blob });
              feitos++;
              progresso(feitos / total, `Preparando ${feitos}/${total}`);
            });
          }
        } finally { liberar(); }
      }
    } catch (e) {
      progresso(null);
      U.toast("Erro ao preparar: " + e.message, "erro");
      return;
    }
    progresso(null);
    for (const id in porFormato) porFormato[id].sort((a, b) => a.n - b.n);
    prontos = { assinatura: assinatura(c), pasta: `${c.atleta}_${c.data}`, porFormato, todos };
    mostrarSalvar();
  }

  const assinatura = (c) => JSON.stringify([c, lista.map((f) => [f.id, f.formatos])]);

  function mostrarSalvar() {
    const grupos = formatos.filter((f) => prontos.porFormato[f.id].length)
      .map((f) => ({ rotulo: f.id, itens: prontos.porFormato[f.id], tipo: "image/jpeg" }));
    telaSalvar({ titulo: "Fotos prontas", grupos, zip: prontos.todos, zipNome: `${prontos.pasta}.zip`, pasta: prontos.pasta,
      dica: 'Toque em cada botão e escolha <b>"Salvar Imagens"</b> (vai para a galeria, na ordem) ou <b>"Salvar em Arquivos"</b> (mantém os nomes).' });
  }

  // Tela "prontos" genérica (fotos e vídeos): um botão por grupo, que abre a tela de compartilhar do iPhone
  let zipAtual = null;
  function telaSalvar({ titulo, dica, grupos, zip, zipNome, pasta }) {
    $("#salvar-titulo").textContent = titulo;
    $("#salvar-dica").innerHTML = dica;
    zipAtual = { zip, zipNome };
    const caixa = $("#salvar-botoes");
    caixa.replaceChildren();
    const podeCompartilhar = !!(navigator.canShare && navigator.share);
    for (const g of grupos) {
      const b = document.createElement("button");
      b.className = "primario";
      const rotulo = g.texto || `Salvar ${g.itens.length} ${g.rotulo}`;
      b.textContent = rotulo;
      b.onclick = async () => {
        const arquivos = g.itens.map((x) => new File([x.blob], x.nome, { type: g.tipo }));
        if (podeCompartilhar && navigator.canShare({ files: arquivos })) {
          try {
            await navigator.share({ files: arquivos });
            b.classList.add("feito"); b.textContent = "✓ " + rotulo.replace(/^Salvar /, "");
          } catch (e) {
            if (e.name !== "AbortError") U.toast("Não deu para compartilhar: " + e.message, "erro");
          }
        } else if (g.itens.length === 1) {
          U.baixarBlob(g.itens[0].blob, g.itens[0].nome);
        } else {
          U.baixarBlob(await Zip.criar(g.itens.map((x) => ({ nome: x.nome, blob: x.blob }))), `${pasta}_${g.rotulo}.zip`);
        }
      };
      caixa.appendChild(b);
    }
    $("#salvar").hidden = false;
  }

  /* ------------------------------------------------------------ editor (toque) */
  const Editor = (() => {
    const ed = { aberto: false, idx: 0, fmtId: null, img: null, imgDe: null, escala: 1, quadro: null };
    const cv = $("#ed-canvas"), ctx = cv.getContext("2d");
    const toques = new Map();
    let gesto = null, pedido = 0;
    const foto = () => lista[ed.idx];
    const fmt = () => formatos.find((f) => f.id === ed.fmtId);
    const est = () => foto().formatos[ed.fmtId];
    const dimsAt = () => dims(fmt(), est());

    function init() {
      $("#ed-fechar").onclick = fechar;
      $("#ed-anterior").onclick = () => irPara(ed.idx - 1);
      $("#ed-proxima").onclick = () => irPara(ed.idx + 1);
      $("#ed-centralizar").onclick = () => { est().crop = U.cropPadrao(); prender(); atualizar(); };
      $("#ed-guias").onchange = (e) => { guias = e.target.checked; localStorage.setItem("m.guias", guias ? "1" : "0"); desenhar(); };
      $("#ed-on").onchange = (e) => { est().on = e.target.checked; invalidar(); topo(); };
      $("#ed-dividir").onchange = (e) => { est().dividir = e.target.checked; if (e.target.checked) est().on = true; prender(); invalidar(); topo(); atualizar(); };

      cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); toques.set(e.pointerId, { x: e.clientX, y: e.clientY }); iniciarGesto(); });
      cv.addEventListener("pointermove", (e) => {
        if (!toques.has(e.pointerId)) return;
        toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moverGesto();
      });
      const fim = (e) => { toques.delete(e.pointerId); iniciarGesto(); };
      cv.addEventListener("pointerup", fim);
      cv.addEventListener("pointercancel", fim);
      // Safari: evita o zoom da página no gesto de pinça
      ["gesturestart", "gesturechange"].forEach((n) => cv.addEventListener(n, (e) => e.preventDefault()));
      window.addEventListener("resize", () => ed.aberto && desenhar());
    }

    function ponto() {
      const ps = [...toques.values()];
      const caixa = cv.getBoundingClientRect();
      const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length - caixa.left;
      const my = ps.reduce((s, p) => s + p.y, 0) / ps.length - caixa.top;
      const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
      return { mx, my, dist, n: ps.length };
    }
    function iniciarGesto() { gesto = toques.size ? { ...ponto(), zoom: est().crop.zoom } : null; }
    function moverGesto() {
      if (!gesto) return;
      const p = ponto();
      if (p.n !== gesto.n) { iniciarGesto(); return; }
      const f = foto(), c = est().crop;
      // arrastar: a imagem acompanha o dedo
      c.cx -= (p.mx - gesto.mx) / (ed.escala * f.w);
      c.cy -= (p.my - gesto.my) / (ed.escala * f.h);
      prender();
      if (p.n > 1 && gesto.dist > 0) zoomEm(gesto.zoom * (p.dist / gesto.dist), p.mx, p.my);
      gesto.mx = p.mx; gesto.my = p.my;
      atualizar();
    }

    function prender() { const f = foto(), d = dimsAt(); U.prenderCrop(f.w, f.h, d.w, d.h, est().crop); }

    function zoomEm(novo, mx, my) {
      const f = foto(), d = dimsAt(), c = est().crop, q = ed.quadro;
      novo = U.clamp(novo, 1, 5);
      if (q) {
        const r = U.retanguloCrop(f.w, f.h, d.w, d.h, c);
        const s = q.w / r.w;
        const px = r.x + (mx - q.x) / s, py = r.y + (my - q.y) / s;
        const fx = (mx - q.x) / q.w, fy = (my - q.y) / q.h;
        const w2 = (r.w * c.zoom) / novo, h2 = (r.h * c.zoom) / novo;
        c.cx = (px - fx * w2 + w2 / 2) / f.w;
        c.cy = (py - fy * h2 + h2 / 2) / f.h;
      }
      c.zoom = novo;
      prender();
    }

    async function abrir(idx, fmtId) {
      ed.aberto = true; ed.fmtId = fmtId;
      $("#editor").hidden = false;
      $("#ed-guias").checked = guias;
      document.body.style.overflow = "hidden";
      await irPara(idx);
    }
    function fechar() {
      ed.aberto = false;
      $("#editor").hidden = true;
      document.body.style.overflow = "";
      if (ed.img) ed.img.width = ed.img.height = 0;
      ed.img = null; ed.imgDe = null;
      render();
    }

    async function irPara(idx) {
      if (idx < 0 || idx >= lista.length) return;
      ed.idx = idx; topo(); atualizar();
      const alvo = foto();
      if (ed.imgDe === alvo.id) return;
      try {
        const { img, liberar } = await U.carregarImagem(alvo.file);
        const k = Math.min(1, LADO_EDITOR / Math.max(alvo.w, alvo.h));
        const c = U.reduzirRegiao(img, 0, 0, alvo.w, alvo.h, Math.round(alvo.w * k), Math.round(alvo.h * k));
        liberar();
        if (foto() !== alvo || !ed.aberto) { c.width = c.height = 0; return; }
        if (ed.img) ed.img.width = ed.img.height = 0;
        ed.img = c; ed.imgDe = alvo.id; desenhar();
      } catch { /* fica com a miniatura */ }
    }

    function topo() {
      const f = foto();
      $("#ed-titulo").textContent = `${ed.idx + 1}/${lista.length}`;
      $("#ed-anterior").disabled = ed.idx === 0;
      $("#ed-proxima").disabled = ed.idx === lista.length - 1;
      const caixa = $("#ed-formatos");
      caixa.replaceChildren();
      for (const fm of formatos) {
        const b = document.createElement("button");
        b.textContent = fm.id;
        b.className = (fm.id === ed.fmtId ? "ativo" : "") + (f.formatos[fm.id].on ? "" : " desligado");
        b.onclick = () => { ed.fmtId = fm.id; topo(); atualizar(); };
        caixa.appendChild(b);
      }
      $("#ed-on").checked = est().on;
      $("#ed-on-txt").textContent = `Exportar ${ed.fmtId}`;
      $("#ed-dividir-lab").hidden = !(fmt().divisao_carrossel > 1);
      $("#ed-dividir").checked = est().dividir;
    }

    function atualizar() {
      const f = foto(), d = dimsAt(), r = U.retanguloCrop(f.w, f.h, d.w, d.h, est().crop);
      $("#ed-aviso").textContent = r.w < d.w * 0.9 ? `⚠ baixa resolução: recorte de ${Math.round(r.w)}px vira ${d.w}px` : "";
      desenhar();
    }
    function desenhar() { cancelAnimationFrame(pedido); pedido = requestAnimationFrame(desenharAgora); }
    function desenharAgora() {
      if (!ed.aberto) return;
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0c0d"; ctx.fillRect(0, 0, W, H);
      const f = foto(), fm = fmt(), d = dimsAt(), A = d.w / d.h, m = 16;
      let qw = W - 2 * m, qh = qw / A;
      if (qh > H - 2 * m) { qh = H - 2 * m; qw = qh * A; }
      const q = { x: (W - qw) / 2, y: (H - qh) / 2, w: qw, h: qh };
      ed.quadro = q;
      const r = U.retanguloCrop(f.w, f.h, d.w, d.h, est().crop), s = qw / r.w;
      ed.escala = s;
      const fonte = ed.imgDe === f.id && ed.img ? ed.img : f.mini;
      ctx.fillStyle = "#fff"; ctx.fillRect(q.x - r.x * s, q.y - r.y * s, f.w * s, f.h * s);
      ctx.drawImage(fonte, q.x - r.x * s, q.y - r.y * s, f.w * s, f.h * s);
      ctx.fillStyle = "rgba(11,12,13,0.75)";
      ctx.fillRect(0, 0, W, q.y); ctx.fillRect(0, q.y + q.h, W, H - q.y - q.h);
      ctx.fillRect(0, q.y, q.x, q.h); ctx.fillRect(q.x + q.w, q.y, W - q.x - q.w, q.h);
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeRect(q.x - 0.5, q.y - 0.5, q.w + 1, q.h + 1);
      guiasPartes(ctx, q.x, q.y, q.w, q.h, fm, d.partes, guias, false);
    }
    return { init, abrir };
  })();

  function trocarAba(aba) {
    for (const b of document.querySelectorAll(".abas button")) b.classList.toggle("ativo", b.dataset.aba === aba);
    $("#aba-fotos").hidden = aba !== "fotos";
    $("#aba-video").hidden = aba !== "video";
    localStorage.setItem("m.aba", aba);
    atualizarExemplo();
    window.dispatchEvent(new CustomEvent("liga:aba", { detail: aba }));
  }

  // usado pela aba Vídeo (video.js)
  window.LIGA = { campos, progresso, telaSalvar, aba: () => localStorage.getItem("m.aba") || "fotos" };

  /* ------------------------------------------------------------ init */
  function init() {
    const at = $("#atleta"), dt = $("#data"), pd = $("#padding");
    at.value = localStorage.getItem("m.atleta") || "";
    dt.value = U.hoje();
    pd.value = localStorage.getItem("m.padding") || String(CFG.nome.padding || 1);
    at.addEventListener("input", () => { localStorage.setItem("m.atleta", at.value); invalidar(); atualizarExemplo(); });
    at.addEventListener("blur", () => { at.value = U.normalizarAtleta(at.value); localStorage.setItem("m.atleta", at.value); atualizarExemplo(); });
    dt.addEventListener("input", () => { invalidar(); atualizarExemplo(); });
    dt.addEventListener("blur", () => { const d = U.normalizarData(dt.value); if (d) dt.value = d; atualizarExemplo(); });
    pd.addEventListener("change", () => { localStorage.setItem("m.padding", pd.value); invalidar(); atualizarExemplo(); });

    $("#input-fotos").onchange = (e) => { adicionar([...e.target.files]); e.target.value = ""; };
    const marcar = $("#marcar");
    marcar.append("Marcar todas:");
    for (const f of formatos) {
      const b = document.createElement("button");
      b.textContent = f.id;
      b.onclick = () => { const todas = lista.length && lista.every((x) => x.formatos[f.id].on); lista.forEach((x) => (x.formatos[f.id].on = !todas)); invalidar(); render(); };
      marcar.appendChild(b);
    }
    const g = document.createElement("label"); g.className = "check";
    const gc = document.createElement("input"); gc.type = "checkbox"; gc.checked = guias;
    gc.onchange = () => { guias = gc.checked; localStorage.setItem("m.guias", guias ? "1" : "0"); render(); };
    g.append(gc, "Guias"); marcar.appendChild(g);

    $("#btn-preparar").onclick = preparar;
    $("#salvar-fechar").onclick = () => ($("#salvar").hidden = true);
    $("#salvar-zip").onclick = async () => { if (zipAtual) U.baixarBlob(await Zip.criar(zipAtual.zip), zipAtual.zipNome); };
    for (const b of document.querySelectorAll(".abas button")) b.onclick = () => trocarAba(b.dataset.aba);
    trocarAba(localStorage.getItem("m.aba") || "fotos");
    window.addEventListener("beforeunload", (e) => { if (lista.length) { e.preventDefault(); e.returnValue = ""; } });
    Editor.init();
    atualizarExemplo();
    render();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
})();
