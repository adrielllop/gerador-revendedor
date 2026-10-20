const appRoot = document.getElementById('app');
const toastRegion = document.getElementById('toast-region');
let initialTheme = 'light';
try { initialTheme = localStorage.getItem('keydesk-theme') === 'dark' ? 'dark' : 'light'; } catch {}
const state = { user: null, csrf: '', data: null, tab: 'overview', selectedPlan: '1h', theme: initialTheme };
document.documentElement.dataset.theme = state.theme;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const date = (v) => v ? new Date(v.replace(' ', 'T') + (v.includes('Z') ? '' : 'Z')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const creditText = (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(v) || 0);
const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
function rechargeDiscountPercent(credits) {
  if (credits >= 251) return 22;
  if (credits >= 91) return 16;
  if (credits >= 81) return 14;
  if (credits >= 71) return 12;
  if (credits >= 61) return 10;
  if (credits >= 51) return 8;
  if (credits >= 41) return 6;
  if (credits >= 31) return 4;
  if (credits >= 20) return 1;
  return 0;
}
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
async function loadData() {
  state.data = await api('/api/dashboard', { cache:'no-store' });
  for (const key of ['keys','resellers','audit','rules','plans','recharges','rechargeRanking']) if (!Array.isArray(state.data[key])) state.data[key] = [];
  state.user = state.data.user; render();
}
async function handleRechargeReturn() {
  const params = new URLSearchParams(location.search);
  const id = params.get('recharge');
  if (!id || !/^\d{1,12}$/.test(id)) return;
  history.replaceState({}, '', `${location.pathname}${location.hash}`);
  state.tab = 'recharges';
  render();
  let recharge = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = await api(`/api/recharges/${id}`);
      recharge = result.recharge;
    } catch (err) {
      toast(`Não consegui consultar a confirmação do Pix: ${err.message}`, 'error');
      break;
    }
    if (recharge.status === 'paid') {
      await loadData();
      toast('Pagamento confirmado. Os créditos foram adicionados ao saldo.');
      return;
    }
    if (recharge.status !== 'pending' || attempt === 9) break;
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  await loadData();
  if (recharge?.status === 'pending') toast('O Pix ainda está sendo confirmado. Esta tela continuará atualizando as recargas.');
  else if (recharge && recharge.status !== 'paid') toast(`Status da recarga: ${recharge.status}.`, 'error');
}
function loading() { appRoot.innerHTML = '<div class="loading-screen"><span class="spinner"></span><p>Preparando seu painel…</p></div>'; }
function authScreen() {
  let registerMode = false;
  appRoot.innerHTML = `<main class="auth-layout">
    <section class="auth-brand">
      <div class="auth-brand-head"><img class="brand-logo-auth" src="./keydesk-logo.png" alt="Logo Keydesk"><div><b>KEYDESK</b><small>RESELLER CONTROL</small></div></div>
      <div class="auth-brand-copy"><div class="eyebrow">CONTROLE DE LICENÇAS</div><h1>Seu painel.<br><span>Sua operação.</span></h1><p>Uma área privada para administrar revendedores, créditos, recargas e keys conectadas ao aplicativo.</p>
        <div class="auth-feature-list"><div class="auth-feature"><span>01</span><div><b>Acessos separados</b><small>Senha individual para cada revendedor</small></div></div><div class="auth-feature"><span>02</span><div><b>Gestão centralizada</b><small>Saldos, recargas e keys em um só lugar</small></div></div><div class="auth-feature"><span>03</span><div><b>Pix com confirmação</b><small>Créditos liberados após pagamento confirmado</small></div></div></div>
      </div>
      <div class="brand-foot"><span class="live-dot"></span> ACESSO PROTEGIDO <i>·</i> CONEXÃO COM FIREBASE</div>
    </section>
    <section class="auth-side"><div class="auth-card">
      <div class="auth-card-top"><div class="brand-mini"><img class="brand-logo-mark" src="./keydesk-logo.png" alt="Logo Keydesk"><span>KEYDESK</span></div><button class="icon-button theme-toggle" data-action="toggle-theme" type="button" title="Alternar tema claro/escuro" aria-label="Ativar tema ${state.theme==='dark'?'claro':'escuro'}">${state.theme==='dark'?'☀':'◐'}</button><span class="auth-secure-badge"><i></i> ACESSO SEGURO</span></div>
      <div class="auth-intro"><div class="eyebrow">ACESSO</div>
      <h2 id="authTitle">Acesse sua conta</h2>
      <p id="authDescription" class="muted">Entre com seus dados de acesso.</p></div>
      <form id="authForm" class="form-stack">
        <label class="auth-field"><span>Usuário</span><div class="auth-input-wrap"><span class="auth-input-icon" aria-hidden="true">@</span><input id="authUsername" name="username" type="text" maxlength="32" autocomplete="username" placeholder="Insira o usuário"></div></label>
        <label class="auth-field"><span>Senha</span><div class="auth-input-wrap"><span class="auth-input-icon" aria-hidden="true">▣</span><input id="authPassword" name="password" type="password" required maxlength="128" autocomplete="current-password" placeholder="Insira a senha"><button class="password-toggle" type="button" data-password-target="authPassword" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div></label>
        <label id="authConfirmWrap" class="auth-field" hidden><span>Confirme a senha</span><div class="auth-input-wrap"><span class="auth-input-icon" aria-hidden="true">▣</span><input id="authPasswordConfirm" name="confirmPassword" type="password" maxlength="128" autocomplete="new-password"><button class="password-toggle" type="button" data-password-target="authPasswordConfirm" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div></label>
        <label id="rememberLoginWrap" class="remember-login"><input id="rememberLogin" type="checkbox"><span><b>Lembrar usuário e senha neste dispositivo</b><small>A senha fica protegida no gerenciador do navegador.</small></span></label>
        <button id="authSubmit" class="button primary full auth-submit" type="submit">Entrar <span>→</span></button>
      </form>
      <button id="authToggle" class="text-button auth-toggle" type="button">Criar cadastro de revendedor</button>
      <a class="text-button auth-public-ranking" href="/ranking">Ver ranking público do mês →</a>
      <div class="auth-note"><span class="auth-note-icon">✓</span><p><b>Privacidade protegida</b><span id="authNoteText">Seus dados de acesso são protegidos.</span></p></div>
    </div><div class="auth-copyright">KEYDESK <span>·</span> AMBIENTE PRIVADO</div></section>
  </main>`;
  const formElement = document.getElementById('authForm');
  const usernameInput = document.getElementById('authUsername');
  const passwordInput = document.getElementById('authPassword');
  const confirmInput = document.getElementById('authPasswordConfirm');
  const confirmWrap = document.getElementById('authConfirmWrap');
  const submitButton = document.getElementById('authSubmit');
  const toggleButton = document.getElementById('authToggle');
  const rememberLoginInput = document.getElementById('rememberLogin');
  const rememberLoginWrap = document.getElementById('rememberLoginWrap');
  let savedUsername = '';
  try { savedUsername = localStorage.getItem('keydesk-remembered-username') || ''; } catch {}
  const setMode = register => {
    registerMode = register;
    formElement.reset();
    document.getElementById('authTitle').textContent = register ? 'Criar cadastro' : 'Acesse sua conta';
    document.getElementById('authDescription').textContent = register
      ? 'Crie seu acesso para revender. O saldo inicial é de 0 créditos.'
      : 'Entre com seus dados de acesso.';
    document.getElementById('authNoteText').textContent = register
      ? 'Seu cadastro é somente de revendedor.'
      : 'Seus dados de acesso são protegidos.';
    usernameInput.required = register;
    usernameInput.autocomplete = 'username';
    usernameInput.value = register ? '' : savedUsername;
    rememberLoginWrap.hidden = register;
    rememberLoginInput.checked = !register && Boolean(savedUsername);
    passwordInput.minLength = register ? 10 : 0;
    passwordInput.autocomplete = register ? 'new-password' : 'current-password';
    confirmWrap.hidden = !register;
    confirmInput.required = register;
    submitButton.innerHTML = register ? 'Criar cadastro <span>→</span>' : 'Entrar <span>→</span>';
    toggleButton.textContent = register ? 'Já tenho cadastro — entrar' : 'Criar cadastro de revendedor';
  };
  toggleButton.addEventListener('click', () => setMode(!registerMode));
  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    const username = String(form.get('username') || '').trim();
    const password = String(form.get('password') || '');
    const confirmPassword = String(form.get('confirmPassword') || '');
    if (registerMode && password !== confirmPassword) { toast('As senhas não coincidem.', 'error'); return; }
    const button = submitButton; button.disabled = true; button.textContent = 'Aguarde…';
    try {
      const result = await api(registerMode ? '/api/register' : '/api/login', {
        method:'POST',
        body:JSON.stringify(registerMode
          ? { username, password, confirmPassword }
          : { username, password })
      });
      if (!registerMode) {
        const remember = rememberLoginInput.checked && Boolean(username);
        try {
          if (remember) {
            localStorage.setItem('keydesk-remembered-username', username);
            savedUsername = username;
            if (window.PasswordCredential && navigator.credentials?.store) {
              const credential = new PasswordCredential({ id: username, password, name: username });
              await navigator.credentials.store(credential);
            }
          } else {
            localStorage.removeItem('keydesk-remembered-username');
            savedUsername = '';
          }
        } catch {}
      }
      state.user = result.user; state.csrf = result.csrfToken; await loadData(); if (result.warning) toast(result.warning, 'error'); await handleRechargeReturn();
    } catch(err) {
      toast(err.message, 'error'); button.disabled = false;
      button.innerHTML = registerMode ? 'Criar cadastro <span>→</span>' : 'Entrar <span>→</span>';
    }
  });
  setMode(false);
}
function badge(status, reseller=false) {
  const labels = { active:'Ativa', pending:'Ainda não iniciada', paused:'Pausada', expired:'Expirada', not_found:reseller?'Ainda não iniciada':'Não localizada no app', sync_error:reseller?'Status indisponível':'Firebase indisponível' };
  return `<span class="badge ${esc(status)}"><i></i>${labels[status] || esc(status)}</span>`;
}
function rechargeBadge(status) {
  const labels = { paid:'Pago', pending:'Aguardando Pix', expired:'Expirada', refunded:'Estornada', failed:'Falhou' };
  return `<span class="badge ${esc(status)}"><i></i>${labels[status] || esc(status)}</span>`;
}
function topbar() {
  const owner = state.user.role === 'owner';
  const tabs = owner ? [['overview','Visão geral'],['resellers','Revendedores'],['recharges','Recargas'],['ranking','Ranking'],['keys','Keys'],['activity','Atividade']] : [['overview','Visão geral'],['recharges','Recargas'],['ranking','Ranking'],['keys','Minhas keys']];
  return `<header class="topbar"><a class="brand-mini" href="#"><img class="brand-logo-mark" src="./keydesk-logo.png" alt="Logo Keydesk"><span>KEYDESK</span></a>
    <nav class="main-nav">${tabs.map(([id,label]) => `<button class="nav-link ${state.tab===id?'selected':''}" data-tab="${id}">${label}</button>`).join('')}</nav>
    <div class="top-user"><div class="avatar">${owner?'K':esc((state.user.username||'R')[0].toUpperCase())}</div><div class="user-meta"><strong>${owner?'KEYDESK':esc(state.user.username)}</strong><span>Conta</span></div><button class="icon-button theme-toggle" data-action="toggle-theme" title="Alternar tema claro/escuro" aria-label="Ativar tema ${state.theme==='dark'?'claro':'escuro'}">${state.theme==='dark'?'☀':'◐'}</button><button class="icon-button" data-action="logout" title="Sair" aria-label="Sair">↗</button></div></header>`;
}
function shell(content) {
  const resellerTools = state.user.role === 'reseller' ? `<div class="head-tools"><div class="credit-pill"><span class="credit-icon">✦</span><div><b>${creditText(state.user.credits)}</b><small>créditos disponíveis</small></div></div><button class="text-button" data-tab="recharges">Adicionar créditos →</button></div>` : '';
  appRoot.innerHTML = `${topbar()}<main class="page"><div class="page-head"><div><div class="eyebrow">KEYDESK</div><h1>${pageTitle()}</h1><p>${pageSubtitle()}</p></div>${resellerTools}</div>${content}<footer class="footer">${state.user.role==='owner'?'KEYDESK · Auditoria local com cópia no Firebase · Keys sincronizadas com Firebase.':'KEYDESK · Painel de revenda.'}</footer></main>`;
}
function pageTitle() {
  const map={ overview:state.user.role==='owner'?'Visão geral':'Olá, '+(state.user.username||'revendedor'), resellers:'Revendedores', recharges:'Recargas', ranking:'Top 5 de recargas do mês', keys:state.user.role==='owner'?'Gerenciar keys':'Minhas keys', activity:'Registro de atividade' };
  return map[state.tab] || 'Painel';
}
function pageSubtitle() {
  const map={ overview:state.user.role==='owner'?'Acompanhe revendedores, saldos e keys em um só lugar.':'Gere keys e acompanhe seu saldo em um só lugar.', resellers:'Crie acessos, ajuste saldos e defina o prefixo de cada revendedor.', recharges:state.user.role==='owner'?'Confira o histórico e o Top 5 de créditos recarregados no mês.':'Compre créditos via Pix. A cada 10 créditos pagos, 1 é brinde.', ranking:'Top 5 revendedores por créditos comprados em recargas confirmadas neste mês.', keys:state.user.role==='owner'?'Consulte, copie, resete, pause ou remova keys.':'Veja se estão ativas, expiradas ou ainda não iniciadas. Resetar remove só o dispositivo; a validade continua correndo.', activity:'Ações recentes realizadas no painel.' };
  return map[state.tab] || '';
}
function statCard(label,value,sub,icon) { return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${value}</div><div class="stat-sub">${sub}</div></article>`; }
function currentRankingMonthLabel() { return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date()); }
function rankingMonthLabel(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return currentRankingMonthLabel();
  return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'})
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12)));
}
function ownerOverview() {
  const m=state.data.metrics; const recent=state.data.keys.slice(0,5); const ranking=state.data.rechargeRanking||[];
  const firebaseNotice=state.data.firebaseAvailable?`<section class="notice live-notice"><span class="notice-icon">✓</span><div><b>Realtime Database conectado</b><p>Path <code>${esc(state.data.firebasePath||'/proxyAndroid/keys')}</code> · ${Number(state.data.firebaseKeyCount)||0} registro(s) lido(s). Keys emitidas são gravadas nesse caminho.</p></div><span class="live-pill"><i></i> online</span></section>`:`<section class="notice warning"><span class="notice-icon">!</span><div><b>Firebase indisponível</b><p>${esc(state.data.firebaseError||'O painel não conseguiu consultar o Realtime Database. Verifique conexão e regras de acesso.')}</p></div></section>`;
  return `<section class="stats-grid">${statCard('Revendedores ativos',m.resellers,'Acessos habilitados','◎')}${statCard('Créditos em circulação',creditText(m.credits),'Saldo somado','✦')}${statCard('Keys emitidas',m.keys,'Criadas por este painel','⌁')}${statCard('Dispositivos conectados',m.connectedDevices,'Estado recebido do app','◉')}</section>
    <div class="content-grid"><section class="panel"><div class="panel-head"><div><h3>Keys recentes</h3><p>Últimas keys geradas no painel</p></div><button class="text-button" data-tab="keys">Ver todas →</button></div>${recent.length?keyTable(recent,true):empty('Ainda não há keys geradas.','As keys aparecerão aqui quando um revendedor gerar uma.')}</section>
    <section class="panel"><div class="panel-head"><div><h3>Revendedores</h3><p>Visão rápida dos saldos</p></div><button class="text-button" data-tab="resellers">Gerenciar →</button></div>${state.data.resellers.length?`<div class="mini-list">${state.data.resellers.slice(0,5).map(r=>`<div class="mini-row"><div class="avatar pale">${esc(r.username[0].toUpperCase())}</div><div class="mini-main"><b>${esc(r.username)}</b><small>${esc(r.prefix)}</small></div><strong>${creditText(r.credits)} <small>cr</small></strong></div>`).join('')}</div>`:empty('Sem revendedores','Crie o primeiro acesso na área de revendedores.')}</section></div>
    ${ownerRechargeRankingPanel(ranking)}
    ${firebaseNotice}`;
}
function rankingRows(ranking, large=false) {
  return `<div class="ranking-list">${ranking.map((row,index)=>`<div class="ranking-row ${large?'ranking-row-large':''}"><span class="ranking-position ${index<3?'podium-'+(index+1):''}">${index+1}</span><div class="ranking-person"><b>${esc(row.username)}</b><small>Recarregou ${creditText(row.creditsRecharged)} créditos neste mês · ${Number(row.paidRecharges)||0} Pix confirmado${Number(row.paidRecharges)===1?'':'s'} · ${creditText(row.bonusCredits)} de bônus</small></div><div class="ranking-metrics"><strong>${creditText(row.creditsRecharged)} cr</strong><small>${money(row.paidAmountCents)} pagos</small></div></div>`).join('')}</div>`;
}
function ownerRechargeRankingPanel(ranking=state.data.rechargeRanking||[], large=false) {
  return `<section class="panel ranking-panel owner-recharge-ranking"><div class="panel-head"><div><span class="eyebrow">RANKING MENSAL · ${esc(currentRankingMonthLabel())}</span><h3>Top 5 — quem mais recarregou créditos</h3><p>Soma os créditos comprados em recargas pagas neste mês. O bônus aparece separado; pendências e estornos não entram.</p></div>${state.tab==='ranking'?'<span class="step-chip">TOP 5</span>':'<button class="text-button" data-tab="ranking">Ver ranking →</button>'}</div>${ranking.length?rankingRows(ranking,large):empty('Ainda sem recargas pagas neste mês','Após a confirmação de um Pix neste mês, a pessoa e os créditos recarregados aparecerão aqui.')}</section>`;
}
function rankingPage() {
  const ranking = state.data.rechargeRanking || [];
  const totalCredits = ranking.reduce((sum, row) => sum + (Number(row.creditsRecharged) || 0), 0);
  const confirmedCount = ranking.reduce((sum, row) => sum + (Number(row.paidRecharges) || 0), 0);
  return `<section class="ranking-hero"><div><span class="eyebrow">${esc(currentRankingMonthLabel())}</span><h2>Top 5 do mês</h2><p>Quem mais recarregou créditos em pagamentos confirmados neste mês.</p></div><div class="ranking-hero-stats"><div><small>Créditos recarregados no top 5</small><b>${creditText(totalCredits)}</b></div><div><small>Recargas confirmadas</small><b>${confirmedCount}</b></div></div></section>
    <div class="ranking-share-action"><a class="button secondary" href="/ranking" target="_blank" rel="noopener">Abrir ranking público <span>↗</span></a></div>
    ${ownerRechargeRankingPanel(ranking,true)}`;
}
async function publicRankingPage() {
  document.title = 'Top 5 público — Keydesk';
  loading();
  try {
    const result = await api('/api/public/ranking', { cache:'no-store' });
    const ranking = Array.isArray(result.ranking) ? result.ranking : [];
    const totalCredits = ranking.reduce((sum, row) => sum + (Number(row.creditsRecharged) || 0), 0);
    const confirmedCount = ranking.reduce((sum, row) => sum + (Number(row.paidRecharges) || 0), 0);
    const monthLabel = rankingMonthLabel(result.monthKey);
    document.title = `Top 5 público — ${monthLabel} | Keydesk`;
    appRoot.innerHTML = `<header class="topbar public-ranking-header"><a class="brand-mini" href="/" aria-label="Keydesk — voltar ao acesso"><img class="brand-logo-mark" src="./keydesk-logo.png" alt=""><span>KEYDESK</span></a><div class="top-user"><button class="icon-button theme-toggle" data-action="toggle-theme" type="button" title="Alternar tema claro/escuro" aria-label="Ativar tema ${state.theme==='dark'?'claro':'escuro'}">${state.theme==='dark'?'☀':'◐'}</button><a class="button primary" href="/">Acessar painel <span>→</span></a></div></header>
      <main class="page public-ranking-page"><div class="page-head"><div><div class="eyebrow">RANKING PÚBLICO · ${esc(monthLabel)}</div><h1>Top 5 de recargas</h1><p>Veja quem mais comprou créditos em pagamentos confirmados neste mês.</p></div></div>
        <section class="ranking-hero"><div><span class="eyebrow">${esc(monthLabel)}</span><h2>Top 5 do mês</h2><p>Classificação pelas recargas pagas e confirmadas no mês, no fuso de São Paulo.</p></div><div class="ranking-hero-stats"><div><small>Créditos recarregados no Top 5</small><b>${creditText(totalCredits)}</b></div><div><small>Recargas confirmadas</small><b>${confirmedCount}</b></div></div></section>
        <section class="panel ranking-panel ranking-page-panel"><div class="panel-head"><div><span class="eyebrow">RANKING MENSAL · ${esc(monthLabel)}</span><h3>Top 5 — quem mais recarregou créditos</h3><p>O bônus aparece separado; pagamentos pendentes e estornados não entram.</p></div><span class="step-chip">PÚBLICO</span></div>${ranking.length?rankingRows(ranking,true):empty('Ainda sem recargas pagas neste mês','Após a confirmação de um Pix neste mês, a pessoa e os créditos recarregados aparecerão aqui.')}<p class="public-ranking-note">Esta página é pública. Ela mostra os usuários classificados, créditos comprados, Pix confirmados, bônus e valores pagos do Top 5.</p></section>
        <footer class="footer">KEYDESK · Ranking mensal público · Atualizado ao abrir.</footer></main>`;
  } catch (err) {
    appRoot.innerHTML = `<main class="error-screen"><div class="brand-mark">K</div><h1>Não foi possível carregar o ranking</h1><p>${esc(err.message)}</p><p><a class="button secondary" href="/ranking">Tentar novamente</a> <a class="button primary" href="/">Voltar ao acesso</a></p></main>`;
  }
}
function resellerOverview() {
  const plans=state.data.plans; const selected=plans.some(p=>p.id===state.selectedPlan)?state.selectedPlan:(state.selectedPlan=plans[0]?.id||'1h');
  const prefixUnlocked=Boolean(state.user.prefixUnlocked); const prefixCost=prefixUnlocked?2:5;
  const prefixDescription=prefixUnlocked
    ? `Atual: <code>${esc(state.user.prefix)}</code>. Liberado permanentemente para as próximas keys. Cada modificação custa 2 créditos.`
    : `Atual: <code>${esc(state.user.prefix)}</code>. A liberação custa 5 créditos uma única vez; depois, seu direito permanece e cada modificação custa 2 créditos.`;
  const prefixAction=prefixUnlocked?'Modificar prefixo por 2 créditos':'Liberar prefixo por 5 créditos';
  const prefixChip=prefixUnlocked?'MODIFICAÇÃO: 2 CRÉDITOS':'LIBERAÇÃO ÚNICA: 5 CRÉDITOS';
  return `<section class="reseller-hero"><div><div class="eyebrow">SEU SALDO DISPONÍVEL</div><h2>${creditText(state.user.credits)} <span>créditos</span></h2><p>Compre créditos na aba Recargas e ganhe 1 bônus a cada 10 pagos.</p></div><div class="hero-star">✦</div><div class="hero-orbit"></div></section>
  <section class="panel prefix-purchase-panel"><div class="panel-head"><div><span class="eyebrow">PREFIXO PERSONALIZADO</span><h3>Use sua própria marca nas keys</h3><p>${prefixDescription}</p></div><span class="step-chip">${prefixChip}</span></div><form id="resellerPrefixForm" class="prefix-purchase-form"><label>Novo prefixo<input name="prefix" type="text" maxlength="64" placeholder="Ex.: MinhaMarca" required></label><button class="button secondary" type="submit">${prefixAction} <span>→</span></button></form><div class="format-note"><span>✦</span><p>Depois de liberar o prefixo, ele fica salvo sem cobrança por key. Apenas uma modificação futura desconta 2 créditos.</p></div></section>
  <section class="panel generate-panel"><div class="panel-head"><div><span class="eyebrow">GERADOR</span><h3>Escolha sua validade</h3><p>Prefixo individual <code>${esc(state.user.prefix)}</code> · o app controla a ativação</p></div><span class="step-chip">LOTE DE KEYS</span></div>
  <input id="planSelect" type="hidden" value="${esc(selected)}"><div class="duration-plans">${plans.map(p=>`<button type="button" class="duration-option ${selected===p.id?'selected':''}" data-plan-pick="${esc(p.id)}" aria-pressed="${selected===p.id}"><span class="duration-label">${esc(p.label)}</span><strong>${creditText(p.cost)}</strong><small>${p.cost===1?'crédito':'créditos'} / key</small></button>`).join('')}</div>
  <div class="generate-controls"><label>Quantidade<input id="keyQuantity" type="number" min="1" max="100" step="1" value="1"></label><button class="button primary generate-submit" data-action="generate">Gerar e enviar ao app <span>→</span></button></div>
  <div class="format-note"><span>✳</span><p><b>Formato:</b> prefixo em maiúsculas + hífen + 6 letras/números aleatórios. Ex.: <code>GOLDCHEATS-A7K9Q2</code></p></div></section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">HISTÓRICO</span><h3>Suas keys</h3><p>Veja o status e copie ou gerencie suas keys.</p></div><button class="text-button" data-tab="keys">Ver todas →</button></div>${state.data.keys.length?keyTable(state.data.keys.slice(0,5),false):empty('Ainda não há keys','As keys que você gerar aparecerão aqui.')}</section>`;
}
function rechargePage() {
  const owner=state.user.role==='owner'; const rows=state.data.recharges;
  const form = owner ? '' : `<section class="panel recharge-panel"><div class="panel-head"><div><span class="eyebrow">RECARGA VIA PIX</span><h3>Adicione créditos ao seu saldo</h3><p>R$ 1,00 por crédito antes do desconto. A cada 10 pagos, ganha 1 crédito extra.</p></div><span class="step-chip">BOTA PIX</span></div><form id="rechargeForm" class="recharge-form"><label>Quantos créditos deseja comprar?<input id="rechargeCredits" name="credits" type="number" min="1" max="10000" step="1" value="10" required></label><div class="recharge-summary"><div><span>Preço original</span><strong id="rechargeOriginalAmount">R$ 10,00</strong></div><div><span>Desconto</span><strong id="rechargeDiscount">-0%</strong></div><div><span>Valor no Pix</span><strong id="rechargeAmount">R$ 10,00</strong></div><div><span>Total no saldo</span><strong id="rechargeTotal">11 créditos</strong><small id="rechargeBonus">+1 brinde</small></div></div><button class="button primary" type="submit">Criar cobrança Pix <span>→</span></button></form><div class="format-note recharge-note"><span>✓</span><p><b>Descontos:</b> de 20 a 30 créditos: 1%; 31 a 40: 4%; 41 a 50: 6%; 51 a 60: 8%; 61 a 70: 10%; 71 a 80: 12%; 81 a 90: 14%; 91 a 250: 16%; a partir de 251: 22%. A cobrança abre em uma página segura do BotaPix e o saldo só é liberado após a confirmação.</p></div></section>`;
  return `${form}${owner?ownerRechargeRankingPanel(state.data.rechargeRanking||[],true):''}<section class="panel"><div class="panel-head"><div><span class="eyebrow">${owner?'HISTÓRICO GERAL':'SEU HISTÓRICO'}</span><h3>Recargas</h3><p>${owner?'Pagamentos e créditos concedidos aos revendedores.':'Acompanhe cobranças, Pix pendentes e créditos recebidos.'}</p></div><span class="step-chip">${rows.length} REGISTRO${rows.length===1?'':'S'}</span></div>${rows.length?rechargeTable(rows,owner):empty('Nenhuma recarga ainda',owner?'As recargas dos revendedores aparecerão aqui.':'Escolha uma quantidade acima para criar sua primeira cobrança Pix.')}</section>`;
}
function rechargeTable(rows,owner) {
  return `<div class="table-wrap"><table class="data-table recharge-table"><thead><tr>${owner?'<th>REVENDEDOR</th>':''}<th>VALOR</th><th>CRÉDITOS</th><th>STATUS</th><th>CRIADA EM</th><th>AÇÕES</th></tr></thead><tbody>${rows.map(r=>{const action=r.status==='pending'&&r.paymentUrl?`<button class="small-button" data-action="open-recharge" data-url="${esc(r.paymentUrl)}">Abrir Pix</button>`:'';const check=r.status==='pending'&&r.providerReference?`<button class="small-button" data-action="check-recharge" data-id="${r.id}">Atualizar</button>`:'';const dismiss=!owner&&r.status==='pending'?`<button class="small-button danger-text" title="Remove esta pendência da sua lista; não cancela o Pix no BotaPix" data-action="dismiss-recharge" data-id="${r.id}">Não vou pagar</button>`:'';return `<tr>${owner?`<td><strong>${esc(r.reseller)}</strong></td>`:''}<td><b>${money(r.amountCents)}</b></td><td><b>${creditText(r.totalCredits)}</b> cr<small class="cell-sub">${creditText(r.purchasedCredits)} + ${creditText(r.bonusCredits)} brinde</small></td><td>${rechargeBadge(r.status)}</td><td>${date(r.createdAt)}</td><td><div class="row-actions">${action}${check}${dismiss}</div></td></tr>`;}).join('')}</tbody></table></div>`;
}
function resellersPage() {
  const rows=state.data.resellers;
  return `<section class="panel"><div class="panel-head"><div><h3>Novo revendedor</h3><p>Crie as credenciais e defina o saldo inicial e o prefixo.</p></div><span class="step-chip">ACESSOS</span></div><form id="createReseller" class="form-grid"><label>Usuário<input name="username" required minlength="3" maxlength="32" placeholder="ex.: revendedor01"></label><label>Senha individual<div class="password-field-wrap"><input id="newResellerPassword" name="password" required minlength="10" type="password" placeholder="Mínimo de 10 caracteres"><button class="password-toggle" type="button" data-password-target="newResellerPassword" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div></label><label>Créditos iniciais<input name="credits" type="number" min="0" step="0.5" value="0" required></label><label>Qual é o prefixo para gerar?<input name="prefix" maxlength="64" value="GoldCheats" placeholder="Ex.: GoldCheats" required></label><div class="form-action"><button class="button primary" type="submit">Criar revendedor <span>→</span></button></div></form></section>
  <section class="panel"><div class="panel-head"><div><h3>Contas cadastradas</h3><p>${rows.length} revendedor${rows.length===1?'':'es'} no painel</p></div></div>${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>USUÁRIO</th><th>SALDO</th><th>PREFIXO</th><th>STATUS</th><th>CADASTRADO</th><th>GERENCIAR</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.username)}</strong></td><td><b>${creditText(r.credits)}</b> cr</td><td><form class="prefix-edit-form" data-prefix-form data-id="${r.id}"><input name="prefix" type="text" value="${esc(r.prefix)}" maxlength="64" required aria-label="Prefixo de ${esc(r.username)}"><button class="small-button" type="submit">Salvar</button></form></td><td><span class="badge ${r.active?'active':'paused'}"><i></i>${r.active?'Ativo':'Bloqueado'}</span></td><td>${date(r.createdAt)}</td><td><div class="row-actions"><button class="small-button" data-action="add-credit" data-id="${r.id}" data-name="${esc(r.username)}">Adicionar</button><button class="small-button" data-action="remove-credit" data-id="${r.id}" data-name="${esc(r.username)}">Remover créditos</button><button class="small-button" data-action="reset-reseller-password" data-id="${r.id}" data-name="${esc(r.username)}">Redefinir senha</button><button class="small-button danger-text" data-action="remove-reseller" data-id="${r.id}" data-name="${esc(r.username)}">Remover acesso</button></div></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhum revendedor ainda','Use o formulário acima para criar uma conta.')}</section>`;
}
function keysPage() {
  const owner=state.user.role==='owner'; const keys=state.data.keys;
  const description=owner?`${keys.length} registro${keys.length===1?'':'s'} visível${keys.length===1?'':'is'}${state.data.firebaseAvailable?' · sincronizado com o app':' · Firebase indisponível'}`:'Copie e gerencie suas keys. O reset só desvincula o dispositivo; a validade continua correndo.';
  return `<section class="panel"><div class="panel-head"><div><h3>${owner?'Keys emitidas':'Minhas keys'}</h3><p>${description}</p></div><div class="row-actions"><button class="small-button refresh-keys-button" type="button" data-action="refresh-keys">Atualizar lista <span aria-hidden="true">↻</span></button><span class="step-chip">${owner?'MONITORAMENTO':'KEYS'}</span></div></div>${keys.length?keyTable(keys,owner):empty('Nenhuma key encontrada',owner?'As keys geradas pelos revendedores aparecerão aqui.':'Gere sua primeira key na visão geral.')}</section>`;
}
function activityPage() {
  const labels={login:'Login realizado',owner_setup:'Acesso do dono configurado',reseller_created:'Revendedor criado',reseller_removed:'Acesso de revendedor removido',reseller_updated:'Conta de revendedor atualizada',credits_adjusted:'Créditos ajustados',recharge_created:'Cobrança Pix criada',recharge_paid:'Recarga confirmada e créditos liberados',recharge_dismissed:'Pendência removida da lista do revendedor',recharge_refunded:'Recarga estornada',key_generation_reserved:'Geração iniciada',key_generation_failed:'Geração cancelada · saldo estornado',key_generated:'Key(s) enviada(s) ao app',key_reset:'Dispositivo resetado',key_paused:'Key pausada no app',key_activated:'Key retomada no app',key_deleted:'Key excluída'};
  return `<section class="panel"><div class="panel-head"><div><h3>Atividade recente</h3><p>${state.data.firebaseAuditAvailable===false?'Firebase indisponível; mostrando registros locais.':'Eventos copiados para Firebase e registros locais mais recentes.'}</p></div></div>${state.data.audit.length?`<div class="activity-list">${state.data.audit.map(a=>{let info={};try{info=JSON.parse(a.details)}catch{};return `<article class="activity-row"><div class="activity-dot"></div><div class="activity-main"><b>${esc(labels[a.action]||a.action)}</b><small>${esc(a.actor)}${info.reseller?' · '+esc(info.reseller):''}${info.delta?` · ${info.delta>0?'+':''}${info.delta} créditos`:''}</small></div><time>${date(a.createdAt)}</time></article>`}).join('')}</div>`:empty('Sem atividades','As operações realizadas serão registradas aqui.')}</section>`;
}
function empty(title,sub) { return `<div class="empty-state"><span class="empty-icon">⌁</span><b>${title}</b><p>${sub}</p></div>`; }
function render() {
  if (!state.user || !state.data) return;
  if (state.user.role==='reseller' && state.tab==='resellers') state.tab='overview';
  if (state.user.role==='reseller' && state.tab==='activity') state.tab='overview';
  let content='';
  if (state.tab==='overview') content=state.user.role==='owner'?ownerOverview():resellerOverview();
  if (state.tab==='resellers') content=resellersPage();
  if (state.tab==='recharges') content=rechargePage();
  if (state.tab==='ranking') content=rankingPage();
  if (state.tab==='keys') content=keysPage();
  if (state.tab==='activity') content=activityPage();
  shell(content);
  if (state.tab==='recharges' && state.user.role==='reseller') updateRechargePreview();
}
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
async function refresh(message) { await loadData(); if(message) toast(message); }
function updateRechargePreview() {
  const input=document.getElementById('rechargeCredits'); if(!input) return;
  const credits=Math.max(0, Math.floor(Number(String(input.value).replace(',','.'))||0)); const bonus=Math.floor(credits/10); const discount=rechargeDiscountPercent(credits); const original=credits*100; const amount=Math.round(original*(100-discount)/100);
  const amountEl=document.getElementById('rechargeAmount'); const originalEl=document.getElementById('rechargeOriginalAmount'); const discountEl=document.getElementById('rechargeDiscount'); const bonusEl=document.getElementById('rechargeBonus'); const total=document.getElementById('rechargeTotal');
  if(originalEl) originalEl.textContent=money(original); if(discountEl) discountEl.textContent=`-${discount}%`; if(amountEl) amountEl.textContent=money(amount); if(bonusEl) bonusEl.textContent=`+${creditText(bonus)}`; if(total) total.textContent=`${creditText(credits+bonus)} crédito${credits+bonus===1?'':'s'}`;
}
appRoot.addEventListener('click', async e => {
  const passwordToggle=e.target.closest('[data-password-target]');
  if(passwordToggle){e.preventDefault();const input=document.getElementById(passwordToggle.dataset.passwordTarget);if(input){const visible=input.type==='password';input.type=visible?'text':'password';passwordToggle.textContent=visible?'Ocultar':'Mostrar';passwordToggle.setAttribute('aria-label',`${visible?'Ocultar':'Mostrar'} senha`);passwordToggle.setAttribute('aria-pressed',String(visible));}return;}
  const planPick=e.target.closest('[data-plan-pick]'); if(planPick){state.selectedPlan=planPick.dataset.planPick;const hidden=document.getElementById('planSelect');if(hidden)hidden.value=state.selectedPlan;document.querySelectorAll('[data-plan-pick]').forEach(el=>{const selected=el===planPick;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});return;}
  const tab=e.target.closest('[data-tab]'); if(tab){state.tab=tab.dataset.tab;render();return;}
  const copy=e.target.closest('[data-copy]'); if(copy){try{await navigator.clipboard.writeText(copy.dataset.copy);toast('Key copiada para a área de transferência.');}catch{toast('Não foi possível copiar neste navegador.','error');}return;}
  const btn=e.target.closest('[data-action]'); if(!btn)return;
  const id=btn.dataset.id; const action=btn.dataset.action;
  try {
    if(action==='toggle-theme'){
      state.theme=state.theme==='dark'?'light':'dark';
      document.documentElement.dataset.theme=state.theme;
      try { localStorage.setItem('keydesk-theme',state.theme); } catch {}
      if(state.user&&state.data) render();
      else document.querySelectorAll('[data-action="toggle-theme"]').forEach(toggle=>{toggle.textContent=state.theme==='dark'?'☀':'◐';toggle.setAttribute('aria-label',`Ativar tema ${state.theme==='dark'?'claro':'escuro'}`);});
      return;
    }
    if(action==='refresh-keys'){
      const original=btn.innerHTML;btn.disabled=true;btn.textContent='Atualizando…';
      try { await loadData(); toast('Lista de keys atualizada.'); }
      catch(err) { btn.disabled=false;btn.innerHTML=original;throw err; }
      return;
    }
    if(action==='logout'){await api('/api/logout',{method:'POST'});state.user=null;state.data=null;state.tab='overview';await init();}
    if(action==='open-recharge'){const popup=window.open(btn.dataset.url,'_blank');if(popup)popup.opener=null;else location.href=btn.dataset.url;}
    if(action==='check-recharge'){btn.disabled=true;const out=await api(`/api/recharges/${id}`);await loadData();toast(out.recharge.status==='paid'?'Pagamento confirmado; créditos adicionados.':'Ainda aguardando a confirmação do Pix.');}
    if(action==='dismiss-recharge'){
      if(!confirm('Remover esta cobrança pendente do seu histórico? Isso não cancela o Pix no BotaPix. Se o pagamento ainda for confirmado, os créditos serão liberados e a recarga voltará a aparecer.'))return;
      btn.disabled=true;
      try { await api(`/api/recharges/${id}/dismiss`,{method:'POST',body:'{}'}); await refresh('Cobrança removida da sua lista. O proprietário mantém o registro.'); }
      catch(err) { btn.disabled=false; throw err; }
    }
    if(action==='generate'){const planId=document.getElementById('planSelect')?.value;const quantity=Number(document.getElementById('keyQuantity')?.value||1);btn.disabled=true;const out=await api('/api/keys',{method:'POST',body:JSON.stringify({planId,quantity})});await loadData();toast(state.user.role==='owner'?`${out.keys.length} key(s) gravada(s) no Firebase (${out.plan}) · custo ${creditText(out.totalCost)} crédito(s).`:'Keys geradas e disponíveis na aba Minhas keys.');}
    if(action==='add-credit'||action==='remove-credit'){const adding=action==='add-credit';const amount=prompt(`Quantos créditos deseja ${adding?'adicionar ao':'remover do'} saldo de ${btn.dataset.name}? Use incrementos de 0,5.`);if(amount===null)return;const quantity=Number(String(amount).replace(',','.'));if(!Number.isFinite(quantity)||quantity<=0||Math.abs(quantity*2-Math.round(quantity*2))>1e-8)throw new Error('Informe uma quantidade maior que zero, em incrementos de 0,5.');const reason=prompt('Motivo do ajuste:','Ajuste manual')||'Ajuste manual';const delta=adding?quantity:-quantity;await api(`/api/resellers/${id}/credits`,{method:'PATCH',body:JSON.stringify({delta,reason})});await refresh(adding?'Créditos adicionados.':'Créditos removidos.');}
    if(action==='reset-reseller-password'){const password=prompt(`Digite uma nova senha individual para ${btn.dataset.name} (mínimo 10 caracteres).`);if(password===null)return;if(password.length<10)throw new Error('A senha do revendedor deve ter pelo menos 10 caracteres.');await api(`/api/resellers/${id}`,{method:'PATCH',body:JSON.stringify({password})});await refresh('Senha redefinida. Envie a nova senha diretamente ao revendedor.');}
    if(action==='remove-reseller'){const name=btn.dataset.name||'este revendedor';if(!confirm(`Remover o acesso de ${name}? O login será bloqueado imediatamente e o usuário poderá ser criado novamente depois. O saldo restante ficará arquivado, não será transferido, e as keys já geradas continuarão no Firebase e no histórico do dono.`))return;await api(`/api/resellers/${id}`,{method:'DELETE'});await refresh(`Acesso de ${name} removido. As keys existentes foram preservadas.`);}
    if(action==='pause'||action==='activate'){const status=action==='pause'?'paused':'active';if(!confirm(status==='paused'?'Pausar esta key no app? A validade continua correndo e os créditos não mudam.':'Retomar esta key no app? A validade continua correndo e os créditos não mudam.'))return;await api(`/api/keys/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await refresh(status==='paused'?'Key pausada.':'Key reativada.');}
    if(action==='reset'){if(!confirm('Resetar o dispositivo desta key? Somente o dispositivo atual será desvinculado. A validade continua correndo normalmente, mesmo sem aparelho conectado; ela não pausa nem reinicia. Um novo dispositivo poderá usar apenas o tempo restante.'))return;const result=await api(`/api/keys/${id}/reset`,{method:'POST',body:'{}'});await refresh(`Conexão removida do dispositivo para ${result.value}.`);}
    if(action==='delete-key'){if(!confirm('Excluir esta key permanentemente do app e do painel? Isso não altera o saldo de créditos.'))return;await api(`/api/keys/${id}`,{method:'DELETE'});await refresh('Key excluída.');}
  } catch(err){if(action==='generate')btn.disabled=false;toast(err.message,'error');}
});
appRoot.addEventListener('input', e => { if(e.target.id==='rechargeCredits') updateRechargePreview(); });
appRoot.addEventListener('submit', async e => {
  const form=e.target;
  try {
    if(form.matches('[data-prefix-form]')){e.preventDefault();const id=form.dataset.id;const prefix=String(new FormData(form).get('prefix')||'').trim();if(!prefix)throw new Error('Informe um prefixo válido.');const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;try{await api(`/api/resellers/${id}`,{method:'PATCH',body:JSON.stringify({prefix})});await refresh('Prefixo atualizado; vale para as próximas keys.');}finally{if(button)button.disabled=false;}}
    if(form.id==='resellerPrefixForm'){e.preventDefault();const prefix=String(new FormData(form).get('prefix')||'').trim();if(!prefix)throw new Error('Informe o prefixo desejado.');const prefixCost=state.user.prefixUnlocked?2:5;const question=state.user.prefixUnlocked?'Modificar o prefixo custa 2 créditos. Confirmar?':'Liberar seu prefixo permanentemente custa 5 créditos uma única vez. Depois, cada modificação custará 2 créditos. Confirmar?';if(!confirm(question))return;const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;try{const result=await api('/api/reseller/prefix',{method:'POST',body:JSON.stringify({prefix})});await loadData();if(!result.changed)toast('Esse prefixo já está ativo; nenhum crédito foi descontado.');else if(result.unlockedNow)toast('Prefixo liberado permanentemente; 5 créditos descontados.');else toast(`${prefixCost} créditos descontados pela modificação do prefixo.`);}finally{if(button)button.disabled=false;}}
    if(form.id==='createReseller'){e.preventDefault();await api('/api/resellers',{method:'POST',body:JSON.stringify(formObject(form))});form.reset();await refresh('Revendedor criado.');}
    if(form.id==='rechargeForm'){
      e.preventDefault(); const button=form.querySelector('button[type="submit"]'); button.disabled=true;
      const paymentWindow=window.open('about:blank', '_blank');
      if(paymentWindow) paymentWindow.opener=null;
      try {
        const out=await api('/api/recharges',{method:'POST',body:JSON.stringify({credits:Number(form.elements.credits.value)})});
        await loadData();
        if(paymentWindow) paymentWindow.location.replace(out.paymentUrl); else location.href=out.paymentUrl;
        toast(`Cobrança de ${money(out.amountCents)} criada${out.discountPercent ? ` com ${out.discountPercent}% de desconto` : ''}. Pague no Pix para receber ${creditText(out.totalCredits)} créditos.`);
      } catch(err) { if(paymentWindow) paymentWindow.close(); throw err; } finally { button.disabled=false; }
    }
  }catch(err){toast(err.message,'error');}
});
async function refreshPendingRecharges() {
  if (!state.user || state.tab !== 'recharges' || document.visibilityState !== 'visible') return;
  const pending=state.data?.recharges?.filter(r=>r.status==='pending' && (r.providerReference || r.providerChargeId)).slice(0,5) || [];
  if(!pending.length) return;
  await Promise.all(pending.map(r=>api(`/api/recharges/${r.id}`).catch(()=>null)));
  await loadData().catch(()=>{});
}
async function init() {
  if (location.protocol === 'file:') {
    appRoot.innerHTML = '<main class="error-screen"><div class="brand-mark">K</div><h1>Abra pelo Termux</h1><p>Este arquivo ZIP não é o servidor do painel. Extraia os arquivos, execute <code>bash SERVICO_24H.sh start</code> no Termux e abra <code>http://127.0.0.1:3000</code>. Para outras pessoas, compartilhe o link HTTPS mostrado pelo gerenciador.</p></main>';
    return;
  }
  if (location.pathname.replace(/\/+$/, '') === '/ranking') {
    await publicRankingPage();
    return;
  }
  loading();
  try {
    const bootstrap=await api('/api/bootstrap'); state.csrf=bootstrap.csrfToken;
    try { const me=await api('/api/me'); state.user=me.user; state.csrf=me.csrfToken; await loadData(); await handleRechargeReturn(); }
    catch { state.user=null;state.data=null;authScreen(); }
  } catch(err){appRoot.innerHTML=`<main class="error-screen"><div class="brand-mark">K</div><h1>Não foi possível abrir o painel</h1><p>${esc(err.message)}</p><p>Confira se o servidor continua ativo e atualize a página.</p></main>`;}
}
function keyTable(keys,owner) {
  const statusHeaders=`<th>STATUS</th>${owner?'<th>TEMPO RESTANTE</th>':''}`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>KEY</th>${owner?'<th>REVENDEDOR</th>':''}<th>VALIDADE</th>${statusHeaders}<th>GERADA EM</th><th>AÇÕES</th></tr></thead><tbody>${keys.map(k=>{const connected=Boolean(k.deviceConnected);const pauseAction=k.status==='paused'?'activate':'pause';const pauseLabel=k.status==='paused'?'Retomar':'Pausar';const canPause=k.status==='paused'||(connected&&k.status==='active');const statusCells=`<td>${badge(k.status,!owner)}</td>${owner?`<td>${esc(k.remainingText||'—')}</td>`:''}`;return `<tr><td><button class="key-copy" data-copy="${esc(k.value)}" title="Clique para copiar"><code>${esc(k.value)}</code><span>Copiar</span></button></td>${owner?`<td><strong>${esc(k.reseller)}</strong><small class="cell-sub">${esc(k.prefix)}</small></td>`:''}<td>${durationText(k)}</td>${statusCells}<td>${date(k.createdAt)}</td><td><div class="row-actions"><button class="small-button" data-action="${pauseAction}" data-id="${k.id}" ${canPause?'':'disabled title="Disponível após conexão e enquanto a key estiver ativa no app"'}>${pauseLabel}</button><button class="small-button" data-action="reset" data-id="${k.id}" ${connected?'':'disabled title="Disponível após vincular um dispositivo"'}>Resetar dispositivo</button><button class="small-button danger-text" data-action="delete-key" data-id="${k.id}">Excluir</button></div></td></tr>`}).join('')}</tbody></table></div>`;
}

init();
setInterval(() => { if (state.user && state.tab === 'keys' && document.visibilityState === 'visible') loadData().catch(() => {}); }, 15000);
setInterval(() => { refreshPendingRecharges().catch(() => {}); }, 20000);
