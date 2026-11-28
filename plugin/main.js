// Sound Library
// Biblioteca dos seus sons (pasta local / Google Drive): categorias por pasta,
// favoritos, busca, duração, preview e "+" para colocar na timeline no playhead.

const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

// ---------------- configuração ----------------
const AUDIO_EXT = ["wav", "mp3", "aif", "aiff", "m4a", "aac", "flac", "ogg"];
// Pastas cujo nome contém uma destas palavras viram a aba ⭐ Favoritos
const FAVORITE_HINTS = ["preferid", "favorit"];
const MAX_TRACKS = 8;          // opções A1…A8 no seletor de faixa
const DEFAULT_TRACK = 3;       // A3

// ---------------- estado ----------------
let rootFolder = null;   // Folder (UXP) da biblioteca
let sounds = [];         // [{ name, path, entry, category, favorite, duration }]
let query = "";
const importedItems = new Map(); // path -> ProjectItem (cache desta sessão)

// ---------------- preferências (salvas no próprio painel) ----------------
function pref(key, fallback) {
  try { const v = localStorage.getItem("sl." + key); return v === null ? fallback : v; }
  catch (e) { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem("sl." + key, String(value)); } catch (e) { /* ignora */ }
}

// ---------------- status ----------------
function status(msg, cls) {
  const el = document.getElementById("status");
  el.className = cls || "";
  el.textContent = msg;
  if (cls === "err") console.error(msg);
}

// ---------------- leitura da pasta ----------------
function ext(name) {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : "";
}
function isFavoriteFolder(name) {
  const n = name.toLowerCase();
  return FAVORITE_HINTS.some(h => n.includes(h));
}

// Percorre a pasta. A categoria é a pasta onde o arquivo está
// (ex.: .../SFX/Whoosh/x.wav → "Whoosh"), assim funciona escolhendo
// a pasta raiz ou uma pasta acima dela (ex.: "SFX e Trilhas").
// Favorito = o arquivo está dentro de uma pasta "Preferidos"/"Favoritos" (em qualquer nível).
async function scanFolder(folder, category, favorite, out) {
  const entries = await folder.getEntries();
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // .DS_Store e ocultos
    if (entry.isFolder) {
      const fav = favorite || isFavoriteFolder(entry.name);
      await scanFolder(entry, entry.name.trim(), fav, out);
    } else if (AUDIO_EXT.includes(ext(entry.name))) {
      out.push({
        name: entry.name,
        path: entry.nativePath,
        entry: entry, // usado para ler o arquivo no preview
        category: category || "Geral",
        favorite: favorite,
      });
    }
  }
  return out;
}

async function loadLibrary() {
  if (!rootFolder) return;
  status("Lendo a pasta…");
  try {
    const found = await scanFolder(rootFolder, null, false, []);
    found.sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));
    for (const f of found) if (f.path in durationCache) f.duration = durationCache[f.path];
    sounds = found;
    document.getElementById("libPath").textContent = rootFolder.nativePath;
    status(`${sounds.length} sons encontrados.`, "ok");
    setTimeout(computeDurations, 50);
  } catch (e) {
    sounds = [];
    status(`Erro ao ler a pasta: ${e.message || e}`, "err");
  }
  render();
}

// ---------------- escolher / lembrar a pasta ----------------
async function chooseFolder() {
  try {
    const folder = await localFileSystem.getFolder();
    if (!folder) return;
    rootFolder = folder;
    // Lembra a pasta para a próxima vez que o Premiere abrir (dois jeitos).
    setPref("folderPath", folder.nativePath);
    try {
      if (localFileSystem.createPersistentToken) {
        const token = await localFileSystem.createPersistentToken(folder);
        setPref("folderToken", token);
      }
    } catch (e) {
      console.warn("Não foi possível salvar o token da pasta:", e);
    }
    await loadLibrary();
    // pasta escolhida: fecha as configurações para sobrar espaço para a lista
    document.getElementById("settings").classList.add("hidden");
    document.getElementById("btnSettings").classList.remove("on");
    fitContent();
  } catch (e) {
    status(`Erro ao escolher pasta: ${e.message || e}`, "err");
  }
}

async function restoreFolder() {
  const token = pref("folderToken", null);
  const path = pref("folderPath", null);
  if (!token && !path) return;
  const problems = [];

  // 1) Token persistente
  if (token && localFileSystem.getEntryForPersistentToken) {
    try {
      const folder = await localFileSystem.getEntryForPersistentToken(token);
      if (folder && folder.isFolder) { rootFolder = folder; await loadLibrary(); return; }
      problems.push("token: entrada inválida");
    } catch (e) { problems.push("token: " + (e.message || e)); }
  } else if (token) {
    problems.push("token: função indisponível");
  }

  // 2) Caminho salvo (precisa de acesso total ao disco no manifest)
  if (path && localFileSystem.getEntryWithUrl) {
    try {
      const url = "file:" + path.replace(/\\/g, "/");
      const folder = await localFileSystem.getEntryWithUrl(url);
      if (folder && folder.isFolder) { rootFolder = folder; await loadLibrary(); return; }
      problems.push("caminho: entrada inválida");
    } catch (e) { problems.push("caminho: " + (e.message || e)); }
  } else if (path) {
    problems.push("caminho: função indisponível");
  }

  console.warn("Pasta salva não pôde ser reaberta:", problems);
  status("Não consegui reabrir a pasta salva (" + problems.join(" | ") + "). Escolha a pasta de novo.", "err");
}

// ---------------- duração dos sons ----------------
// Lida do cabeçalho do arquivo (WAV exato; MP3 estimado pelo 1º frame / cabeçalho Xing).
// Calculada em segundo plano e guardada em cache para não reler os arquivos toda vez.
const SHORT_MAX = 1;   // até 1s = Curto
const MEDIUM_MAX = 3;  // até 3s = Médio; acima = Longo

let durationCache = {};
try { durationCache = JSON.parse(pref("durations", "{}")) || {}; } catch (e) { durationCache = {}; }

function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function u32be(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function tag(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

function wavDuration(b) {
  if (b.length < 12 || tag(b, 0) !== "RIFF" || tag(b, 8) !== "WAVE") return null;
  let o = 12, byteRate = 0, dataSize = 0;
  while (o + 8 <= b.length) {
    const id = tag(b, o), size = u32le(b, o + 4);
    if (id === "fmt ") byteRate = u32le(b, o + 16);
    if (id === "data") { dataSize = Math.min(size, b.length - o - 8); break; }
    o += 8 + size + (size % 2);
  }
  return byteRate && dataSize ? dataSize / byteRate : null;
}

const MP3_BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],   // MPEG1 Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],       // MPEG2/2.5 Layer III
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3Duration(b) {
  let o = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // "ID3"
    o = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  for (; o + 4 < b.length; o++) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[o + 1] >> 3) & 3;          // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layer = (b[o + 1] >> 1) & 3;        // 1=Layer III
    const brIdx = (b[o + 2] >> 4) & 15, srIdx = (b[o + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const kbps = MP3_BITRATES[ver === 3 ? 1 : 2][brIdx];
    const rate = MP3_RATES[ver][srIdx];
    const samplesPerFrame = ver === 3 ? 1152 : 576;
    const mono = ((b[o + 3] >> 6) & 3) === 3;
    const sideInfo = ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = o + 4 + sideInfo;
    if (x + 12 < b.length && (tag(b, x) === "Xing" || tag(b, x) === "Info") && (u32be(b, x + 4) & 1)) {
      return u32be(b, x + 8) * samplesPerFrame / rate; // VBR: nº de frames
    }
    return (b.length - o) * 8 / (kbps * 1000);         // CBR: estimativa pelo tamanho
  }
  return null;
}

async function readDuration(sound) {
  const e = ext(sound.name);
  if (e !== "wav" && e !== "mp3") return null;
  const { formats } = require("uxp").storage;
  const buf = await sound.entry.read({ format: formats.binary });
  const b = new Uint8Array(buf);
  return e === "wav" ? wavDuration(b) : mp3Duration(b);
}

let durationsRunning = false;
async function computeDurations() {
  if (durationsRunning) return;
  durationsRunning = true;
  let changed = 0;
  for (const s of sounds) {
    if (s.duration !== undefined) continue;
    try { s.duration = await readDuration(s); } catch (e) { s.duration = null; }
    durationCache[s.path] = s.duration;
    if (++changed % 15 === 0) { setPref("durations", JSON.stringify(durationCache)); renderContent(); }
  }
  setPref("durations", JSON.stringify(durationCache));
  durationsRunning = false;
  if (changed) renderContent();
}

function durationClass(d) {
  if (d == null) return null;
  return d <= SHORT_MAX ? "short" : d <= MEDIUM_MAX ? "medium" : "long";
}
function formatDuration(d) {
  if (d == null) return "";
  if (d < 10) return d.toFixed(1) + "s";
  const m = Math.floor(d / 60), s = Math.round(d % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

// ---------------- interface ----------------
// view: "home" (biblioteca com os cards) | VIEW_ALL | VIEW_FAV | nome da categoria
const VIEW_ALL = "__all__";
const VIEW_FAV = "__fav__";
let view = "home";
let durFilter = "";   // "" | "short" | "medium" | "long"

function categories() {
  const set = new Set(sounds.filter(s => !s.favorite).map(s => s.category));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));
}

function viewLabel(v) {
  return v === VIEW_ALL ? "Todos" : v === VIEW_FAV ? "Favoritos" : v;
}

function soundsInView() {
  if (view === VIEW_FAV) return sounds.filter(s => s.favorite);
  if (view === VIEW_ALL || view === "home") return sounds;
  return sounds.filter(s => s.category === view && !s.favorite);
}

function visibleSounds() {
  const q = query.trim().toLowerCase();
  return soundsInView().filter(s => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (durFilter && durationClass(s.duration) !== durFilter) return false;
    return true;
  });
}

function nSons(n) { return n === 1 ? "1 som" : `${n} sons`; }

function el(tagName, cls, text) {
  const e = document.createElement(tagName);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function go(v) {
  view = v;
  durFilter = "";
  render();
  try { document.getElementById("content").scrollTop = 0; } catch (e) { /* ignora */ }
}

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  if (view === "home") return;
  const back = el("div", "back", "‹");
  back.title = "Voltar para a biblioteca";
  back.addEventListener("click", () => go("home"));
  nav.appendChild(back);
}

function renderTitle() {
  const t = document.getElementById("title");
  t.innerHTML = "";
  const searching = query.trim().length > 0;
  const label = view === "home" ? (searching ? "Resultados" : "Biblioteca") : viewLabel(view);
  t.appendChild(el("div", "big", (view === VIEW_FAV ? "⭐ " : "") + label));
  const n = view === "home" && !searching ? sounds.length : visibleSounds().length;
  t.appendChild(el("div", "count", nSons(n)));
}

function renderFilters() {
  const f = document.getElementById("filters");
  f.innerHTML = "";
  if (view === "home" && !query.trim()) return;
  for (const [id, label] of [["short", "Curto"], ["medium", "Médio"], ["long", "Longo"]]) {
    const b = el("div", "filter" + (durFilter === id ? " on" : ""), label);
    b.addEventListener("click", () => { durFilter = durFilter === id ? "" : id; renderFilters(); renderContent(); });
    f.appendChild(b);
  }
}

// Quantas colunas cabem na largura do painel (painel largo = grade com várias colunas).
let columns = 1;
function computeColumns(minWidth) {
  try {
    const w = document.getElementById("content").clientWidth || window.innerWidth;
    return Math.max(1, Math.floor(w / minWidth));
  } catch (e) { return 1; }
}
function colWidth(cols) { return (Math.floor(1000 / cols) / 10 - 1) + "%"; }

function renderCards(box) {
  const cards = el("div", "grid");
  const cols = Math.max(2, computeColumns(150));
  const add = (id, name, count, extra) => {
    const c = el("div", "card" + (extra ? " " + extra : ""));
    c.style.width = colWidth(cols);
    c.appendChild(el("div", "cname", name));
    c.appendChild(el("div", "ccount", nSons(count)));
    c.addEventListener("click", () => go(id));
    cards.appendChild(c);
  };
  const favCount = sounds.filter(s => s.favorite).length;
  if (favCount) add(VIEW_FAV, "⭐ Favoritos", favCount, "fav");
  add(VIEW_ALL, "Todos", sounds.length);
  for (const c of categories()) add(c, c, sounds.filter(s => s.category === c && !s.favorite).length);
  box.appendChild(cards);
}

function renderRows(box, items) {
  if (!items.length) { box.appendChild(el("div", "empty", "Nenhum som encontrado.")); return; }
  const grid = el("div", "grid");
  box.appendChild(grid);
  columns = computeColumns(260);
  for (const s of items) {
    const row = el("div", "item");
    row.style.width = colWidth(columns);
    row.title = s.path;

    const playing = previewingPath === s.path;
    const play = el("div", "play" + (playing ? " playing" : ""), playing ? "■" : "▶");
    play.title = "Ouvir (preview)";
    row.appendChild(play);

    const info = el("div", "info");
    info.appendChild(el("div", "name", stripExt(s.name)));
    const meta = [formatDuration(s.duration), s.favorite ? "⭐ " + s.category : s.category].filter(Boolean).join(" · ");
    info.appendChild(el("div", "meta", meta));
    row.appendChild(info);

    const addBtn = el("div", "add", "+");
    addBtn.title = "Colocar na timeline (playhead)";
    addBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.__handledByAdd = true;
      placeSound(s, row);
    });
    row.appendChild(addBtn);

    // clicar no card (ou no ▶) = ouvir; o "+" coloca na timeline
    row.addEventListener("click", (ev) => {
      // Se o clique foi no "+", não toca o preview (caso o stopPropagation não funcione no UXP).
      if (ev && (ev.__handledByAdd || ev.target === addBtn)) return;
      togglePreview(s);
    });
    grid.appendChild(row);
  }
}

function renderContent() {
  const box = document.getElementById("content");
  box.innerHTML = "";
  if (!rootFolder) {
    box.appendChild(el("div", "empty", "Abra as configurações (⚙) e escolha a pasta da sua biblioteca."));
    return;
  }
  if (view === "home" && !query.trim()) renderCards(box);
  else renderRows(box, visibleSounds());
  renderTitle();
}

// mantém o nome antigo usado pelo preview
function renderList() { renderContent(); }

function render() {
  if (view !== "home" && view !== VIEW_ALL && view !== VIEW_FAV && !categories().includes(view)) view = "home";
  renderNav();
  renderTitle();
  renderFilters();
  renderContent();
  fitContent();
}

// Garante que só a lista role: ajusta a altura da lista ao espaço livre do painel.
// (Reforço para o CSS flex, caso o UXP não calcule a altura sozinho.)
function fitContent() {
  try {
    const content = document.getElementById("content");
    const statusEl = document.getElementById("status");
    const top = content.getBoundingClientRect().top;
    const reserved = (statusEl ? statusEl.offsetHeight : 13) + 16; // status + espaçamentos
    const h = Math.max(60, Math.floor(window.innerHeight - top - reserved));
    content.style.height = h + "px";
    // Se a largura mudou o nº de colunas, redesenha a lista.
    const showingRows = !(view === "home" && !query.trim());
    if (showingRows && computeColumns(260) !== columns) renderContent();
  } catch (e) { /* o CSS cuida */ }
}
try { window.addEventListener("resize", fitContent); } catch (e) { /* ignora */ }
setInterval(fitContent, 1000); // painel redimensionado/encaixado sem evento de resize

function setupControls() {
  const track = document.getElementById("track");
  for (let i = 1; i <= MAX_TRACKS; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = "A" + i;
    track.appendChild(opt);
  }
  track.value = pref("track", String(DEFAULT_TRACK));
  track.addEventListener("change", () => setPref("track", track.value));

  const mode = document.getElementById("mode");
  mode.value = pref("placement", "auto");
  mode.addEventListener("change", () => setPref("placement", mode.value));

  const search = document.getElementById("search");
  search.addEventListener("input", () => { query = search.value || ""; renderFilters(); renderContent(); });

  const settings = document.getElementById("settings");
  const gear = document.getElementById("btnSettings");
  const toggleSettings = (open) => {
    const show = open === undefined ? settings.classList.contains("hidden") : open;
    if (show) { settings.classList.remove("hidden"); gear.classList.add("on"); }
    else { settings.classList.add("hidden"); gear.classList.remove("on"); }
  };
  gear.addEventListener("click", () => { toggleSettings(); fitContent(); });
  if (!pref("folderPath", null)) toggleSettings(true); // primeira vez: mostra as configurações

  document.getElementById("btnFolder").addEventListener("click", chooseFolder);
  document.getElementById("btnRefresh").addEventListener("click", () => {
    for (const s of sounds) delete durationCache[s.path];
    loadLibrary();
  });
}

// ---------------- preview (Source Monitor do Premiere) ----------------
// O painel UXP não tem um player de áudio documentado, então usamos o
// Source Monitor do Premiere: abre o arquivo lá e dá play. Não importa no projeto.
let previewingPath = null;

function sourceMonitor() {
  const sm = ppro.SourceMonitor || (ppro.core && ppro.core.SourceMonitor);
  if (!sm || typeof sm.openFilePath !== "function") {
    throw new Error("Source Monitor não disponível nesta versão do Premiere.");
  }
  return sm;
}

// Preview DENTRO do painel: tenta 2 jeitos com um <video> escondido
// (o UXP documenta <video>, mas não <audio>):
//   "file"  → src = file:///caminho
//   "data"  → lê o arquivo e usa src = data:audio/...;base64,...
// Se nenhum tocar, cai no Source Monitor ("monitor"), que já sabemos que funciona.
// O método que funcionar fica salvo para as próximas vezes.
const PANEL_PREVIEW = false; // experimental: tentar tocar dentro do painel antes do Source Monitor
let previewMethod = null;    // "file" | "data" | "monitor"
let previewingVia = null;

const MIME = { wav: "audio/wav", mp3: "audio/mpeg", aif: "audio/aiff", aiff: "audio/aiff",
               m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg" };

function player() {
  let v = document.getElementById("player");
  if (!v) {
    v = document.createElement("video");
    v.id = "player";
    v.style.width = "1px"; v.style.height = "1px"; v.style.opacity = "0";
    v.addEventListener("ended", () => { previewingPath = null; previewingVia = null; renderList(); });
    document.body.appendChild(v);
  }
  return v;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >> 6) & 63] : "=";
    out += "=";
  }
  return out;
}

// Toca src no <video> e confirma que está tocando de verdade (ou falha em ~2s).
function playInPanel(src) {
  return new Promise((resolve, reject) => {
    const v = player();
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      v.removeEventListener("error", onError);
      ok ? resolve() : reject(err);
    };
    const onError = () => finish(false, new Error("o player do painel recusou o arquivo"));
    v.addEventListener("error", onError);
    const started = Date.now();
    const timer = setInterval(() => {
      if (v.currentTime > 0.05) finish(true);
      else if (Date.now() - started > 2000) {
        try { v.pause(); } catch (e) { /* ignora */ }
        finish(false, new Error("o player do painel não começou a tocar"));
      }
    }, 100);
    try {
      v.src = src;
      try { v.currentTime = 0; } catch (e) { /* ignora */ }
      v.volume = 1;
      v.play();
    } catch (e) { finish(false, e); }
  });
}

async function previewInPanel(sound, method) {
  if (method === "file") {
    return playInPanel("file://" + sound.path.replace(/\\/g, "/"));
  }
  if (method === "data") {
    const { formats } = require("uxp").storage;
    const buf = await sound.entry.read({ format: formats.binary });
    const mime = MIME[ext(sound.name)] || "audio/wav";
    return playInPanel(`data:${mime};base64,${toBase64(buf)}`);
  }
  throw new Error("método desconhecido");
}

async function previewInMonitor(sound) {
  const sm = sourceMonitor();
  const opened = await sm.openFilePath(sound.path);
  if (!opened) throw new Error("o Source Monitor não abriu o arquivo (ele está baixado no computador?)");
  if (typeof sm.setPosition === "function" && ppro.TickTime) {
    try { await sm.setPosition(ppro.TickTime.createWithSeconds(0)); } catch (e) { /* opcional */ }
  }

  // Logo depois de abrir, o Source Monitor ainda pode estar carregando o arquivo e
  // ignorar o play. Então: dá play, confere se a posição andou; se não, tenta de novo.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const position = async () => {
    try { const t = await sm.getPosition(); return t ? t.seconds : null; } catch (e) { return null; }
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await position();
    await sm.play(1);
    await sleep(250);
    const after = await position();
    if (before === null || after === null) return;   // não dá para conferir: confia no play
    if (after > before + 0.01) return;               // está tocando
    if (previewingPath && previewingPath !== sound.path) return; // usuário já trocou de som
    await sleep(150 + attempt * 100);                // espera o arquivo terminar de carregar
  }
}

async function stopPreview() {
  if (!previewingPath) return;
  const via = previewingVia;
  previewingPath = null;
  previewingVia = null;
  try {
    if (via === "monitor") {
      const sm = sourceMonitor();
      // Velocidade 0 = pausa; se não funcionar, fecha o clipe no Source Monitor.
      let ok = false;
      try { ok = await sm.play(0); } catch (e) { ok = false; }
      if (!ok && typeof sm.closeClip === "function") await sm.closeClip();
    } else {
      const v = player();
      v.pause();
      try { v.currentTime = 0; } catch (e) { /* ignora */ }
    }
  } catch (e) {
    console.warn("Erro ao parar preview:", e);
  }
  renderList();
}

async function togglePreview(sound) {
  const wasThis = previewingPath === sound.path;
  await stopPreview();
  if (wasThis) { status(""); return; }

  // Começa pelo método que funcionou da última vez; se falhar, tenta os outros.
  // O preview dentro do painel ("file"/"data") foi desligado: no Premiere, com WAV, o player do
  // painel parecia tocar mas ficava mudo. Ligue PANEL_PREVIEW para testar de novo no futuro.
  const order = PANEL_PREVIEW
    ? [previewMethod, "file", "data", "monitor"].filter((m, i, a) => m && a.indexOf(m) === i)
    : ["monitor"];
  const problems = [];
  for (const method of order) {
    try {
      if (method === "monitor") await previewInMonitor(sound);
      else await previewInPanel(sound, method);
      previewMethod = method;
      previewingPath = sound.path;
      previewingVia = method;
      const where = method === "monitor" ? "no Source Monitor" : "no painel";
      status(`▶ Tocando "${stripExt(sound.name)}" ${where} (${method})`, "ok");
      renderList();
      return;
    } catch (e) {
      problems.push(`${method}: ${e.message || e}`);
    }
  }
  // Se o método salvo falhou (ex.: arquivo específico), tenta todos na próxima vez.
  previewMethod = null;
  status("Erro no preview — " + problems.join(" | "), "err");
  renderList();
}

// ---------------- Premiere: importar e colocar na timeline ----------------
function stripExt(name) { return name.replace(/\.[^.]+$/, ""); }

async function findInRoot(project, fileName) {
  const root = await project.getRootItem();
  const items = await root.getItems();
  return items.find(i => i.name === fileName || i.name === stripExt(fileName)) || null;
}

async function getOrImportItem(project, sound) {
  if (importedItems.has(sound.path)) return importedItems.get(sound.path);

  let item = await findInRoot(project, sound.name);
  if (!item) {
    const root = await project.getRootItem();
    const ok = await project.importFiles([sound.path], true, root, false);
    if (!ok) throw new Error("O Premiere não conseguiu importar o arquivo (ele está baixado no computador?).");
    for (let i = 0; i < 10 && !item; i++) {
      item = await findInRoot(project, sound.name);
      if (!item) await new Promise(r => setTimeout(r, 300));
    }
  }
  if (!item) throw new Error("Arquivo importado, mas não encontrado no projeto.");
  importedItems.set(sound.path, item);
  return item;
}


// ---------------- escolher a faixa livre ----------------
// Duração do som na timeline: pelo Premiere (mídia importada); senão a que lemos do arquivo; senão 5s.
async function soundLength(item, sound) {
  try {
    const clip = ppro.ClipProjectItem.cast(item);
    const media = await clip.getMedia();
    const d = media && media.getDuration ? (await media.getDuration()) : null;
    if (d && d.seconds > 0) return d.seconds;
  } catch (e) { /* tenta o próximo */ }
  if (sound.duration > 0) return sound.duration;
  return 5;
}

// Constantes da API: a referência mostra o objeto como "constants"; os tipos TypeScript como "Constants".
function apiConstants() { return ppro.Constants || ppro.constants || null; }

// Lista os clipes de uma faixa de áudio. Tenta o valor oficial de "CLIP" e, se não vier nada,
// pede todos os itens (incluindo vazios) e descarta os vazios.
async function clipsOnTrack(track) {
  const C = apiConstants();
  const T = C && C.TrackItemType;
  const tries = [];
  if (T && T.CLIP !== undefined) tries.push([T.CLIP, false]);
  tries.push([1, false]);
  if (T && T.EMPTY !== undefined) tries.push(["ALL", T.EMPTY]);
  for (const [type, extra] of tries) {
    try {
      if (type === "ALL") {
        // todos os tipos com itens vazios incluídos: descarta os itens "EMPTY"
        const list = (await track.getTrackItems(T.CLIP, true)) || [];
        const real = [];
        for (const it of list) {
          let t = null;
          try { t = it.getType ? await it.getType() : null; } catch (e) { t = null; }
          if (t !== extra) real.push(it);
        }
        if (real.length) return real;
      } else {
        const list = (await track.getTrackItems(type, false)) || [];
        if (list.length) return list;
      }
    } catch (e) { /* tenta o próximo jeito */ }
  }
  return [];
}

// Quantos clipes desta faixa se sobrepõem ao trecho [start, end] (segundos)?
async function overlapsOnTrack(track, start, end) {
  const items = await clipsOnTrack(track);
  let overlaps = 0;
  for (const it of items) {
    const a = (await it.getStartTime()).seconds;
    const b = (await it.getEndTime()).seconds;
    if (a < end - 0.001 && b > start + 0.001) overlaps++;
  }
  return { total: items.length, overlaps };
}

// Procura, a partir da faixa escolhida e descendo na timeline (A3, A4, A5…),
// a primeira faixa sem nenhum clipe no trecho. Se todas estiverem ocupadas, cria uma faixa nova.
// "log" guarda o que foi visto em cada faixa (aparece na linha de status).
async function findFreeAudioTrack(sequence, firstIdx, start, end) {
  const count = await sequence.getAudioTrackCount();
  const log = [];
  for (let i = Math.max(0, firstIdx); i < count; i++) {
    const track = await sequence.getAudioTrack(i);
    if (!track) continue;
    const r = await overlapsOnTrack(track, start, end);
    log.push(`A${i + 1}: ${r.total} clipes${r.overlaps ? " (ocupada)" : ""}`);
    if (!r.overlaps) return { index: i, isNew: false, log };
  }
  return { index: Math.max(count, firstIdx), isNew: true, log };
}

let busy = false;
async function placeSound(sound, row) {
  if (busy) { status("Aguarde: ainda colocando o som anterior…"); return; }
  busy = true;
  row.classList.add("busy");
  let step = "início";
  try {
    status(`Colocando "${stripExt(sound.name)}" na timeline…`);
    step = "parar preview";
    // Não deixa um preview "travado" impedir a inserção.
    await Promise.race([stopPreview(), new Promise(r => setTimeout(r, 1500))]);
    const trackNumber = parseInt(document.getElementById("track").value, 10) || DEFAULT_TRACK;
    const videoIdx = 0;
    const mode = document.getElementById("mode").value; // auto | overwrite | insert

    step = "abrir projeto";
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto aberto.");
    step = "achar sequência";
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Abra uma sequência na timeline.");

    step = "importar arquivo";
    const item = await getOrImportItem(project, sound);
    step = "ler playhead";
    const time = await sequence.getPlayerPosition();

    // Faixa: índice começa em 0 (A1 = 0), confirmado no teste da Fase 0.
    let audioIdx = trackNumber - 1;
    let newTrack = false;
    let trackLog = "";
    if (mode === "auto") {
      step = "procurar faixa livre";
      const len = await soundLength(item, sound);
      const found = await findFreeAudioTrack(sequence, audioIdx, time.seconds, time.seconds + len);
      audioIdx = found.index;
      newTrack = found.isNew;
      trackLog = found.log.join(" · ");
    }

    step = "preparar edição";
    const editor = ppro.SequenceEditor.getEditor(sequence);

    step = "aplicar na timeline";
    let success = false;
    project.lockedAccess(() => {
      // Faixa nova: usa "insert" (a API documenta que cria a faixa se o índice não existir),
      // com limitShift = true para não empurrar nada nas outras faixas.
      const action = mode === "insert" || newTrack
        ? editor.createInsertProjectItemAction(item, time, videoIdx, audioIdx, mode !== "insert")
        : editor.createOverwriteItemAction(item, time, videoIdx, audioIdx);
      success = project.executeTransaction((compound) => {
        compound.addAction(action);
      }, "Sound Library: " + stripExt(sound.name));
    });

    const where = `A${audioIdx + 1}${newTrack ? " (faixa nova)" : ""}`;
    if (success) status(`✅ "${stripExt(sound.name)}" em ${where} · ${time.seconds.toFixed(2)}s${trackLog ? "  [" + trackLog + "]" : ""}`, "ok");
    else status("O Premiere não aplicou a ação.", "err");
  } catch (e) {
    // Se o item em cache ficou inválido (ex.: removido do projeto), tenta de novo na próxima.
    importedItems.delete(sound.path);
    status(`Erro (${step}): ${e.message || e}`, "err");
  } finally {
    row.classList.remove("busy");
    busy = false;
  }
}

// ---------------- início ----------------
setupControls();
render();
restoreFolder();
