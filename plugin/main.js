// Fase 0 — prova de conceito:
// escolher um arquivo de áudio, importar no projeto e colocar na timeline no playhead.

const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let pickedFile = null; // arquivo escolhido pelo usuário

// ---------- log na tela ----------
function log(msg, cls) {
  const el = document.getElementById("log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
}

// ---------- 1. escolher arquivo ----------
async function pickFile() {
  try {
    const file = await localFileSystem.getFileForOpening();
    if (!file) { log("Seleção cancelada."); return; }
    pickedFile = file;
    document.getElementById("file").textContent = file.nativePath;
    log(`Arquivo escolhido: ${file.name}`, "ok");
  } catch (e) {
    log(`Erro ao escolher arquivo: ${e.message || e}`, "err");
  }
}

// ---------- utilitários ----------
function stripExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

// Procura, na raiz do projeto, um item com esse nome (com ou sem extensão).
// (Na Fase 0 importamos sempre na raiz; organização em bins vem depois.)
async function findItemByName(folder, fileName) {
  const items = await folder.getItems();
  for (const item of items) {
    if (item.name === fileName || item.name === stripExt(fileName)) return item;
  }
  return null;
}

// Importa o arquivo (se ainda não estiver no projeto) e devolve o ProjectItem.
async function getOrImportItem(project, file) {
  const root = await project.getRootItem();

  let item = await findItemByName(root, file.name);
  if (item) { log(`Já estava no projeto: "${item.name}"`); return item; }

  log("Importando para o projeto…");
  const ok = await project.importFiles([file.nativePath], true, root, false);
  log(`importFiles retornou: ${ok}`);

  // A importação pode levar um instante — tentamos achar o item algumas vezes.
  for (let i = 0; i < 10; i++) {
    item = await findItemByName(root, file.name);
    if (item) { log(`Item importado: "${item.name}"`, "ok"); return item; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("O arquivo foi importado, mas não encontrei o item no projeto.");
}

// ---------- 2. colocar na timeline ----------
async function placeAtPlayhead(mode) {
  try {
    if (!pickedFile) { log("Escolha um arquivo primeiro.", "err"); return; }

    const audioIdx = parseInt(document.getElementById("audioTrack").value, 10) || 0;
    const videoIdx = parseInt(document.getElementById("videoTrack").value, 10) || 0;

    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto aberto.");

    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Nenhuma sequência ativa. Abra uma sequência na timeline.");

    const item = await getOrImportItem(project, pickedFile);
    const time = await sequence.getPlayerPosition();
    log(`Playhead em ${time.seconds.toFixed(2)}s · faixa áudio ${audioIdx} · vídeo ${videoIdx} · modo ${mode}`);

    const editor = ppro.SequenceEditor.getEditor(sequence);

    let success = false;
    project.lockedAccess(() => {
      const action = mode === "insert"
        ? editor.createInsertProjectItemAction(item, time, videoIdx, audioIdx, false)
        : editor.createOverwriteItemAction(item, time, videoIdx, audioIdx);

      success = project.executeTransaction((compoundAction) => {
        compoundAction.addAction(action);
      }, "Sound Library: inserir áudio");
    });

    if (success) log("✅ Pronto! Confira a timeline.", "ok");
    else log("executeTransaction retornou false (não aplicou).", "err");
  } catch (e) {
    log(`Erro: ${e.message || e}`, "err");
    console.error(e);
  }
}

document.getElementById("btnPick").addEventListener("click", pickFile);
document.getElementById("btnOverwrite").addEventListener("click", () => placeAtPlayhead("overwrite"));
document.getElementById("btnInsert").addEventListener("click", () => placeAtPlayhead("insert"));

log("Painel carregado. Abra um projeto com uma sequência e siga os passos 1 e 2.");
