const appRoot = document.getElementById('app');
const toastRegion = document.getElementById('toast-region');
const state = { user: null, csrf: '', data: null, tab: 'overview', selectedPlan: '1h' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const date = (v) => v ? new Date(v.replace(' ', 'T') + (v.includes('Z') ? '' : 'Z')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const creditText = (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(v) || 0);
const durationText = (k) => `${k.durationValue} ${k.durationUnit === 'hours' ? (Number(k.durationValue) === 1 ? 'hora' : 'horas') : (Number(k.durationValue) === 1 ? 'dia' : 'dias')}`;
function toast(message, kind='success') {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = message; toastRegion.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
async function api(url, options={}) {
  const headers = { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') headers['x-csrf-token'] = state.csrf;
  let response;
  try {
    response = await fetch(url, { credentials:'same-origin', signal:AbortSignal.timeout(10000), ...options, headers });
  } catch {
    throw new Error('O servidor não respondeu. No Termux, execute bash SERVICO_24H.sh start e abra http://127.0.0.1:3000. Para outras pessoas, compartilhe o link HTTPS exibido pelo gerenciador. Não abra index.html diretamente.');
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ocorreu um erro.');
  if (payload.csrfToken) state.csrf = payload.csrfToken;
  return payload;
}
async function loadData() { state.data = await api('/api/dashboard'); for (const key of ['keys','resellers','audit','rules','plans']) if (!Array.isArray(state.data[key])) state.data[key] = []; state.user = state.data.user; render(); }
function loading() { appRoot.innerHTML = '<div class="loading-screen"><span class="spinner"></span><p>Preparando seu painel…</p></div>'; }
function authScreen(setup=false) {
  appRoot.innerHTML = `<main class="auth-layout">
    <section class="auth-brand">
      <div class="auth-brand-head"><div class="brand-mark">K</div><div><b>KEYDESK</b><small>RESELLER CONTROL</small></div></div>
      <div class="auth-brand-copy"><div class="eyebrow">CONTROLE DE LICENÇAS</div><h1>Seu painel.<br><span>Sua operação.</span></h1><p>Uma área privada para administrar revendedores, créditos e keys conectadas ao aplicativo.</p>
        <div class="auth-feature-list"><div class="auth-feature"><span>01</span><div><b>Acessos separados</b><small>Senha individual para cada revendedor</small></div></div><div class="auth-feature"><span>02</span><div><b>Gestão centralizada</b><small>Saldos, prefixos e histórico em um só lugar</small></div></div><div class="auth-feature"><span>03</span><div><b>Sincronização em tempo real</b><small>Keys integradas ao Firebase Realtime Database</small></div></div></div>
      </div>
      <div class="brand-foot"><span class="live-dot"></span> ACESSO PROTEGIDO <i>·</i> CONEXÃO COM FIREBASE</div>
    </section>
    <section class="auth-side"><div class="auth-card">
      <div class="auth-card-top"><div class="brand-mini"><div class="brand-mark small">K</div><span>KEYDESK</span></div><span class="auth-secure-badge"><i></i> ACESSO SEGURO</span></div>
      <div class="auth-intro"><div class="eyebrow">${setup ? 'PRIMEIRO ACESSO' : 'ÁREA RESTRITA'}</div>
      <h2>${setup ? 'Defina a senha-mestra' : 'Acesse seu painel'}</h2>
      <p class="muted">${setup ? 'Cadastre a senha fixa do proprietário. Ela será guardada como hash no servidor.' : 'Revendedor: informe usuário e senha. Administrador: deixe o campo usuário em branco.'}</p></div>
      <form id="authForm" class="form-stack">
        ${setup ? '' : '<label class="auth-field"><span>Usuário</span><div class="auth-input-wrap"><span class="auth-input-icon" aria-hidden="true">@</span><input id="authUsername" name="username" type="text" maxlength="32" autocomplete="username" placeholder="Em branco para administrador"></div></label>'}
        <label class="auth-field"><span>${setup ? 'Senha-mestra do dono' : 'Senha'}</span><div class="auth-input-wrap"><span class="auth-input-icon" aria-hidden="true">▣</span><input id="authPassword" name="password" type="password" required ${setup ? 'minlength="8"' : ''} maxlength="128" autocomplete="${setup ? 'new-password' : 'current-password'}" placeholder="${setup ? 'Mínimo de 8 caracteres' : 'Digite sua senha'}"></div></label>
        <button class="button primary full auth-submit" type="submit">${setup ? 'Salvar senha-mestra' : 'Entrar no painel'} <span>→</span></button>
      </form>
      <div class="auth-note"><span class="auth-note-icon">✓</span><p><b>Privacidade protegida</b><span>${setup ? 'A senha-mestra é armazenada como hash no servidor.' : 'Administrador deixa usuário em branco; revendedor entra com seu próprio usuário e senha.'}</span></p></div>
    </div><div class="auth-copyright">KEYDESK <span>·</span> AMBIENTE PRIVADO</div></section>
  </main>`;
  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    const button = e.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Aguarde…';
    try {
      const result = await api(setup ? '/api/setup' : '/api/login', { method:'POST', body:JSON.stringify({ username:setup?'':form.get('username'), password:form.get('password') }) });
      state.user = result.user; state.csrf = result.csrfToken; await loadData();
    } catch(err) { toast(err.message, 'error'); button.disabled = false; button.innerHTML = `${setup ? 'Salvar senha-mestra' : 'Entrar no painel'} <span>→</span>`; }
  });
}
function badge(status) {
  const labels = { active:'Conectada', pending:'Aguardando conexão', paused:'Pausada', expired:'Expirada', not_found:'Não localizada no app', sync_error:'Firebase indisponível' };
  return `<span class="badge ${esc(status)}"><i></i>${labels[status] || esc(status)}</span>`;
}
function topbar() {
  const owner = state.user.role === 'owner';
  const tabs = owner ? [['overview','Visão geral'],['resellers','Revendedores'],['keys','Keys'],['activity','Atividade']] : [['overview','Visão geral'],['keys','Minhas keys']];
  return `<header class="topbar"><a class="brand-mini" href="#"><div class="brand-mark small">K</div><span>KEYDESK</span></a>
    <nav class="main-nav">${tabs.map(([id,label]) => `<button class="nav-link ${state.tab===id?'selected':''}" data-tab="${id}">${label}</button>`).join('')}</nav>
    <div class="top-user"><div class="avatar">${owner?'D':esc((state.user.username||'R')[0].toUpperCase())}</div><div class="user-meta"><strong>${owner?'Proprietário':esc(state.user.username)}</strong><span>${owner?'Acesso principal':'Revendedor'}</span></div><button class="icon-button" data-action="logout" title="Sair" aria-label="Sair">↗</button></div></header>`;
}
function shell(content) {
  appRoot.innerHTML = `${topbar()}<main class="page"><div class="page-head"><div><div class="eyebrow">${state.user.role==='owner'?'CENTRAL DO PROPRIETÁRIO':'ÁREA DO REVENDEDOR'}</div><h1>${pageTitle()}</h1><p>${pageSubtitle()}</p></div><div class="head-right">${state.user.role==='reseller'?`<div class="credit-pill"><span class="credit-icon">✦</span><div><b>${creditText(state.user.credits)}</b><small>créditos disponíveis</small></div></div>`:''}</div></div>${content}<footer class="footer">KEYDESK <span>·</span> Auditoria local <span>·</span> Keys sincronizadas com Firebase.</footer></main>`;
}
function pageTitle() {
  const map={ overview:state.user.role==='owner'?'Visão geral':'Olá, '+(state.user.username||'revendedor'), resellers:'Revendedores', keys:state.user.role==='owner'?'Gerenciar keys':'Minhas keys', activity:'Registro de atividade' };
  return map[state.tab] || 'Painel';
}
function pageSubtitle() {
  const map={ overview:state.user.role==='owner'?'Acompanhe revendedores, saldos e keys em um só lugar.':'Gere a key aqui; a contagem começa no aplicativo quando o dispositivo se conectar.', resellers:'Crie acessos, ajuste saldos e defina o prefixo de cada revendedor.', keys:state.user.role==='owner'?'Consulte, copie, resete, pause ou remova keys.':'Gerencie apenas as suas keys: pause, resete ou exclua. O reset não reinicia a contagem.', activity:'Ações recentes realizadas no painel.' };
  return map[state.tab] || '';
}
function statCard(label,value,sub,icon) { return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${value}</div><div class="stat-sub">${sub}</div></article>`; }
function ownerOverview() {
  const m=state.data.metrics;
  const recent=state.data.keys.slice(0,5);
  const firebaseNotice=state.data.firebaseAvailable?`<section class="notice live-notice"><span class="notice-icon">✓</span><div><b>Realtime Database conectado</b><p>Path <code>${esc(state.data.firebasePath||'/proxyAndroid/keys')}</code> · ${Number(state.data.firebaseKeyCount)||0} registro(s) lido(s). Keys emitidas são gravadas nesse caminho.</p></div><span class="live-pill"><i></i> online</span></section>`:`<section class="notice warning"><span class="notice-icon">!</span><div><b>Firebase indisponível</b><p>${esc(state.data.firebaseError||'O painel não conseguiu consultar o Realtime Database. Verifique conexão e regras de acesso.')}</p></div></section>`;
  return `<section class="stats-grid">${statCard('Revendedores ativos',m.resellers,'Acessos habilitados','◎')}${statCard('Créditos em circulação',creditText(m.credits),'Saldo somado','✦')}${statCard('Keys emitidas',m.keys,'Criadas por este painel','⌁')}${statCard('Dispositivos conectados',m.connectedDevices,'Estado recebido do app','◉')}</section>
    <div class="content-grid"><section class="panel"><div class="panel-head"><div><h3>Keys recentes</h3><p>Últimas keys geradas no painel</p></div><button class="text-button" data-tab="keys">Ver todas →</button></div>${recent.length?keyTable(recent,true):empty('Ainda não há keys geradas.','As keys aparecerão aqui quando um revendedor gerar uma.')}</section>
    <section class="panel"><div class="panel-head"><div><h3>Revendedores</h3><p>Visão rápida dos saldos</p></div><button class="text-button" data-tab="resellers">Gerenciar →</button></div>${state.data.resellers.length?`<div class="mini-list">${state.data.resellers.slice(0,5).map(r=>`<div class="mini-row"><div class="avatar pale">${esc(r.username[0].toUpperCase())}</div><div class="mini-main"><b>${esc(r.username)}</b><small>${esc(r.prefix)}</small></div><strong>${creditText(r.credits)} <small>cr</small></strong></div>`).join('')}</div>`:empty('Sem revendedores','Crie o primeiro acesso na área de revendedores.')}</section></div>
    ${firebaseNotice}`;
}
function resellerOverview() {
  const plans=state.data.plans;
  const selected=plans.some(p=>p.id===state.selectedPlan)?state.selectedPlan:(state.selectedPlan=plans[0]?.id||'1h');
  const firebaseNotice=state.data.firebaseAvailable?`<section class="notice live-notice"><span class="notice-icon">✓</span><div><b>Realtime Database conectado</b><p>Path <code>${esc(state.data.firebasePath||'/proxyAndroid/keys')}</code> · ${Number(state.data.firebaseKeyCount)||0} registro(s) lido(s). O app inicia o prazo ao conectar o dispositivo.</p></div><span class="live-pill"><i></i> online</span></section>`:`<section class="notice warning"><span class="notice-icon">!</span><div><b>Firebase indisponível</b><p>${esc(state.data.firebaseError||'Verifique conexão, URL e regras antes de gerar.')}</p></div></section>`;
  return `<section class="reseller-hero"><div><div class="eyebrow">SEU SALDO DISPONÍVEL</div><h2>${creditText(state.user.credits)} <span>créditos</span></h2><p>O custo é debitado conforme a validade e a quantidade escolhidas.</p></div><div class="hero-star">✦</div><div class="hero-orbit"></div></section>
  <section class="panel generate-panel"><div class="panel-head"><div><span class="eyebrow">GERADOR</span><h3>Escolha sua validade</h3><p>Prefixo individual <code>${esc(state.user.prefix)}</code> · o app controla a ativação</p></div><span class="step-chip">ATÉ 100 KEYS</span></div>
  <input id="planSelect" type="hidden" value="${esc(selected)}"><div class="duration-plans">${plans.map(p=>`<button type="button" class="duration-option ${selected===p.id?'selected':''}" data-plan-pick="${esc(p.id)}" aria-pressed="${selected===p.id}"><span class="duration-label">${esc(p.label)}</span><strong>${creditText(p.cost)}</strong><small>${p.cost===1?'crédito':'créditos'} / key</small></button>`).join('')}</div>
  <div class="generate-controls"><label>Quantidade<input id="keyQuantity" type="number" min="1" max="100" step="1" value="1"></label><button class="button primary generate-submit" data-action="generate">Gerar e enviar ao app <span>→</span></button></div>
  <div class="format-note"><span>✳</span><p><b>Formato:</b> prefixo em maiúsculas + hífen + 6 letras/números aleatórios. Ex.: <code>GOLDCHEATS-A7K9Q2</code></p></div></section>${firebaseNotice}
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">HISTÓRICO</span><h3>Suas keys recentes</h3><p>Status e validade sincronizados com o app</p></div><button class="text-button" data-tab="keys">Ver todas →</button></div>${state.data.keys.length?keyTable(state.data.keys.slice(0,5),false):empty('Nenhuma key ainda','Quando gerar uma key, ela aparecerá aqui.')}</section>`;
}
function resellersPage() {
  const rows=state.data.resellers;
  return `<section class="panel"><div class="panel-head"><div><h3>Novo revendedor</h3><p>Crie as credenciais e defina o saldo inicial e o prefixo.</p></div><span class="step-chip">ACESSOS</span></div><form id="createReseller" class="form-grid"><label>Usuário<input name="username" required minlength="3" maxlength="32" placeholder="ex.: revendedor01"></label><label>Senha individual<input name="password" required minlength="10" type="password" placeholder="Mínimo de 10 caracteres"></label><label>Créditos iniciais<input name="credits" type="number" min="0" step="0.5" value="0" required></label><label>Qual é o prefixo para gerar?<input name="prefix" maxlength="64" value="GoldCheats" placeholder="Ex.: GoldCheats" required></label><div class="form-action"><button class="button primary" type="submit">Criar revendedor <span>→</span></button></div></form></section>
  <section class="panel"><div class="panel-head"><div><h3>Contas cadastradas</h3><p>${rows.length} revendedor${rows.length===1?'':'es'} no painel</p></div></div>${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>USUÁRIO</th><th>SALDO</th><th>PREFIXO</th><th>STATUS</th><th>CADASTRADO</th><th>GERENCIAR</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.username)}</strong></td><td><b>${creditText(r.credits)}</b> cr</td><td><code>${esc(r.prefix)}</code></td><td><span class="badge ${r.active?'active':'paused'}"><i></i>${r.active?'Ativo':'Bloqueado'}</span></td><td>${date(r.createdAt)}</td><td><div class="row-actions"><button class="small-button" data-action="add-credit" data-id="${r.id}" data-name="${esc(r.username)}">Adicionar</button><button class="small-button" data-action="remove-credit" data-id="${r.id}" data-name="${esc(r.username)}">Remover créditos</button><button class="small-button" data-action="edit-prefix" data-id="${r.id}" data-prefix="${esc(r.prefix)}">Prefixo</button><button class="small-button" data-action="reset-reseller-password" data-id="${r.id}" data-name="${esc(r.username)}">Redefinir senha</button><button class="small-button danger-text" data-action="remove-reseller" data-id="${r.id}" data-name="${esc(r.username)}">Remover acesso</button></div></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhum revendedor ainda','Use o formulário acima para criar uma conta.')}</section>`;
}
function keysPage() {
  const owner=state.user.role==='owner'; const keys=state.data.keys;
  return `<section class="panel"><div class="panel-head"><div><h3>${owner?'Keys emitidas':'Todas as suas keys'}</h3><p>${keys.length} registro${keys.length===1?'':'s'} visível${keys.length===1?'':'is'}${state.data.firebaseAvailable?' · sincronizado com o app':' · Firebase indisponível'}</p></div><span class="step-chip">${owner?'MONITORAMENTO':'SUAS EMISSÕES'}</span></div>${keys.length?keyTable(keys,owner):empty('Nenhuma key encontrada',owner?'As keys geradas pelos revendedores aparecerão aqui.':'Gere sua primeira key na visão geral.')}</section>`;
}
function activityPage() {
  const labels={login:'Login realizado',owner_setup:'Acesso do dono configurado',reseller_created:'Revendedor criado',reseller_removed:'Acesso de revendedor removido',credits_adjusted:'Créditos ajustados',reseller_updated:'Conta de revendedor atualizada',key_generation_reserved:'Geração iniciada',key_generation_failed:'Geração cancelada · saldo estornado',key_generated:'Key(s) enviada(s) ao app',key_reset:'Dispositivo resetado',key_paused:'Key pausada no app',key_activated:'Key retomada no app',key_deleted:'Key excluída do app'};
  return `<section class="panel"><div class="panel-head"><div><h3>Atividade recente</h3><p>Últimas ações registradas para auditoria local</p></div></div>${state.data.audit.length?`<div class="activity-list">${state.data.audit.map(a=>{let info={};try{info=JSON.parse(a.details)}catch{};return `<article class="activity-row"><div class="activity-dot"></div><div class="activity-main"><b>${esc(labels[a.action]||a.action)}</b><small>${esc(a.actor)}${info.reseller?' · '+esc(info.reseller):''}${info.delta?` · ${info.delta>0?'+':''}${info.delta} créditos`:''}</small></div><time>${date(a.createdAt)}</time></article>`}).join('')}</div>`:empty('Sem atividades','As operações realizadas serão registradas aqui.')}</section>`;
}
function empty(title,sub) { return `<div class="empty-state"><span class="empty-icon">⌁</span><b>${title}</b><p>${sub}</p></div>`; }
function render() {
  if (!state.user || !state.data) return;
  if (state.user.role==='reseller' && state.tab==='resellers') state.tab='overview';
  if (state.user.role==='reseller' && state.tab==='activity') state.tab='overview';
  let content='';
  if (state.tab==='overview') content=state.user.role==='owner'?ownerOverview():resellerOverview();
  if (state.tab==='resellers') content=resellersPage();
  if (state.tab==='keys') content=keysPage();
  if (state.tab==='activity') content=activityPage();
  shell(content);
}
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
async function refresh(message) { await loadData(); if(message) toast(message); }
appRoot.addEventListener('click', async e => {
  const planPick=e.target.closest('[data-plan-pick]'); if(planPick){state.selectedPlan=planPick.dataset.planPick;const hidden=document.getElementById('planSelect');if(hidden)hidden.value=state.selectedPlan;document.querySelectorAll('[data-plan-pick]').forEach(el=>{const selected=el===planPick;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});return;}
  const tab=e.target.closest('[data-tab]'); if(tab){state.tab=tab.dataset.tab;render();return;}
  const copy=e.target.closest('[data-copy]'); if(copy){try{await navigator.clipboard.writeText(copy.dataset.copy);toast('Key copiada para a área de transferência.');}catch{toast('Não foi possível copiar neste navegador.','error');}return;}
  const btn=e.target.closest('[data-action]'); if(!btn)return;
  const id=btn.dataset.id; const action=btn.dataset.action;
  try {
    if(action==='logout'){await api('/api/logout',{method:'POST'});state.user=null;state.data=null;state.tab='overview';await init();}
    if(action==='generate'){const planId=document.getElementById('planSelect')?.value;const quantity=Number(document.getElementById('keyQuantity')?.value||1);btn.disabled=true;const out=await api('/api/keys',{method:'POST',body:JSON.stringify({planId,quantity})});await loadData();toast(`${out.keys.length} key(s) gravada(s) no Firebase (${out.plan}) · custo ${creditText(out.totalCost)} crédito(s).`);}
    if(action==='add-credit'||action==='remove-credit'){const adding=action==='add-credit';const amount=prompt(`Quantos créditos deseja ${adding?'adicionar ao':'remover do'} saldo de ${btn.dataset.name}? Use incrementos de 0,5.`);if(amount===null)return;const quantity=Number(String(amount).replace(',','.'));if(!Number.isFinite(quantity)||quantity<=0||Math.abs(quantity*2-Math.round(quantity*2))>1e-8)throw new Error('Informe uma quantidade maior que zero, em incrementos de 0,5.');const reason=prompt('Motivo do ajuste:','Ajuste manual')||'Ajuste manual';const delta=adding?quantity:-quantity;await api(`/api/resellers/${id}/credits`,{method:'PATCH',body:JSON.stringify({delta,reason})});await refresh(adding?'Créditos adicionados.':'Créditos removidos.');}
    if(action==='edit-prefix'){const prefix=prompt('Qual será o prefixo para gerar as keys deste revendedor?',btn.dataset.prefix);if(prefix===null)return;await api(`/api/resellers/${id}`,{method:'PATCH',body:JSON.stringify({prefix})});await refresh('Prefixo atualizado.');}
    if(action==='reset-reseller-password'){const password=prompt(`Digite uma nova senha individual para ${btn.dataset.name} (mínimo 10 caracteres).`);if(password===null)return;if(password.length<10)throw new Error('A senha do revendedor deve ter pelo menos 10 caracteres.');await api(`/api/resellers/${id}`,{method:'PATCH',body:JSON.stringify({password})});await refresh('Senha redefinida. Envie a nova senha diretamente ao revendedor.');}
    if(action==='remove-reseller'){const name=btn.dataset.name||'este revendedor';if(!confirm(`Remover o acesso de ${name}? O login será bloqueado imediatamente e o usuário poderá ser criado novamente depois. O saldo restante ficará arquivado, não será transferido, e as keys já geradas continuarão no Firebase e no histórico do dono.`))return;await api(`/api/resellers/${id}`,{method:'DELETE'});await refresh(`Acesso de ${name} removido. As keys existentes foram preservadas.`);}
    if(action==='pause'||action==='activate'){const status=action==='pause'?'paused':'active';if(!confirm(status==='paused'?'Pausar esta key no app? A validade continua correndo e os créditos não mudam.':'Retomar esta key no app? A validade continua correndo e os créditos não mudam.'))return;await api(`/api/keys/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await refresh(status==='paused'?'Key pausada.':'Key reativada.');}
    if(action==='reset'){if(!confirm('Resetar o dispositivo desta key? Só o vínculo do dispositivo será removido. O código permanece igual e a contagem continua do ponto atual, sem pausar nem reiniciar. Nenhum crédito será adicionado ou removido.'))return;const result=await api(`/api/keys/${id}/reset`,{method:'POST',body:'{}'});await refresh(`Conexão removida do dispositivo para ${result.value}.`);}
    if(action==='delete-key'){if(!confirm('Excluir esta key permanentemente do app e do painel? Isso não altera o saldo de créditos.'))return;await api(`/api/keys/${id}`,{method:'DELETE'});await refresh('Key excluída.');}
  } catch(err){if(action==='generate')btn.disabled=false;toast(err.message,'error');}
});
appRoot.addEventListener('submit', async e => {
  const form=e.target;
  try {
    if(form.id==='createReseller'){e.preventDefault();await api('/api/resellers',{method:'POST',body:JSON.stringify(formObject(form))});form.reset();await refresh('Revendedor criado.');}
  }catch(err){toast(err.message,'error');}
});
async function init() {
  if (location.protocol === 'file:') {
    appRoot.innerHTML = '<main class="error-screen"><div class="brand-mark">K</div><h1>Abra pelo Termux</h1><p>Este arquivo ZIP não é o servidor do painel. Extraia os arquivos, execute <code>bash SERVICO_24H.sh start</code> no Termux e abra <code>http://127.0.0.1:3000</code>. Para outras pessoas, compartilhe o link HTTPS mostrado pelo gerenciador.</p></main>';
    return;
  }
  loading();
  try {
    const bootstrap=await api('/api/bootstrap'); state.csrf=bootstrap.csrfToken;
    if(bootstrap.setupRequired){authScreen(true);return;}
    try { const me=await api('/api/me'); state.user=me.user; state.csrf=me.csrfToken; await loadData(); }
    catch { state.user=null;state.data=null;authScreen(false); }
  } catch(err){appRoot.innerHTML=`<main class="error-screen"><div class="brand-mark">K</div><h1>Não foi possível abrir o painel</h1><p>${esc(err.message)}</p><p>Confira se o servidor continua ativo e atualize a página.</p></main>`;}
}
function keyTable(keys,owner) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>KEY</th>${owner?'<th>REVENDEDOR</th>':''}<th>VALIDADE</th><th>STATUS NO APP</th><th>TEMPO RESTANTE</th><th>GERADA EM</th><th>AÇÕES</th></tr></thead><tbody>${keys.map(k=>{const connected=Boolean(k.deviceConnected);const pauseAction=k.status==='paused'?'activate':'pause';const pauseLabel=k.status==='paused'?'Retomar':'Pausar';const canPause=connected&&(k.status==='active'||k.status==='paused');return `<tr><td><button class="key-copy" data-copy="${esc(k.value)}" title="Clique para copiar"><code>${esc(k.value)}</code><span>Copiar</span></button></td>${owner?`<td><strong>${esc(k.reseller)}</strong><small class="cell-sub">${esc(k.prefix)}</small></td>`:''}<td>${durationText(k)}</td><td>${badge(k.status)}</td><td>${esc(k.remainingText||'—')}</td><td>${date(k.createdAt)}</td><td><div class="row-actions"><button class="small-button" data-action="${pauseAction}" data-id="${k.id}" ${canPause?'':'disabled title="Disponível após conexão e enquanto a key estiver ativa no app"'}>${pauseLabel}</button><button class="small-button" data-action="reset" data-id="${k.id}" ${connected?'':'disabled title="Disponível após vincular um dispositivo"'}>Resetar dispositivo</button><button class="small-button danger-text" data-action="delete-key" data-id="${k.id}">Excluir</button></div></td></tr>`}).join('')}</tbody></table></div>`;
}
init();
setInterval(() => { if (state.user && state.tab === 'keys' && document.visibilityState === 'visible') loadData().catch(() => {}); }, 15000);
