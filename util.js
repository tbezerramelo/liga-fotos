// Funções compartilhadas entre as abas (nomes, datas, enquadramento, guias).
const U = {};

U.$ = (sel, raiz = document) => raiz.querySelector(sel);
U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// "Moráto  Jr." -> "MORATOJR"
U.normalizarAtleta = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

U.hoje = () => {
  const d = new Date();
  return [d.getDate(), d.getMonth() + 1].map((n) => String(n).padStart(2, "0")).join("_") + "_" + d.getFullYear();
};

// Aceita 24_11_2026, 24/11/2026, 24-11-26, 24.11.2026, 24112026 -> "24_11_2026" (ou null se inválida)
U.normalizarData = (s) => {
  const limpo = (s || "").trim();
  let m = limpo.match(/^(\d{1,2})\D+(\d{1,2})\D+(\d{2}|\d{4})$/) || limpo.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  let [, d, mes, a] = m.map(Number);
  if (a < 100) a += 2000;
  const dt = new Date(a, mes - 1, d);
  if (dt.getFullYear() !== a || dt.getMonth() !== mes - 1 || dt.getDate() !== d) return null;
  return `${String(d).padStart(2, "0")}_${String(mes).padStart(2, "0")}_${a}`;
};

U.montarNome = (template, campos, padding) =>
  template.replace(/\{(\w+)\}/g, (_, k) => (k === "N" ? String(campos.N).padStart(padding, "0") : campos[k] ?? ""));

/* ------------------------------------------------------------------ enquadramento
 * crop = { cx, cy, zoom } — centro normalizado (0..1) na imagem original e zoom >= 1.
 * zoom 1 = maior retângulo na proporção do formato que cabe na imagem ("cover").
 * Assim o mesmo crop vale para a miniatura, o editor e a exportação em alta.
 */
U.cropPadrao = () => ({ cx: 0.5, cy: 0.5, zoom: 1 });

U.retanguloCrop = (imgW, imgH, outW, outH, crop) => {
  const A = outW / outH;
  let baseW, baseH;
  if (imgW / imgH > A) { baseH = imgH; baseW = imgH * A; } else { baseW = imgW; baseH = imgW / A; }
  const w = baseW / crop.zoom, h = baseH / crop.zoom;
  const x = U.clamp(crop.cx * imgW - w / 2, 0, imgW - w);
  const y = U.clamp(crop.cy * imgH - h / 2, 0, imgH - h);
  return { x, y, w, h };
};

// Corrige o centro para a janela nunca sair da imagem.
U.prenderCrop = (imgW, imgH, outW, outH, crop) => {
  const r = U.retanguloCrop(imgW, imgH, outW, outH, crop);
  crop.cx = (r.x + r.w / 2) / imgW;
  crop.cy = (r.y + r.h / 2) / imgH;
  return crop;
};

/* ------------------------------------------------------------------ guias seguras
 * Desenha as guias de um formato dentro do retângulo (x, y, w, h) do canvas.
 * fmt.guias: { topo, base, esquerda, direita } em px do arquivo final, recorte_grade: "3:4" | null
 */
U.desenharGuias = (ctx, x, y, w, h, fmt, fino = false) => {
  const g = fmt.guias || {};
  const s = w / fmt.largura;
  const lw = fino ? 1 : 1.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Faixas cobertas pela interface (topo/base): vermelho translúcido
  ctx.fillStyle = "rgba(229,72,77,0.28)";
  if (g.topo) ctx.fillRect(x, y, w, g.topo * s);
  if (g.base) ctx.fillRect(x, y + h - g.base * s, w, g.base * s);

  // Margens laterais: tracejado
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = lw;
  ctx.setLineDash(fino ? [3, 3] : [6, 5]);
  const it = y + (g.topo || 0) * s, ib = y + h - (g.base || 0) * s;
  const il = x + (g.esquerda || 0) * s, ir = x + w - (g.direita || 0) * s;
  if (g.topo || g.base || g.esquerda || g.direita) ctx.strokeRect(il, it, ir - il, ib - it);

  // Recorte da grade do perfil (ex.: 3:4 centralizado)
  if (g.recorte_grade) {
    const [a, b] = g.recorte_grade.split(":").map(Number);
    const gw = Math.min(w, (h * a) / b), gh = Math.min(h, (w * b) / a);
    const gx = x + (w - gw) / 2, gy = y + (h - gh) / 2;
    ctx.fillStyle = "rgba(245,165,36,0.22)";
    if (gw < w) { ctx.fillRect(x, y, gx - x, h); ctx.fillRect(gx + gw, y, x + w - gx - gw, h); }
    if (gh < h) { ctx.fillRect(x, y, w, gy - y); ctx.fillRect(x, gy + gh, w, y + h - gy - gh); }
    ctx.strokeStyle = "rgba(245,165,36,0.95)";
    ctx.setLineDash([]);
    ctx.strokeRect(gx, gy, gw, gh);
    if (!fino) {
      ctx.fillStyle = "rgba(245,165,36,0.95)";
      ctx.font = "600 12px -apple-system, sans-serif";
      ctx.fillText(`grade ${g.recorte_grade}`, gx + 6, gy + gh - 8);
    }
  }
  if (!fino && g.topo) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 12px -apple-system, sans-serif";
    ctx.fillText("área coberta pelo Instagram", x + 8, y + 18);
  }
  ctx.restore();
};

/* ------------------------------------------------------------------ imagens */
U.carregarImagem = (blob) =>
  new Promise((ok, falha) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => ok({ img, liberar: () => { URL.revokeObjectURL(url); img.src = ""; } });
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Não foi possível abrir a imagem")); };
    img.src = url;
  });

// Reduz uma região da imagem em etapas de 2x (fica bem mais nítido que reduzir de uma vez).
U.reduzirRegiao = (fonte, sx, sy, sw, sh, outW, outH, fundo = null) => {
  let src = fonte, x = sx, y = sy, w = sw, h = sh;
  const temps = [];
  while (w / 2 >= outW && h / 2 >= outH) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w / 2));
    c.height = Math.max(1, Math.round(h / 2));
    const cx = c.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    temps.push(c);
    src = c; x = 0; y = 0; w = c.width; h = c.height;
  }
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (fundo) { ctx.fillStyle = fundo; ctx.fillRect(0, 0, outW, outH); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, x, y, w, h, 0, 0, outW, outH);
  temps.forEach((c) => { c.width = c.height = 0; });
  return out;
};

U.canvasParaBlob = (canvas, tipo, qualidade) =>
  new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error("Falha ao gerar JPG"))), tipo, qualidade));

/* ------------------------------------------------------------------ servidor */
U.api = async (caminho, opcoes = {}) => {
  const r = await fetch(caminho, opcoes);
  let dados = null;
  try { dados = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) throw new Error((dados && dados.erro) || `Erro ${r.status}`);
  return dados;
};
U.postJSON = (caminho, corpo) =>
  U.api(caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

/* ------------------------------------------------------------------ toast */
U.toast = (msg, tipo = "", acoes = [], duracao = 5000) => {
  const t = U.$("#toast");
  t.className = "toast " + tipo;
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  for (const [rotulo, fn] of acoes) {
    const b = document.createElement("button");
    b.textContent = rotulo;
    b.onclick = () => { t.hidden = true; fn(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(U._toastTimer);
  if (duracao) U._toastTimer = setTimeout(() => (t.hidden = true), duracao);
};

U.baixarBlob = (blob, nome) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};
