import {
  db, auth, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, serverTimestamp,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase.js";

const $ = (id) => document.getElementById(id);

// IMPORTANTE: não coloque chave da Anthropic aqui.
// Depois de publicar a Firebase Function, cole SOMENTE a URL dela abaixo.
// Exemplo: https://us-central1-SEU-PROJETO.cloudfunctions.net/agendaAi
const AI_FUNCTION_URL = "";

let clients = [], agendasCache = [], currentAgenda = null, lastIncompleteAgenda = null, busy = false, appLoaded = false;
let importCandidates = [], importBusy = false;
let voiceModeActive = false, activeRecognition = null, voiceModeTimer = null;

function normalize(text = "") { return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function usernameToEmail(username) { return `${normalize(username)}@agenda.local`; }
function todayBR() { return new Date().toLocaleDateString("pt-BR"); }
function escapeHTML(text = "") { return text.toString().replace(/[&<>'"]/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[ch])); }
function cleanPhone(text = "") { return String(text || "").replace(/[^0-9+()\-\s]/g, "").trim(); }
function sameClient(a = {}, b = {}) { return normalize(a.nome) === normalize(b.nome) && normalize(a.cidade) === normalize(b.cidade); }
function dedupeClientList(list = []) {
  const seen = new Set();
  return list.filter((c) => {
    const key = `${normalize(c.nome)}|${normalize(c.cidade)}|${normalize(c.endereco)}`;
    if (!c.nome || !c.cidade || !c.endereco || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function extractCity(command) {
  const text = normalize(command);
  for (const pattern of [/para\s+(.+)$/, /cidade\s+(.+)$/, /em\s+(.+)$/]) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace("amanha", "").replace("hoje", "").replace("agenda", "").trim();
  }
  return prompt("Qual cidade?");
}
function extractClientName(command) {
  const text = normalize(command);
  return text.replace("escolher cliente", "").replace("visitar somente cliente", "").replace("visitar cliente", "")
    .replace("comecar por", "").replace("começar por", "").replace("cliente especifico", "").replace("cliente específico", "").trim();
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.remove("hidden");
  clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}
function speak(text) {
  if (!text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "pt-BR"; utterance.rate = 1.04; utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}
function addAiMessage(who, text) {
  const box = $("aiChatLog"); if (!box || !text) return;
  const div = document.createElement("div");
  div.className = `ai-msg ${who === "user" ? "user" : "assistant"}`;
  div.innerHTML = `<strong>${who === "user" ? "Você" : "IA"}</strong><span>${escapeHTML(text)}</span>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}
async function lock(fn, okMessage = "") {
  if (busy) return; busy = true; document.querySelectorAll("button").forEach((btn) => (btn.disabled = true));
  try { await fn(); if (okMessage) toast(okMessage); }
  catch (err) {
    console.error(err); const code = err.code || "";
    if (code.includes("permission-denied")) alert("Permissão negada. Confirme se você está logado como Ricardo e se as regras definitivas foram publicadas.");
    else if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password") || code.includes("auth/user-not-found")) alert("Usuário ou senha incorretos.");
    else alert("Falha: " + (err.message || err));
  } finally { busy = false; document.querySelectorAll("button").forEach((btn) => (btn.disabled = false)); }
}
async function login(e) {
  e.preventDefault();
  await lock(async () => {
    const user = $("loginUser").value.trim(), pass = $("loginPass").value.trim();
    if (!user || !pass) return alert("Informe usuário e senha.");
    await signInWithEmailAndPassword(auth, usernameToEmail(user), pass);
  }, "Login realizado");
}
async function logout() {
  stopVoiceMode(false); await signOut(auth); appLoaded = false; currentAgenda = null; clients = []; agendasCache = [];
  $("appShell").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); toast("Você saiu");
}
async function loadClients() { const snap = await getDocs(collection(db, "clientes")); clients = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderClients(); }
async function loadCurrentAgenda() { const snap = await getDoc(doc(db, "agenda_atual", "ricardo")); currentAgenda = snap.exists() ? snap.data() : null; renderCurrent(); }
async function loadAgendas() {
  const snap = await getDocs(collection(db, "agendas"));
  const agendas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0));
  agendasCache = agendas;
  lastIncompleteAgenda = agendas.find((a) => a.status === "incompleta" || a.status === "andamento") || null;
  renderAgendas(agendas);
}
function renderClients() {
  const list = $("clientList");
  if (!clients.length) { list.innerHTML = `<div class="item"><div class="item-title">Nenhum cliente cadastrado</div><div class="item-meta">Cadastre clientes dentro do app para organizar por cidade.</div></div>`; return; }
  list.innerHTML = clients.slice(0, 8).map((c) => `<div class="item"><div class="item-title">${escapeHTML(c.nome || "Sem nome")}</div><div class="item-meta">${escapeHTML(c.cidade || "")} • ${escapeHTML(c.endereco || "")}</div>${c.telefone ? `<div class="item-meta">📞 ${escapeHTML(c.telefone)}</div>` : ""}</div>`).join("");
}
function renderCurrent() {
  const name = $("currentClientName"), meta = $("currentClientMeta"), progress = $("progressText"), fill = $("progressFill");
  if (!currentAgenda) { name.textContent = "Nenhuma agenda iniciada"; meta.textContent = "Clique no microfone e diga: organizar agenda de amanhã para Pato Branco."; progress.textContent = "0/0 concluídas"; fill.style.width = "0%"; return; }
  const client = currentAgenda.clientes?.[currentAgenda.indiceAtual] || null;
  name.textContent = client ? client.nome : "Agenda sem próximo cliente";
  meta.textContent = client ? `${currentAgenda.cidade} • ${client.endereco || "Endereço não informado"}` : `${currentAgenda.cidade} • ${currentAgenda.status}`;
  progress.textContent = `${currentAgenda.concluidos}/${currentAgenda.total} concluídas`;
  fill.style.width = `${currentAgenda.total ? Math.min(100, (currentAgenda.concluidos / currentAgenda.total) * 100) : 0}%`;
}
function renderAgendas(agendas) {
  const list = $("agendaList");
  if (!agendas.length) { list.innerHTML = `<div class="item"><div class="item-title">Nenhuma agenda salva ainda</div><div class="item-meta">As agendas aparecerão aqui após serem criadas.</div></div>`; return; }
  list.innerHTML = agendas.map((a) => {
    const status = a.status === "concluida" ? "concluída" : a.status;
    return `<div class="item" data-agenda="${a.id}">
      <div class="item-title">${escapeHTML(a.cidade)} — ${escapeHTML(a.dataLabel || todayBR())} — ${a.concluidos}/${a.total} concluídas</div>
      <div class="item-meta">${escapeHTML(status || "")}</div>
      <div class="details hidden" id="details-${a.id}">
        ${(a.clientes || []).map((c, idx) => {
          const done = (a.visitados || []).includes(c.id) || idx < (a.indiceAtual || 0), atual = idx === a.indiceAtual && a.status !== "concluida";
          return `<div>${done ? "✅" : atual ? "📍" : "⬜"} ${idx + 1}. ${escapeHTML(c.nome)} — ${escapeHTML(c.endereco || "")}</div>`;
        }).join("")}
      </div>
      <div class="item-actions">
        <button onclick="toggleAgendaDetails('${a.id}')" class="secondary-btn">Mostrar mais / menos</button>
        <button onclick="continueAgenda('${a.id}')" class="primary-btn">Continuar</button>
        <button onclick="restartAgenda('${a.id}')" class="secondary-btn">Reiniciar</button>
        <button onclick="chooseStartClient('${a.id}')" class="secondary-btn">Escolher cliente</button>
        <button onclick="deleteAgenda('${a.id}')" class="danger-btn">Excluir</button>
        <button onclick="editAgenda('${a.id}')" class="secondary-btn">Editar</button>
      </div></div>`;
  }).join("");
}
async function saveAgenda(agenda) {
  const id = agenda.id || `agenda_${normalize(agenda.cidade).replace(/\s+/g, "_")}_${Date.now()}`;
  const payload = { ...agenda, id, updatedAtMillis: Date.now(), ownerEmail: auth.currentUser?.email || "ricardo@agenda.local" };
  await setDoc(doc(db, "agendas", id), payload);
  await setDoc(doc(db, "agenda_atual", "ricardo"), payload);
  currentAgenda = payload; await loadAgendas(); renderCurrent();
}
async function createAgendaByCity(city, options = {}) {
  city = normalize(city); if (!city) return alert("Cidade não informada.");
  await loadClients();
  const cityClients = clients.filter((c) => normalize(c.cidade) === city).sort((a, b) => normalize(a.bairro || a.endereco || a.nome).localeCompare(normalize(b.bairro || b.endereco || b.nome)));
  if (!cityClients.length) return alert(`Nenhum cliente cadastrado para ${city}.`);
  const existing = await findIncompleteByCity(city);
  if (existing && !options.forceNew) { showResumeModal(existing); return; }
  let ordered = cityClients;
  if (options.firstClientName) ordered = moveClientToPosition(ordered, options.firstClientName, "first");
  if (options.lastClientName) ordered = moveClientToPosition(ordered, options.lastClientName, "last");
  const agenda = { id:`agenda_${city.replace(/\s+/g, "_")}_${Date.now()}`, cidade, dataLabel:options.dataLabel || todayBR(), clientes:ordered, indiceAtual:options.startIndex || 0, concluidos:0, visitados:[], total:ordered.length, status:"andamento", createdAtMillis:Date.now(), ownerEmail:auth.currentUser?.email || "ricardo@agenda.local" };
  await saveAgenda(agenda); toast(`Agenda criada para ${city}: 0/${ordered.length}`);
}
function moveClientToPosition(list, name, position) {
  const idx = list.findIndex((c) => normalize(c.nome).includes(normalize(name)));
  if (idx < 0) return list;
  const copy = [...list]; const [item] = copy.splice(idx, 1);
  if (position === "first") copy.unshift(item); else copy.push(item);
  return copy;
}
async function findIncompleteByCity(city) {
  const snap = await getDocs(collection(db, "agendas"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => normalize(a.cidade) === normalize(city) && (a.status === "incompleta" || a.status === "andamento")).sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0))[0] || null;
}
function showResumeModal(agenda) { lastIncompleteAgenda = agenda; $("resumeText").textContent = `Você tem uma agenda incompleta para ${agenda.cidade}: ${agenda.concluidos}/${agenda.total} concluídas em ${agenda.dataLabel || todayBR()}.`; $("resumeModal").classList.remove("hidden"); }
function closeResumeModal() { $("resumeModal").classList.add("hidden"); }
async function openCurrentMap() {
  if (!currentAgenda) return alert("Nenhuma agenda ativa.");
  const client = currentAgenda.clientes?.[currentAgenda.indiceAtual]; if (!client) return alert("Nenhum cliente atual.");
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.endereco || client.nome)}`, "_blank");
}
async function startFirstClient() { if (!currentAgenda) return alert("Organize uma agenda primeiro."); currentAgenda.indiceAtual = currentAgenda.indiceAtual || 0; currentAgenda.status = "andamento"; await saveAgenda(currentAgenda); renderCurrent(); toast("Primeiro cliente em andamento"); await openCurrentMap(); }
async function nextClient() {
  if (!currentAgenda) return alert("Nenhuma agenda ativa.");
  const prev = currentAgenda.clientes?.[currentAgenda.indiceAtual];
  if (prev && !(currentAgenda.visitados || []).includes(prev.id)) currentAgenda.visitados = [...(currentAgenda.visitados || []), prev.id];
  currentAgenda.concluidos = Math.min((currentAgenda.concluidos || 0) + 1, currentAgenda.total || 0);
  currentAgenda.indiceAtual = (currentAgenda.indiceAtual || 0) + 1;
  if (currentAgenda.indiceAtual >= currentAgenda.total) { currentAgenda.status = "concluida"; await saveAgenda(currentAgenda); toast("Agenda concluída"); return; }
  currentAgenda.status = "andamento"; await saveAgenda(currentAgenda); toast("Próximo cliente aberto"); await openCurrentMap();
}
async function skipClient() { if (!currentAgenda) return alert("Nenhuma agenda ativa."); currentAgenda.indiceAtual = Math.min((currentAgenda.indiceAtual || 0) + 1, (currentAgenda.total || 1) - 1); currentAgenda.status = "andamento"; await saveAgenda(currentAgenda); toast("Cliente pulado"); }
async function finishDay() { if (!currentAgenda) return alert("Nenhuma agenda ativa."); currentAgenda.status = currentAgenda.concluidos >= currentAgenda.total ? "concluida" : "incompleta"; await saveAgenda(currentAgenda); toast(`${currentAgenda.cidade} — ${currentAgenda.concluidos}/${currentAgenda.total} — ${currentAgenda.status}`); }
async function chooseClientByName(name, only = false) {
  if (!name) name = prompt("Nome do cliente?"); if (!name) return; await loadClients();
  const pool = currentAgenda?.clientes?.length ? currentAgenda.clientes : clients;
  const found = pool.find((c) => normalize(c.nome).includes(normalize(name))); if (!found) return alert("Cliente não encontrado.");
  if (only || !currentAgenda) {
    await saveAgenda({ id:`agenda_cliente_${Date.now()}`, cidade:found.cidade || "cliente específico", dataLabel:todayBR(), clientes:[found], indiceAtual:0, concluidos:0, visitados:[], total:1, status:"andamento", createdAtMillis:Date.now(), ownerEmail:auth.currentUser?.email || "ricardo@agenda.local" });
  } else {
    const idx = currentAgenda.clientes.findIndex((c) => c.id === found.id || normalize(c.nome) === normalize(found.nome));
    if (idx >= 0) { currentAgenda.indiceAtual = idx; currentAgenda.status = "andamento"; await saveAgenda(currentAgenda); }
  }
  toast("Cliente selecionado"); await openCurrentMap();
}
async function addClientQuick(data = {}) {
  const payload = { nome:(data.nome || "").trim(), cidade:(data.cidade || "").trim(), endereco:(data.endereco || "").trim(), telefone:(data.telefone || "").trim(), observacoes:(data.observacoes || "").trim(), ownerEmail:auth.currentUser?.email || "ricardo@agenda.local", createdAtMillis:Date.now(), createdAt:serverTimestamp() };
  if (!payload.nome || !payload.cidade || !payload.endereco) return alert("Para cadastrar por voz, informe nome, cidade e endereço.");
  await addDoc(collection(db, "clientes"), payload); await loadClients(); toast("Cliente cadastrado pela IA");
}
function summarizeStatus() {
  if (!currentAgenda) return "Nenhuma agenda ativa no momento.";
  const remaining = (currentAgenda.clientes || []).slice(currentAgenda.indiceAtual || 0).map((c) => c.nome).join(", ") || "ninguém";
  return `Agenda atual em ${currentAgenda.cidade}: ${currentAgenda.concluidos}/${currentAgenda.total} concluídas. Faltam: ${remaining}.`;
}
async function handleSimpleCommand(command) {
  const text = normalize(command); toast(`Comando: ${command}`);
  if (text.includes("organizar agenda") || text.includes("montar agenda") || text.includes("criar agenda")) return await createAgendaByCity(extractCity(command));
  if (text.includes("visitar primeiro cliente") || text.includes("primeiro cliente")) return await startFirstClient();
  if (text.includes("proximo cliente") || text.includes("próximo cliente")) return await nextClient();
  if (text.includes("pular cliente")) return await skipClient();
  if (text.includes("finalizar")) return await finishDay();
  if (text.includes("abrir mapa") || text.includes("abrir gps") || text.includes("rota")) return await openCurrentMap();
  if (text.includes("visitar somente cliente")) return await chooseClientByName(extractClientName(command), true);
  if (text.includes("escolher cliente") || text.includes("comecar por") || text.includes("começar por")) return await chooseClientByName(extractClientName(command), false);
  if (text.includes("quem falta") || text.includes("faltam") || text.includes("resumo")) { const msg = summarizeStatus(); addAiMessage("assistant", msg); speak(msg); return; }
  throw new Error("simple-command-not-found");
}
async function getAiContext() {
  await loadClients(); await loadAgendas();
  return {
    hoje: todayBR(),
    usuario: auth.currentUser?.email || "ricardo@agenda.local",
    clientes: clients.slice(0, 250).map((c) => ({ id:c.id, nome:c.nome, cidade:c.cidade, endereco:c.endereco, telefone:c.telefone, observacoes:c.observacoes })),
    agendaAtual: currentAgenda ? { cidade:currentAgenda.cidade, dataLabel:currentAgenda.dataLabel, indiceAtual:currentAgenda.indiceAtual, concluidos:currentAgenda.concluidos, total:currentAgenda.total, status:currentAgenda.status, clientes:(currentAgenda.clientes || []).map((c) => ({ id:c.id, nome:c.nome, cidade:c.cidade, endereco:c.endereco })) } : null,
    agendasRecentes: agendasCache.slice(0, 10).map((a) => ({ id:a.id, cidade:a.cidade, dataLabel:a.dataLabel, concluidos:a.concluidos, total:a.total, status:a.status }))
  };
}
async function callAgendaAi(command) {
  if (!AI_FUNCTION_URL) throw new Error("ai-url-not-configured");
  const token = await auth.currentUser?.getIdToken?.();
  const response = await fetch(AI_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ command, context: await getAiContext() })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Falha ao consultar IA.");
  return data;
}
async function executeAiAction(result = {}) {
  const reply = result.reply || "Certo.";
  const action = result.action || { type: "none" };
  addAiMessage("assistant", reply); speak(reply);
  switch (action.type) {
    case "create_agenda_by_city": return await createAgendaByCity(action.city, { firstClientName: action.firstClientName, lastClientName: action.lastClientName, forceNew: !!action.forceNew, dataLabel: action.dataLabel });
    case "start_first_client": return await startFirstClient();
    case "next_client": return await nextClient();
    case "skip_client": return await skipClient();
    case "finish_day": return await finishDay();
    case "open_map": return await openCurrentMap();
    case "choose_client": return await chooseClientByName(action.clientName, false);
    case "only_client": return await chooseClientByName(action.clientName, true);
    case "add_client": return await addClientQuick(action.client || {});
    case "show_summary": return;
    case "none": default: return;
  }
}

function setImportStatus(message, isError = false) {
  const el = $("importStatus"); if (!el) return;
  el.textContent = message || "";
  el.className = `import-status ${message ? "" : "hidden"} ${isError ? "error" : ""}`;
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler texto."));
    reader.readAsText(file, "UTF-8");
  });
}
function splitCsvLine(line = "") {
  const out = []; let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if ((ch === "," || ch === ";" || ch === "\t") && !quoted) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim()); return out;
}
function parseClientTextLocally(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 100);
  const clientsParsed = [];
  for (const line of lines) {
    if (/^nome\s*[,;\t]/i.test(line)) continue;
    const parts = splitCsvLine(line).filter(Boolean);
    if (parts.length >= 3) {
      clientsParsed.push({ nome: parts[0] || "", cidade: parts[1] || "", endereco: parts[2] || "", telefone: cleanPhone(parts[3] || ""), observacoes: parts.slice(4).join(" - ") });
    }
  }
  return dedupeClientList(clientsParsed).slice(0, 80);
}
async function callImportAi(payload) {
  if (!AI_FUNCTION_URL) throw new Error("ai-url-not-configured");
  const token = await auth.currentUser?.getIdToken?.();
  const response = await fetch(AI_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ importClients: true, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Falha ao importar com IA.");
  return data;
}
async function analyzeImport() {
  if (importBusy) return;
  importBusy = true;
  const btn = $("btnAnalyzeImport"); if (btn) btn.disabled = true;
  try {
    importCandidates = [];
    renderImportPreview([]);
    const text = ($("importText")?.value || "").trim();
    const file = $("importFile")?.files?.[0] || null;
    if (!text && !file) return setImportStatus("Envie um arquivo ou cole uma lista primeiro.", true);
    if (file && file.size > 4 * 1024 * 1024) return setImportStatus("Arquivo muito grande. Envie até 4 MB para manter custo baixo.", true);
    setImportStatus("Analisando lista...");

    let result = [];
    if (file && /text|csv|plain/i.test(file.type || file.name)) {
      const fileText = await readFileAsText(file);
      result = parseClientTextLocally(fileText);
      if (!result.length && AI_FUNCTION_URL) {
        const ai = await callImportAi({ text: fileText.slice(0, 16000), fileName: file.name, mimeType: file.type || "text/plain" });
        result = ai.clients || [];
      }
    } else if (!file && text) {
      result = parseClientTextLocally(text);
      if ((!result.length || result.length < 2) && AI_FUNCTION_URL) {
        const ai = await callImportAi({ text: text.slice(0, 16000), fileName: "lista-colada.txt", mimeType: "text/plain" });
        result = ai.clients || [];
      }
    } else if (file) {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.split(",")[1] || "";
      const ai = await callImportAi({ fileBase64: base64, fileName: file.name, mimeType: file.type || "application/octet-stream", extraText: text.slice(0, 6000) });
      result = ai.clients || [];
    }

    await loadClients();
    const cleaned = dedupeClientList((result || []).map((c) => ({
      nome: String(c.nome || c.name || "").trim(),
      cidade: String(c.cidade || c.city || "").trim(),
      endereco: String(c.endereco || c.address || "").trim(),
      telefone: cleanPhone(c.telefone || c.phone || ""),
      observacoes: String(c.observacoes || c.notes || "").trim()
    }))).slice(0, 80);
    importCandidates = cleaned.map((c) => ({ ...c, duplicate: clients.some((old) => sameClient(old, c)) }));
    if (!importCandidates.length) return setImportStatus("Não encontrei clientes completos. Tente enviar CSV com Nome, Cidade e Endereço ou uma foto mais nítida.", true);
    setImportStatus(`Encontrei ${importCandidates.length} cliente(s). Confira antes de salvar.`);
    renderImportPreview(importCandidates);
  } catch (err) {
    console.error(err);
    setImportStatus(err.message === "ai-url-not-configured" ? "IA ainda não conectada. Para imagem/PDF precisa publicar a Firebase Function e configurar a URL." : (err.message || "Falha ao analisar."), true);
  } finally {
    importBusy = false;
    if (btn) btn.disabled = false;
  }
}
function renderImportPreview(list = importCandidates) {
  const box = $("importPreview"); if (!box) return;
  if (!list.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const rows = list.map((c, i) => `
    <tr class="${c.duplicate ? "dup" : ""}">
      <td>${i + 1}</td><td>${escapeHTML(c.nome)}</td><td>${escapeHTML(c.cidade)}</td><td>${escapeHTML(c.endereco)}</td><td>${escapeHTML(c.telefone || "-")}</td><td>${c.duplicate ? "Já existe" : "Novo"}</td>
    </tr>`).join("");
  const novos = list.filter((c) => !c.duplicate).length;
  box.innerHTML = `<div class="preview-head"><strong>Prévia da importação</strong><span>${novos} novo(s), ${list.length - novos} duplicado(s)</span></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Nome</th><th>Cidade</th><th>Endereço</th><th>Telefone</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <button id="btnConfirmImport" class="primary-btn" type="button">✅ Confirmar e cadastrar ${novos} cliente(s)</button>`;
  box.classList.remove("hidden");
  $("btnConfirmImport")?.addEventListener("click", () => lock(confirmImportClients));
}
async function confirmImportClients() {
  const toSave = importCandidates.filter((c) => !c.duplicate).slice(0, 80);
  if (!toSave.length) return alert("Não há clientes novos para salvar.");
  if (!confirm(`Cadastrar ${toSave.length} cliente(s) agora?`)) return;
  for (const c of toSave) {
    await addDoc(collection(db, "clientes"), { ...c, ownerEmail:auth.currentUser?.email || "ricardo@agenda.local", createdAtMillis:Date.now(), createdAt:serverTimestamp(), importadoPorIa:true });
  }
  importCandidates = [];
  if ($("importFile")) $("importFile").value = "";
  if ($("importText")) $("importText").value = "";
  renderImportPreview([]);
  await loadClients();
  setImportStatus(`${toSave.length} cliente(s) cadastrado(s) com sucesso.`);
}
function clearImportBox() {
  importCandidates = [];
  if ($("importFile")) $("importFile").value = "";
  if ($("importText")) $("importText").value = "";
  renderImportPreview([]); setImportStatus("");
}

async function handleVoiceCommand(command) {
  addAiMessage("user", command);
  try {
    const result = await callAgendaAi(command);
    await executeAiAction(result);
  } catch (err) {
    console.warn("IA indisponível ou não configurada. Usando comandos internos.", err);
    try { await handleSimpleCommand(command); }
    catch { const msg = AI_FUNCTION_URL ? "Não consegui entender esse comando. Tente falar de outro jeito." : "Modo IA ainda não foi conectado. Por enquanto use comandos como: organizar agenda para a cidade, próximo cliente, escolher cliente ou abrir GPS."; addAiMessage("assistant", msg); speak(msg); }
  }
}
function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const rec = new SpeechRecognition();
  rec.lang = "pt-BR"; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  return rec;
}
function listenOnce(afterEnd = null) {
  const rec = createRecognition();
  if (!rec) { alert("Reconhecimento de voz não disponível neste navegador. No iPhone, use Safari atualizado."); return; }
  activeRecognition = rec; toast("Estou ouvindo...");
  rec.onresult = (e) => lock(() => handleVoiceCommand(e.results[0][0].transcript));
  rec.onerror = () => { if (voiceModeActive) toast("Não ouvi. Pode falar de novo."); else alert("Não consegui ouvir. Tente novamente."); };
  rec.onend = () => { activeRecognition = null; if (typeof afterEnd === "function") afterEnd(); };
  try { rec.start(); } catch (e) { console.warn(e); }
}
function startVoice() { listenOnce(); }
function startVoiceMode() {
  voiceModeActive = true; $("btnVoiceMode").textContent = "🟢 Modo voz ativo"; $("btnStopVoiceMode").classList.remove("hidden");
  const loop = () => {
    if (!voiceModeActive) return;
    clearTimeout(voiceModeTimer);
    voiceModeTimer = setTimeout(() => { if (voiceModeActive) listenOnce(loop); }, 700);
  };
  speak("Modo voz ativado. Pode falar seus comandos.");
  listenOnce(loop);
}
function stopVoiceMode(showToast = true) {
  voiceModeActive = false; clearTimeout(voiceModeTimer);
  if (activeRecognition) { try { activeRecognition.abort(); } catch {} activeRecognition = null; }
  if ($("btnVoiceMode")) $("btnVoiceMode").textContent = "🎙️ Ativar modo voz contínuo";
  if ($("btnStopVoiceMode")) $("btnStopVoiceMode").classList.add("hidden");
  if (showToast) toast("Modo voz desligado");
}
function toggleVoiceMode() { voiceModeActive ? stopVoiceMode() : startVoiceMode(); }
async function addClientFromForm(e) {
  e.preventDefault();
  await lock(async () => {
    const payload = { nome:$("clientName").value.trim(), cidade:$("clientCity").value.trim(), endereco:$("clientAddress").value.trim(), telefone:$("clientPhone").value.trim(), observacoes:$("clientNotes").value.trim(), ownerEmail:auth.currentUser?.email || "ricardo@agenda.local", createdAtMillis:Date.now(), createdAt:serverTimestamp() };
    if (!payload.nome || !payload.cidade || !payload.endereco) return alert("Nome, cidade e endereço são obrigatórios.");
    await addDoc(collection(db, "clientes"), payload); $("clientForm").reset(); $("clientForm").classList.add("hidden"); await loadClients();
  }, "Cliente salvo");
}
async function initApp() { if (appLoaded) return; appLoaded = true; await loadClients(); await loadCurrentAgenda(); await loadAgendas(); }
window.toggleAgendaDetails = (id) => { const el = $(`details-${id}`); if (el) el.classList.toggle("hidden"); };
window.continueAgenda = (id) => lock(async () => { const snap = await getDoc(doc(db, "agendas", id)); if (!snap.exists()) return; currentAgenda = { id, ...snap.data(), status: "andamento" }; await saveAgenda(currentAgenda); }, "Agenda retomada");
window.restartAgenda = (id) => lock(async () => { const snap = await getDoc(doc(db, "agendas", id)); if (!snap.exists()) return; const a = { id, ...snap.data(), indiceAtual:0, concluidos:0, visitados:[], status:"andamento" }; currentAgenda = a; await saveAgenda(a); }, "Rota reiniciada");
window.chooseStartClient = async (id) => { const snap = await getDoc(doc(db, "agendas", id)); if (!snap.exists()) return; currentAgenda = { id, ...snap.data() }; await chooseClientByName(prompt("Começar por qual cliente?"), false); };
window.deleteAgenda = (id) => lock(async () => { if (!confirm("Excluir esta agenda?")) return; await deleteDoc(doc(db, "agendas", id)); await loadAgendas(); }, "Agenda excluída");
window.editAgenda = () => alert("Edição simples: use reiniciar, escolher cliente ou excluir. A estrutura está preparada para edição avançada.");

$("loginForm").addEventListener("submit", login); $("btnLogout").addEventListener("click", () => lock(logout)); $("btnVoice").addEventListener("click", startVoice);
$("btnVoiceMode").addEventListener("click", toggleVoiceMode); $("btnStopVoiceMode").addEventListener("click", () => stopVoiceMode());
$("btnFirst").addEventListener("click", () => lock(startFirstClient)); $("btnMap").addEventListener("click", () => lock(openCurrentMap)); $("btnNext").addEventListener("click", () => lock(nextClient)); $("btnSkip").addEventListener("click", () => lock(skipClient)); $("btnFinish").addEventListener("click", () => lock(finishDay));
$("refreshAgendas").addEventListener("click", () => lock(loadAgendas, "Agendas atualizadas")); $("toggleClientForm").addEventListener("click", () => $("clientForm").classList.toggle("hidden")); $("clientForm").addEventListener("submit", addClientFromForm);
$("resumeContinue").addEventListener("click", () => lock(async () => { closeResumeModal(); currentAgenda = { ...lastIncompleteAgenda, status:"andamento" }; await saveAgenda(currentAgenda); }, "Continuando de onde parou"));
$("resumeRestart").addEventListener("click", () => lock(async () => { closeResumeModal(); const a = { ...lastIncompleteAgenda, indiceAtual:0, concluidos:0, visitados:[], status:"andamento" }; currentAgenda = a; await saveAgenda(a); }, "Rota reiniciada"));
$("resumeChoose").addEventListener("click", async () => { closeResumeModal(); currentAgenda = { ...lastIncompleteAgenda }; await chooseClientByName(prompt("Começar por qual cliente?"), false); });
$("resumeOnly").addEventListener("click", async () => { closeResumeModal(); await chooseClientByName(prompt("Visitar somente qual cliente?"), true); });
$("resumeClose").addEventListener("click", closeResumeModal);
$("toggleImportBox")?.addEventListener("click", () => $("importBox")?.classList.toggle("hidden"));
$("btnAnalyzeImport")?.addEventListener("click", analyzeImport);
$("btnClearImport")?.addEventListener("click", clearImportBox);

onAuthStateChanged(auth, async (user) => {
  if (user && user.email === "ricardo@agenda.local") { $("loginScreen").classList.add("hidden"); $("appShell").classList.remove("hidden"); await initApp(); toast("Login automático ativo"); }
  else { if (user && user.email !== "ricardo@agenda.local") await signOut(auth); $("appShell").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); }
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
