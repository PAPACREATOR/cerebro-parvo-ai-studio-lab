"use strict";
const el = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has("session")) {
  sessionStorage.setItem("nexus-session", fragment.get("session"));
  history.replaceState(null, "", "/");
}
const session = sessionStorage.getItem("nexus-session") || "";
let current = null, ticket = null, poll = null, currentContent = "", executionTicket = null;
let editRevision = 0;
function invalidateExecutionProposal() {
  editRevision++;
  executionTicket = null;
  const modal = el("execution-confirmation");
  if (modal.open) modal.close();
  el("execution-approve").disabled = true;
  el("submit").disabled = false;
}
const labels = {RUNNING:"A executar",HUMAN_REQUIRED:"Em Creative · por rever",PASS:"Aprovado",FAIL:"Não concluído",UNKNOWN:"Por esclarecer",BLOCKED:"Precisa de atenção"};
async function api(path, data) {
  const response = await fetch(path, {method:data === undefined ? "GET":"POST",
    headers:{"X-Nexus-Session":session,"Content-Type":"application/json"},
    body:data === undefined ? undefined:JSON.stringify(data)});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Não foi possível concluir.");
  return value;
}
function notice(message) { el("notice").textContent = message; }
function showInterpretation(preview) {
  // An interpretation is never an execution or a Creative candidate.
  current=null;
  el("empty").hidden=true;el("result").hidden=false;
  el("status").textContent=preview.status==="RESOLVED"?"Reconhecido · não executado":
    (preview.status==="BLOCKED"?"Bloqueado":"Precisa de esclarecimento");
  const intents={arquivo:"Arquivo",fontes:"Fontes",perguntar:"Pergunta",
    trabalhar:"Trabalhar",calcular:"Calcular",tema:"Tema",web:"Web"};
  el("result-title").textContent=preview.status==="RESOLVED"?
    ("Intenção: "+(intents[preview.intent]||"por esclarecer")):"Interpretação pendente";
  el("message").textContent=preview.message || (preview.status==="RESOLVED"?
    "A Folha compreendeu o teu pedido. Tempo previsto para concluir: 1 a 2 segundos no teu computador.":
    "Reformula o pedido por palavras tuas. Nenhuma ferramenta foi executada.");
  el("content").textContent=preview.natural_response || preview.original;
  currentContent="";
  el("actions").hidden=true;el("pdf").hidden=true;
}
function updateProcessedCount(itemsLength) {
  let count = itemsLength !== undefined ? itemsLength : 0;
  try {
    if (typeof localStorage !== "undefined") {
      const stored = parseInt(localStorage.getItem("nexus-processed-count") || "0", 10);
      count = Math.max(count, stored);
    }
  } catch (_e) {}
  const target = el("processed-count");
  if (target) target.textContent = count;
}
function incrementProcessedCount() {
  try {
    if (typeof localStorage !== "undefined") {
      const currentVal = parseInt(localStorage.getItem("nexus-processed-count") || "0", 10);
      localStorage.setItem("nexus-processed-count", currentVal + 1);
    }
  } catch (_e) {}
  updateProcessedCount();
}
let allHistoryItems = [];
let currentCategoryFilter = "all";
function formatTimestamp(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch (_e) {
    return "";
  }
}
function updateCategoryFilters() {
  const container = el("category-filter");
  if (!container) return;
  container.replaceChildren();
  if (allHistoryItems.length <= 1) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const categories = new Map();
  allHistoryItems.forEach(item => {
    const cat = item.category || "Geral";
    categories.set(cat, (categories.get(cat) || 0) + 1);
  });

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "category-btn" + (currentCategoryFilter === "all" ? " active" : "");
  allBtn.textContent = "Todos (" + allHistoryItems.length + ")";
  allBtn.onclick = () => {
    currentCategoryFilter = "all";
    updateCategoryFilters();
    renderHistoryItems(el("history-search")?.value);
  };
  container.append(allBtn);

  categories.forEach((count, cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-btn" + (currentCategoryFilter === cat ? " active" : "");
    btn.textContent = cat + " (" + count + ")";
    btn.onclick = () => {
      currentCategoryFilter = currentCategoryFilter === cat ? "all" : cat;
      updateCategoryFilters();
      renderHistoryItems(el("history-search")?.value);
    };
    container.append(btn);
  });
}
function renderHistoryItems(filterQuery) {
  const query = (filterQuery || "").trim().toLowerCase();
  el("history").replaceChildren();

  let itemsToFilter = allHistoryItems;
  if (currentCategoryFilter !== "all") {
    itemsToFilter = itemsToFilter.filter(item => (item.category || "Geral") === currentCategoryFilter);
  }

  const filtered = query
    ? itemsToFilter.filter(item => {
        const titleMatch = (item.title || "").toLowerCase().includes(query);
        const catMatch = (item.category || "").toLowerCase().includes(query);
        const statusMatch = (labels[item.status] || item.status || "").toLowerCase().includes(query);
        const msgMatch = (item.message || "").toLowerCase().includes(query);
        const timeMatch = formatTimestamp(item.timestamp).includes(query);
        return titleMatch || catMatch || statusMatch || msgMatch || timeMatch;
      })
    : itemsToFilter;

  if (filtered.length === 0 && allHistoryItems.length > 0) {
    const emptySpan = document.createElement("div");
    emptySpan.className = "history-empty";
    emptySpan.textContent = "Nenhum trabalho encontrado para este tópico ou termo.";
    el("history").append(emptySpan);
    return;
  }

  filtered.forEach(item => {
    const button = document.createElement("button");
    button.className="history-item";
    const titleSpan = document.createElement("span");
    titleSpan.className = "history-title";
    titleSpan.textContent = item.title;
    button.append(titleSpan);

    const catBadge = document.createElement("span");
    catBadge.className = "history-category";
    catBadge.textContent = item.category || "Geral";
    button.append(catBadge);

    const small = document.createElement("small");
    small.className = "history-meta-info";
    const statusLabel = labels[item.status] || item.status;
    const formattedDate = formatTimestamp(item.timestamp);
    small.textContent = formattedDate ? `${statusLabel} · ${formattedDate}` : statusLabel;
    button.append(small);

    button.onclick=()=>show(item.run_id).catch(e=>notice(e.message));
    el("history").append(button);
  });
}
async function list() {
  const items = await api("/api/runs");
  allHistoryItems = items;
  updateProcessedCount(items.length);
  updateCategoryFilters();
  const searchInput = el("history-search");
  const query = searchInput ? searchInput.value : "";
  renderHistoryItems(query);
}
async function show(id) {
  current=id;
  const item=await api("/api/runs/"+id);
  el("empty").hidden=true; el("result").hidden=false;
  el("status").textContent=labels[item.status] || item.status;
  el("result-title").textContent=item.result ? item.result.title : item.title;
  if (el("result-timestamp")) {
    const formatted = formatTimestamp(item.timestamp);
    el("result-timestamp").textContent = formatted ? `Processado em ${formatted}` : "";
  }
  el("message").textContent=item.message;
  el("pdf").hidden=!item.artifact_sha256;
  currentContent=item.content || "";
  el("content").textContent=currentContent;
  el("actions").hidden=!item.content;
  el("prepare").hidden=item.status!=="HUMAN_REQUIRED";
  el("submit").disabled=item.status==="RUNNING";
  clearTimeout(poll);
  if(item.status==="RUNNING") poll=setTimeout(()=>show(id).catch(e=>notice(e.message)),900);
  else await list();
}
async function requestPayload() {
  const file=el("file").files[0];
  if(file && file.size>2097152) throw new Error("Escolhe um ficheiro até 2 MB.");
  let attachment="";
  if(file) {
    const bytes=new Uint8Array(await file.arrayBuffer());
    let binary="";
    for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    attachment=btoa(binary);
  }
  return {text:el("text").value,filename:file ? file.name:"",attachment};
}
el("form").onsubmit=async event=>{
  event.preventDefault(); notice(""); el("submit").disabled=true;
  try {
    const revision=editRevision;
    const payload=await requestPayload();
    if (revision!==editRevision) throw new Error("O texto ou anexo mudou durante a preparação. Revê o pedido.");
    const preview=await api("/api/interpret",{text:payload.text});
    if(revision!==editRevision) throw new Error("O texto ou anexo mudou durante a interpretação.");
    if(preview.status!=="RESOLVED"||!["trabalhar","web"].includes(preview.intent)||
       !payload.filename||!payload.attachment) {
      incrementProcessedCount();
      showInterpretation(preview);
      return;
    }
    let prepared;
    try {
      prepared=await api("/api/prepare-run",payload);
    } catch(error) {
      // Never pretend a recognized intent is an executable capability.
      incrementProcessedCount();
      showInterpretation(preview);
      notice(error.message);
      return;
    }
    if (revision!==editRevision) {
      notice("O texto ou anexo mudou durante a preparação. Revê o pedido.");
      return;
    }
    executionTicket=prepared.ticket;
    el("execution-summary").textContent=prepared.summary;
    const actions={
      verify:"Verificar integridade",interpret:"Interpretar documento (OpenNotebook)",
      proofread:"Rever texto (LanguageTool)",convert_pdf:"Converter para PDF",
      video:"Preparar plano de vídeo",podcast:"Preparar plano de podcast",
      visual_podcast:"Preparar plano de podcast visual",book:"Exportar manuscrito para PDF",
      music:"Preparar plano de música",web:"Preparar plano de pesquisa web"
    };
    if(!Object.prototype.hasOwnProperty.call(actions,prepared.process))
      throw new Error("A operação proposta não está autorizada.");
    el("execution-review").textContent="Ação: "+actions[prepared.process]+"\nFicheiro: "+prepared.filename+"\nBytes: "+prepared.attachment_bytes+"\nSHA-256: "+prepared.attachment_sha256;
    el("execution-confirm").checked=false;
    el("execution-approve").disabled=true;
    el("execution-confirmation").showModal();
  } catch(error) {notice(error.message);}
  finally {if(!el("execution-confirmation").open)el("submit").disabled=false;}
};
el("execution-confirm").onchange=()=>{el("execution-approve").disabled=!el("execution-confirm").checked;};
el("execution-cancel").onclick=async()=>{
  const stale=executionTicket; executionTicket=null;
  try {
    if(stale) await api("/api/confirm-run",{ticket:stale,confirmed:false,...await requestPayload()});
  } catch(_error) {}
  el("execution-confirmation").close(); el("submit").disabled=false;
};
el("execution-approve").onclick=async()=>{
  el("execution-approve").disabled=true;
  const active=executionTicket, revision=editRevision; executionTicket=null;
  try {
    if(!active)throw new Error("A confirmação já não é válida.");
    const payload=await requestPayload();
    if(revision!==editRevision)throw new Error("O pedido mudou durante a confirmação.");
    const response=await api("/api/confirm-run",{ticket:active,confirmed:true,...payload});
    el("execution-confirmation").close();
    await list(); await show(response.run_id);
  } catch(error) {
    el("execution-confirmation").close(); notice(error.message); el("submit").disabled=false;
  }
};
el("text").addEventListener("input", invalidateExecutionProposal);
el("file").onchange=()=>{invalidateExecutionProposal();el("file-label").textContent=el("file").files[0]?.name || "Até 2 MB · um ficheiro de cada vez";};
// Drag-and-drop is an input convenience, not an authorization or execution.
const surface=document.querySelector?.(".sheet");
if(surface){
  surface.addEventListener("dragover",event=>event.preventDefault());
  surface.addEventListener("drop",event=>{
    event.preventDefault();
    const files=event.dataTransfer?.files;
    if(!files?.length)return;
    if(files.length!==1){notice("Junta um ficheiro de cada vez.");return;}
    if(files[0].size>2097152){notice("Escolhe um ficheiro até 2 MB.");return;}
    try {el("file").files=files;el("file").onchange();}
    catch(_error){notice("Usa «Juntar ficheiro» para selecionar o documento.");}
  });
}
const attach=document.querySelector?.(".attachment");
if(attach) attach.addEventListener("keydown",event=>{
  if(event.key==="Enter"||event.key===" "){event.preventDefault();el("file").click();}
});
el("new").onclick=()=>{
  clearTimeout(poll); current=null; invalidateExecutionProposal(); el("form").reset(); el("file-label").textContent="Até 2 MB · um ficheiro de cada vez";
  el("empty").hidden=false;el("result").hidden=true;el("submit").disabled=false;notice("");el("text").focus();
};
el("prepare").onclick=async()=>{
  try {const value=await api("/api/prepare",{run_id:current}); ticket=value.ticket;
    el("review").textContent=value.content;el("confirm").checked=false;el("approve").disabled=true;el("approval").showModal();
  } catch(error){notice(error.message);}
};
el("confirm").onchange=()=>{el("approve").disabled=!el("confirm").checked;};
el("cancel").onclick=()=>{ticket=null;el("approval").close();};
el("approve").onclick=async()=>{
  el("approve").disabled=true;
  try {await api("/api/approve",{run_id:current,ticket,confirmed:el("confirm").checked});el("approval").close();await show(current);notice("Resultado guardado como aprovado.");}
  catch(error){el("approval").close();notice(error.message);}
};
el("download").onclick=()=>{
  const url=URL.createObjectURL(new Blob([currentContent],{type:"text/markdown;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="resultado-nexus.md";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const printBtn = el("print");
if (printBtn) {
  printBtn.onclick = () => {
    window.print();
  };
}
list().catch(error=>notice(error.message));

el("pdf").onclick=async()=>{
  try {
    const response=await fetch("/api/pdf/"+current,{headers:{"X-Nexus-Session":session}});
    if(!response.ok) throw new Error("Não foi possível obter o PDF verificado.");
    const url=URL.createObjectURL(await response.blob());
    const a=document.createElement("a");a.href=url;a.download="resultado-nexus.pdf";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error){notice(error.message);}
};

const exportBtn = el("export-history");
if (exportBtn) {
  exportBtn.onclick = async () => {
    try {
      const items = await api("/api/runs");
      const fullRuns = [];
      for (const item of items) {
        try {
          const detail = await api("/api/runs/" + item.run_id);
          fullRuns.push(detail);
        } catch (_err) {
          fullRuns.push(item);
        }
      }
      let processedCount = fullRuns.length;
      try {
        if (typeof localStorage !== "undefined") {
          const stored = parseInt(localStorage.getItem("nexus-processed-count") || "0", 10);
          processedCount = Math.max(processedCount, stored);
        }
      } catch (_e) {}
      const backupData = {
        app: "Folha Nexus",
        export_date: new Date().toISOString(),
        processed_count: processedCount,
        total_records: fullRuns.length,
        runs: fullRuns,
      };
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateTag = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = "nexus-historico-backup-" + dateTag + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notice("Backup exportado com sucesso (" + fullRuns.length + " registos).");
    } catch (error) {
      notice("Erro ao exportar histórico: " + error.message);
    }
  };
}

const historySearch = el("history-search");
if (historySearch) {
  historySearch.addEventListener("input", (e) => {
    renderHistoryItems(e.target.value);
  });
}
