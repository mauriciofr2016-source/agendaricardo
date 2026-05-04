import {
  db, auth, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, serverTimestamp,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase.js";

const $ = (id) => document.getElementById(id);
let clients = [], currentAgenda = null, lastIncompleteAgenda = null, busy = false, appLoaded = false;

function normalize(text = "") { return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function usernameToEmail(username) { return `${normalize(username)}@agenda.local`; }
function todayBR() { return new Date().toLocaleDateString("pt-BR"); }
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
  clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
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
  await signOut(auth); appLoaded = false; currentAgenda = null; clients = [];
  $("appShell").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); toast("Você saiu");
}
async function loadClients() { const snap = await getDocs(collection(db, "clientes")); clients = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderClients(); }
async function loadCurrentAgenda() { const snap = await getDoc(doc(db, "agenda_atual", "ricardo")); currentAgenda = snap.exists() ? snap.data() : null; renderCurrent(); }
async function loadAgendas() {
  const snap = await getDocs(collection(db, "agendas"));
  const agendas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0));
  lastIncompleteAgenda = agendas.find((a) => a.status === "incompleta" || a.status === "andamento") || null;
  renderAgendas(agendas);
}
function renderClients() {
  const list = $("clientList");
  if (!clients.length) { list.innerHTML = `<div class="item"><div class="item-title">Nenhum cliente cadastrado</div><div class="item-meta">Cadastre clientes dentro do app para organizar por cidade.</div></div>`; return; }
  list.innerHTML = clients.slice(0, 8).map((c) => `<div class="item"><div class="item-title">${c.nome || "Sem nome"}</div><div class="item-meta">${c.cidade || ""} • ${c.endereco || ""}</div>${c.telefone ? `<div class="item-meta">📞 ${c.telefone}</div>` : ""}</div>`).join("");
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
      <div class="item-title">${a.cidade} — ${a.dataLabel || todayBR()} — ${a.concluidos}/${a.total} concluídas</div>
      <div class="item-meta">${status}</div>
      <div class="details hidden" id="details-${a.id}">
        ${(a.clientes || []).map((c, idx) => {
          const done = (a.visitados || []).includes(c.id) || idx < (a.indiceAtual || 0), atual = idx === a.indiceAtual && a.status !== "concluida";
          return `<div>${done ? "✅" : atual ? "📍" : "⬜"} ${idx + 1}. ${c.nome} — ${c.endereco || ""}</div>`;
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
  const agenda = { id:`agenda_${city.replace(/\s+/g, "_")}_${Date.now()}`, cidade, dataLabel:todayBR(), clientes:cityClients, indiceAtual:options.startIndex || 0, concluidos:0, visitados:[], total:cityClients.length, status:"andamento", createdAtMillis:Date.now(), ownerEmail:auth.currentUser?.email || "ricardo@agenda.local" };
  await saveAgenda(agenda); toast(`Agenda criada para ${city}: 0/${cityClients.length}`);
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
async function handleVoiceCommand(command) {
  const text = normalize(command); toast(`Comando: ${command}`);
  if (text.includes("organizar agenda")) return await createAgendaByCity(extractCity(command));
  if (text.includes("visitar primeiro cliente") || text.includes("primeiro cliente")) return await startFirstClient();
  if (text.includes("proximo cliente") || text.includes("próximo cliente")) return await nextClient();
  if (text.includes("pular cliente")) return await skipClient();
  if (text.includes("finalizar")) return await finishDay();
  if (text.includes("abrir mapa") || text.includes("abrir gps") || text.includes("rota")) return await openCurrentMap();
  if (text.includes("visitar somente cliente")) return await chooseClientByName(extractClientName(command), true);
  if (text.includes("escolher cliente") || text.includes("comecar por") || text.includes("começar por")) return await chooseClientByName(extractClientName(command), false);
  alert("Não entendi o comando. Tente: organizar agenda para Pato Branco, próximo cliente ou escolher cliente João.");
}
function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert("Reconhecimento de voz não disponível neste navegador. No iPhone, use Safari atualizado.");
  const rec = new SpeechRecognition(); rec.lang = "pt-BR"; rec.interimResults = false; rec.maxAlternatives = 1; rec.start(); toast("Estou ouvindo...");
  rec.onresult = (e) => lock(() => handleVoiceCommand(e.results[0][0].transcript));
  rec.onerror = () => alert("Não consegui ouvir. Tente novamente.");
}
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
$("btnFirst").addEventListener("click", () => lock(startFirstClient)); $("btnMap").addEventListener("click", () => lock(openCurrentMap)); $("btnNext").addEventListener("click", () => lock(nextClient)); $("btnSkip").addEventListener("click", () => lock(skipClient)); $("btnFinish").addEventListener("click", () => lock(finishDay));
$("refreshAgendas").addEventListener("click", () => lock(loadAgendas, "Agendas atualizadas")); $("toggleClientForm").addEventListener("click", () => $("clientForm").classList.toggle("hidden")); $("clientForm").addEventListener("submit", addClientFromForm);
$("resumeContinue").addEventListener("click", () => lock(async () => { closeResumeModal(); currentAgenda = { ...lastIncompleteAgenda, status:"andamento" }; await saveAgenda(currentAgenda); }, "Continuando de onde parou"));
$("resumeRestart").addEventListener("click", () => lock(async () => { closeResumeModal(); const a = { ...lastIncompleteAgenda, indiceAtual:0, concluidos:0, visitados:[], status:"andamento" }; currentAgenda = a; await saveAgenda(a); }, "Rota reiniciada"));
$("resumeChoose").addEventListener("click", async () => { closeResumeModal(); currentAgenda = { ...lastIncompleteAgenda }; await chooseClientByName(prompt("Começar por qual cliente?"), false); });
$("resumeOnly").addEventListener("click", async () => { closeResumeModal(); await chooseClientByName(prompt("Visitar somente qual cliente?"), true); });
$("resumeClose").addEventListener("click", closeResumeModal);

onAuthStateChanged(auth, async (user) => {
  if (user && user.email === "ricardo@agenda.local") { $("loginScreen").classList.add("hidden"); $("appShell").classList.remove("hidden"); await initApp(); toast("Login automático ativo"); }
  else { if (user && user.email !== "ricardo@agenda.local") await signOut(auth); $("appShell").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); }
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
