// Sound Library — Fase 1
// Escolher a pasta da biblioteca, listar os sons por categoria (subpastas),
// buscar por nome e clicar para colocar na timeline no playhead.

const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

// ---------------- configuração ----------------
const AUDIO_EXT = ["wav", "mp3", "aif", "aiff", "m4a", "aac", "flac", "ogg"];
// Pastas cujo nome contém uma destas palavras viram a aba ⭐ Favoritos
const FAVORITE_HINTS = ["preferid", "favorit"];
const MAX_TRACKS = 8;          // opções A1…A8 no seletor de faixa
const DEFAULT_TRACK = 3;       // A3
const TAB_ALL = "__all__";
const TAB_FAV = "__fav__";

// ---------------- estado ----------------
let rootFolder = null;   // Folder (UXP) da biblioteca
let sounds = [];         // [{ name, path, category, favorite }]
let activeTab = TAB_ALL;
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
    sounds = found;
    document.getElementById("libPath").textContent = rootFolder.nativePath;
    status(`${sounds.length} sons encontrados.`, "ok");
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

// ---------------- interface ----------------
function categories() {
  const set = new Set(sounds.filter(s => !s.favorite).map(s => s.category));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));
}

function visibleSounds() {
  const q = query.trim().toLowerCase();
  return sounds.filter(s => {
    if (activeTab === TAB_FAV && !s.favorite) return false;
    if (activeTab !== TAB_ALL && activeTab !== TAB_FAV && s.category !== activeTab) return false;
    if (q && !s.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.innerHTML = "";
  const favCount = sounds.filter(s => s.favorite).length;
  const defs = [{ id: TAB_ALL, label: `Todos (${sounds.length})` }];
  if (favCount) defs.push({ id: TAB_FAV, label: `⭐ Favoritos (${favCount})` });
  for (const c of categories()) {
    defs.push({ id: c, label: `${c} (${sounds.filter(s => s.category === c).length})` });
  }
  if (!defs.some(d => d.id === activeTab)) activeTab = TAB_ALL;
  for (const d of defs) {
    const el = document.createElement("div");
    el.className = "tab" + (d.id === activeTab ? " active" : "");
    el.textContent = d.label;
    el.addEventListener("click", () => { activeTab = d.id; render(); });
    tabs.appendChild(el);
  }
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  if (!rootFolder) {
    list.innerHTML = '<div class="empty">Escolha a pasta da sua biblioteca (ex.: "Sounds fx" no Google Drive).</div>';
    return;
  }
  const items = visibleSounds();
  if (!items.length) {
    list.innerHTML = '<div class="empty">Nenhum som encontrado.</div>';
    return;
  }
  for (const s of items) {
    const row = document.createElement("div");
    row.className = "item";
    row.title = s.path;

    // Botão de preview ▶ / ■ (não insere na timeline)
    const play = document.createElement("div");
    play.className = "play" + (previewingPath === s.path ? " playing" : "");
    play.textContent = previewingPath === s.path ? "■" : "▶";
    play.title = "Ouvir (preview)";
    play.addEventListener("click", (ev) => {
      ev.stopPropagation();
      togglePreview(s);
    });
    row.appendChild(play);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name.replace(/\.[^.]+$/, "");
    row.appendChild(name);
    if (activeTab === TAB_ALL || activeTab === TAB_FAV) {
      const cat = document.createElement("span");
      cat.className = "cat";
      cat.textContent = s.favorite ? "⭐" : s.category;
      row.appendChild(cat);
    }
    row.addEventListener("click", () => placeSound(s, row));
    list.appendChild(row);
  }
}

function render() {
  renderTabs();
  renderList();
}

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
  mode.value = pref("mode", "overwrite");
  mode.addEventListener("change", () => setPref("mode", mode.value));

  const search = document.getElementById("search");
  search.addEventListener("input", () => { query = search.value || ""; renderList(); });

  document.getElementById("btnFolder").addEventListener("click", chooseFolder);
  document.getElementById("btnRefresh").addEventListener("click", loadLibrary);
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
  await sm.play(1);
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
  const order = [previewMethod, "file", "data", "monitor"].filter((m, i, a) => m && a.indexOf(m) === i);
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

let busy = false;
async function placeSound(sound, row) {
  if (busy) return;
  busy = true;
  row.classList.add("busy");
  try {
    await stopPreview();
    const trackNumber = parseInt(document.getElementById("track").value, 10) || DEFAULT_TRACK;
    const audioIdx = trackNumber - 1;          // A1 = índice 0 (confirmado no teste da Fase 0)
    const videoIdx = 0;
    const mode = document.getElementById("mode").value;

    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto aberto.");
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Abra uma sequência na timeline.");

    const item = await getOrImportItem(project, sound);
    const time = await sequence.getPlayerPosition();
    const editor = ppro.SequenceEditor.getEditor(sequence);

    let success = false;
    project.lockedAccess(() => {
      const action = mode === "insert"
        ? editor.createInsertProjectItemAction(item, time, videoIdx, audioIdx, false)
        : editor.createOverwriteItemAction(item, time, videoIdx, audioIdx);
      success = project.executeTransaction((compound) => {
        compound.addAction(action);
      }, "Sound Library: " + stripExt(sound.name));
    });

    if (success) status(`✅ "${stripExt(sound.name)}" em A${trackNumber} · ${time.seconds.toFixed(2)}s`, "ok");
    else status("O Premiere não aplicou a ação.", "err");
  } catch (e) {
    // Se o item em cache ficou inválido (ex.: removido do projeto), tenta de novo na próxima.
    importedItems.delete(sound.path);
    status(`Erro: ${e.message || e}`, "err");
  } finally {
    row.classList.remove("busy");
    busy = false;
  }
}

// ---------------- início ----------------
setupControls();
render();
restoreFolder();
