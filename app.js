/* MindClass — frontend. Toda a lógica de dados e permissões fica no servidor (server.js). */
import { api as chamar } from './api.js';
import { retornoDoEmail, marcarUso } from './supabase.js';
import * as calendario from './calendario.js';
import * as relatorios from './relatorios.js';
import * as historico from './historico.js';
import * as admin from './admin.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, notifs: [], unread: 0, nav: 0, view: '', es: null, fotoTmp: undefined, atvTab: 'pend', notifFiltro: 'todas', editAtv: null, editHor: null, editEv: null, versao: {}, sujo: false, calMes: '', calDia: '', horTurma: '', horPre: null, notasCtx: { turma: '', materia: '' }, alunosTurma: '' };
const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const ICONES = { nota: '⭐', horario: '🕒', atividade: '📌', lembrete: '⏰', aviso: '📣', turma: '👥', evento: '📅', vinculo: '🔑' };
const ROTULO = { aluno: 'Aluno', professor: 'Professor', administrador: 'Administração' };
// categorias do calendário (cores definidas em extra.css: .cat-prova, .cat-trabalho…)
const CATEG = { prova: 'Prova', trabalho: 'Trabalho', atividade: 'Atividade', evento: 'Evento escolar', reuniao: 'Reunião', outro: 'Outro' };

/* ---------- infraestrutura ---------- */
async function api(method, path, body) {
  try { return await chamar(method, path, body); } catch (e) {
    if (e.status === 401 && S.me && path !== '/api/login') sair(false);
    throw e;
  }
}
function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}
let _opcoes = null;
const opcoes = () => (_opcoes ??= api('GET', '/api/opcoes').catch((e) => { _opcoes = null; throw e; }));
const limparOpcoes = () => { _opcoes = null; };
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
const fmtDH = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtPrazo = (p) => new Date(p).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const primeiroNome = (n) => n.split(' ')[0];
const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const classeMedia = (v) => (v >= 7 ? 'grade-pass' : v >= 5 ? 'grade-warn' : 'grade-fail');
const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const iniciais = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const avatar = (u, cls = '') => `<div class="avatar ${cls}">${u.foto ? `<img src="${esc(u.foto)}" alt="">` : esc(iniciais(u.nome))}</div>`;
const vazio = (ico, txt) => `<div class="empty"><div class="empty-icon">${ico}</div><div class="empty-text">${esc(txt)}</div></div>`;
const opts = (lista, sel, ph) => `${ph ? `<option value="">${esc(ph)}</option>` : ''}${lista.map((x) => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}`;
const corMateria = (nome) => { let h = 0; for (const c of nome) h = (h * 31 + c.charCodeAt(0)) % 360; return `--c:hsl(${h} 65% 42%);--bg-c:hsl(${h} 80% 60% / .13)`; };

async function resizeFoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  const bmp = await createImageBitmap(file);
  const t = 192, c = document.createElement('canvas'); c.width = c.height = t;
  const l = Math.min(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, (bmp.width - l) / 2, (bmp.height - l) / 2, l, l, 0, 0, t, t);
  return c.toDataURL('image/jpeg', 0.82);
}

/* ---------- menus ---------- */
const IC = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  chart: '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 12.5l2 2 4-4.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.7a3.5 3.5 0 010 6.6M18.5 14.3c2 .7 3.5 2.6 3.5 5.7"/>',
  cap: '<path d="M22 9l-10-5L2 9l10 5 10-5z"/><path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-8-8-4 19-6z"/>',
  bell: '<path d="M6 9a6 6 0 0112 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9z"/><path d="M10 21a2 2 0 004 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.7C3.8 8.5 2 12 2 12s3.5 7 10 7c1.5 0 2.8-.3 4-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  month: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  report: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 17v-3M12 17v-5M15 17v-2"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  moon: '<path d="M20.5 13A8.5 8.5 0 1111 3.5a6.5 6.5 0 009.5 9.5z"/>',
};
const registrarIcones = (extra) => Object.assign(IC, extra);
const svg = (k) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
function enhancePw() {
  document.querySelectorAll('input[type=password]').forEach((i) => {
    if (i.parentElement.classList.contains('pw-wrap')) return;
    const w = document.createElement('div'); w.className = 'pw-wrap';
    i.replaceWith(w); w.append(i);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-btn'; b.dataset.act = 'ver-senha';
    b.setAttribute('aria-label', 'Mostrar senha'); b.setAttribute('aria-pressed', 'false'); b.innerHTML = svg('eye');
    w.append(b);
  });
}
const MENU = {
  aluno: [['inicio', 'home', 'Início'], ['notas', 'chart', 'Notas'], ['horarios', 'clock', 'Horários'], ['calendario', 'month', 'Calendário'], ['atividades', 'check', 'Atividades'], ['relatorios', 'report', 'Relatórios'], ['historico', 'history', 'Histórico'], ['professores', 'users', 'Professores'], ['notificacoes', 'bell', 'Avisos'], ['perfil', 'user', 'Perfil']],
  professor: [['inicio', 'home', 'Início'], ['notas', 'chart', 'Notas'], ['atividades', 'check', 'Atividades'], ['horarios', 'clock', 'Horários'], ['calendario', 'month', 'Calendário'], ['relatorios', 'report', 'Relatórios'], ['historico', 'history', 'Histórico'], ['alunos', 'cap', 'Alunos'], ['avisos', 'send', 'Enviar aviso'], ['notificacoes', 'bell', 'Avisos'], ['perfil', 'user', 'Perfil']],
  administrador: [['inicio', 'shield', 'Visão geral'], ['usuarios', 'users', 'Usuários'], ['aprovacoes', 'check', 'Aprovações'], ['relatorios', 'report', 'Relatórios'], ['historico', 'history', 'Histórico de notas'], ['calendario', 'month', 'Calendário'], ['auditoria', 'list', 'Auditoria'], ['notificacoes', 'bell', 'Avisos'], ['perfil', 'user', 'Perfil']],
};
/* ---------- casca autenticada ---------- */
function bellHtml(aberto = false) {
  const recentes = S.notifs.slice(0, 6);
  return `<div class="bell-wrap ${aberto ? 'open' : ''}">
    <button class="nav-btn" data-act="bell" aria-label="Notificações" title="Notificações">${svg('bell')}<span class="bell-count" ${S.unread ? '' : 'hidden'}>${S.unread > 99 ? '99+' : S.unread}</span></button>
    <div class="notif-pop"><div class="pop-head"><span>Notificações</span><button class="btn btn-ghost btn-sm" data-act="ler-todas">Marcar lidas</button></div>
      <div class="pop-list">${recentes.map((n) => `<button class="pop-item ${n.lida ? '' : 'unread'}" data-act="abrir-notif" data-id="${n.id}"><span class="notif-ico">${ICONES[n.tipo] || '🔔'}</span><span><b>${esc(n.titulo)}</b><br><span style="color:var(--text-2)">${esc(n.mensagem)}</span><br><small style="color:var(--text-3)">${fmtDH(n.criado_em)}</small></span></button>`).join('') || vazio('🔕', 'Sem notificações')}</div>
      <button class="pop-foot" data-act="ir" data-to="#/notificacoes">Ver histórico completo</button></div></div>`;
}
function updateBell() {
  const w = $('.bell-wrap'); if (!w) return;
  w.outerHTML = bellHtml(w.classList.contains('open'));
}
function shell(ativo, conteudo) {
  const me = S.me, menu = MENU[me.perfil];
  return `<nav class="navbar">
    <a href="#/" class="nav-logo" title="Página inicial"><img class="nav-logo-icon" src="logo.webp" alt="">MindClass</a>
    <div class="nav-spacer"></div>
    <span class="role-tag">${ROTULO[me.perfil]}</span>
    ${bellHtml()}
    <button class="nav-btn" data-act="tema" title="Alternar tema" aria-label="Alternar tema">${svg('moon')}</button>
    <button class="nav-avatar" data-act="drawer" aria-label="Conta">${me.foto ? `<img src="${esc(me.foto)}" alt="">` : esc(iniciais(me.nome))}</button>
  </nav>
  <div class="app-layout">
    <nav class="sidebar"><div class="sidebar-label" style="padding-top:16px">${ROTULO[me.perfil]}</div>
      ${menu.map(([k, i, t]) => `<button class="sidebar-item ${k === ativo ? 'active' : ''}" data-act="ir" data-to="#/${k}"><span class="sidebar-item-icon">${svg(i)}</span>${t}</button>`).join('')}
      <div class="sidebar-spacer"></div><div class="sidebar-bottom"><button class="sidebar-item" data-act="sair"><span class="sidebar-item-icon">${svg('out')}</span>Sair</button></div></nav>
    <main class="main-content"><div class="container pg-${ativo}">${conteudo}</div></main>
  </div>
  <div class="mob-nav">${menu.slice(0, 4).map(([k, i, t]) => `<button class="mob-nav-item ${k === ativo ? 'active' : ''}" data-act="ir" data-to="#/${k}"><span class="icon">${svg(i)}</span>${t}</button>`).join('')}<button class="mob-nav-item ${menu.slice(4).some((m) => m[0] === ativo) ? 'active' : ''}" data-act="drawer"><span class="icon">${svg('menu')}</span>Menu</button></div>
  <div class="drawer-overlay" data-act="drawer-fechar"></div>
  <aside class="account-drawer"><div class="drawer-header">${avatar(me)}<div><div class="drawer-user-name">${esc(me.nome)}</div><div class="drawer-user-role">${esc(me.email)}</div></div></div>
    <div class="drawer-body">
      <div class="drawer-nav"><div class="drawer-section-title">Navegação</div>${menu.map(([k, i, t]) => `<button class="drawer-item ${k === ativo ? 'on' : ''}" data-act="ir" data-to="#/${k}"><span class="drawer-item-icon">${svg(i)}</span><span style="font-weight:700">${t}</span></button>`).join('')}<div class="drawer-divider"></div></div>
      <button class="drawer-item drawer-dup" data-act="ir" data-to="#/perfil"><span class="drawer-item-icon">${svg('user')}</span><span><span style="display:block;font-weight:700">Meu perfil</span><span class="drawer-item-desc">Dados pessoais e senha</span></span></button>
      <button class="drawer-item drawer-dup" data-act="ir" data-to="#/notificacoes"><span class="drawer-item-icon">${svg('bell')}</span><span><span style="display:block;font-weight:700">Notificações</span><span class="drawer-item-desc">${S.unread} não lida(s)</span></span></button>
      <div class="drawer-divider"></div>
      <button class="drawer-item" data-act="sair" style="color:var(--pink)"><span class="drawer-item-icon">${svg('out')}</span><span style="font-weight:700">Sair</span></button>
    </div></aside>`;
}

/* ---------- telas públicas ---------- */
const publicNav = () => `<nav class="navbar publica"><a href="#/" class="nav-logo"><img class="nav-logo-icon" src="logo.webp" alt="">MindClass</a><div class="nav-spacer"></div>
  <button class="nav-btn" data-act="tema" title="Alternar tema" aria-label="Alternar tema">${svg('moon')}</button>
  ${S.me ? '<a class="btn btn-primary btn-sm" href="#/inicio">Ir para meu painel →</a>' : '<a class="btn btn-ghost btn-sm" href="#/entrar">Entrar</a><a class="btn btn-primary btn-sm" href="#/cadastro/aluno">Criar conta</a>'}</nav>`;

function viewLanding() {
  $('#app').innerHTML = `${publicNav()}
  <section class="hero">
    <div class="hero-left">
      <div class="hero-eyebrow">🚀 Professores, alunos e administração conectados</div>
      <h1 class="hero-title">A escola mais <span class="hi">organizada</span><br>da sua <span class="hl">vida!</span></h1>
      <span class="hero-underline"></span>
      <p class="hero-desc">Professores gerenciam turmas, horários, atividades e notas. Alunos acompanham o desempenho e recebem avisos em tempo real. A administração organiza e protege o acesso da escola.</p>
      <div class="hero-btns">${S.me ? '<a class="btn btn-primary" href="#/inicio">Ir para meu painel →</a>' : '<a class="btn btn-primary" href="#/entrar">🎓 Entrar na minha conta</a><a class="btn btn-outline" href="#/cadastro/professor">👩‍🏫 Sou professor(a)</a>'}</div>
    </div>
    <div class="hero-right"><div class="hero-arte"><div class="hero-blob" aria-hidden="true"></div><div class="hero-blob-2" aria-hidden="true"></div><img class="hero-logo" src="logo.webp" alt="Mascote MindClass: cérebro colorido com capelo e óculos"></div></div>
  </section>
  <section class="features-strip"><div class="features-grid">
    <div class="feat-card"><div class="feat-icon-wrap">📊</div><div class="feat-title">Notas por trimestre</div><div class="feat-desc">Professores lançam, alunos acompanham a média de cada matéria.</div></div>
    <div class="feat-card"><div class="feat-icon-wrap">📅</div><div class="feat-title">Grade de horários</div><div class="feat-desc">Segunda a sexta, com aviso automático a cada mudança.</div></div>
    <div class="feat-card"><div class="feat-icon-wrap">📌</div><div class="feat-title">Atividades e prazos</div><div class="feat-desc">Lembretes antes do vencimento para não perder entregas.</div></div>
    <div class="feat-card"><div class="feat-icon-wrap">🔔</div><div class="feat-title">Notificações ao vivo</div><div class="feat-desc">Novas notas, avisos e alterações chegam na hora.</div></div>
  </div></section>
  <section class="cta-section"><div class="cta-inner cta-tres">
    <div class="cta-left"><h2>Para o <span class="hl">Professor</span>, o <span class="hl">Aluno</span> e a <span class="hl">Administração</span></h2><p>Cada perfil tem seu painel e suas permissões. O que você não pode editar, o sistema não deixa — nem pelo servidor.</p></div>
    <div class="cta-cards">
      <div class="cta-card cta-card-blue"><div class="cta-card-icon">👩‍🏫</div><div class="cta-card-title">Área do Professor</div><ul class="cta-card-list"><li>Notas das suas turmas</li><li>Grade de horários</li><li>Atividades e avisos</li><li>Lista de alunos</li></ul><a class="btn-white" href="#/cadastro/professor" style="text-decoration:none">Cadastrar como professor →</a></div>
      <div class="cta-card cta-card-teal"><div class="cta-card-icon">🎓</div><div class="cta-card-title">Área do Aluno</div><ul class="cta-card-list"><li>Notas e médias</li><li>Horários da turma</li><li>Atividades pendentes</li><li>Notificações</li></ul><a class="btn-white" href="#/cadastro/aluno" style="text-decoration:none">Cadastrar como aluno →</a></div>
      <div class="cta-card cta-card-admin"><div class="cta-card-icon">🛡️</div><div class="cta-card-title">Área da Administração</div><ul class="cta-card-list"><li>Aprovação de professores</li><li>Gestão de usuários</li><li>Relatórios e histórico de notas</li><li>Auditoria do sistema</li></ul><a class="btn-white" href="#/entrar/administrador" style="text-decoration:none">Entrar como administrador →</a></div>
    </div></div></section>
  <footer class="footer"><div class="footer-inner"><div><div class="footer-logo">🧠 MindClass</div><div class="footer-tagline">Organização, aprendizado e escola conectada!</div></div></div></footer>`;
}

function authCard(inner, wide = false) { return `${publicNav()}<div class="auth-wrap"><div class="auth-card ${wide ? 'wide' : ''}"><img class="auth-logo" src="logo.webp" alt="">${inner}</div></div>`; }

function viewLogin(perfil = 'aluno') {
  $('#app').innerHTML = authCard(`<h1>Entrar</h1><p class="sub">Acesse seu painel do MindClass</p>
    <div class="tabs tabs3">${['aluno', 'professor', 'administrador'].map((p) => `<button type="button" class="tab ${perfil === p ? 'active' : ''}" data-act="tab-perfil" data-p="${p}">${p === 'aluno' ? 'Aluno' : p === 'professor' ? 'Professor' : 'Admin'}</button>`).join('')}</div>
    <form data-form="login" novalidate><input type="hidden" name="perfil" value="${perfil}"><div class="form-error" id="err"></div>
      <div class="field"><label class="form-label" for="l-email">E-mail</label><input id="l-email" class="form-input" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label class="form-label" for="l-senha">Senha</label><input id="l-senha" class="form-input" name="senha" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block" type="submit">Entrar</button></form>
    <p class="auth-alt"><a href="#" data-act="esqueci">Esqueci minha senha</a></p>
    <p class="auth-alt" id="alt-box" ${perfil === 'administrador' ? 'hidden' : ''}>Ainda não tem conta? <a id="alt-cad" href="#/cadastro/${perfil === 'professor' ? 'professor' : 'aluno'}">Cadastre-se</a></p>`);
  enhancePw();
}

function pedirConfirmacao() { toast('Conta criada! Abra o link enviado ao seu e-mail para confirmar.', 'ok'); go('#/entrar'); }
function viewNovaSenha() {
  $('#app').innerHTML = authCard(`<h1>Nova senha</h1><p class="sub">Escolha uma senha com letras e números</p>
    <form data-form="nova-senha" novalidate><div class="form-error" id="err"></div>
      <div class="field"><label class="form-label">Nova senha</label><input class="form-input" name="senha" type="password" autocomplete="new-password"></div>
      <div class="field"><label class="form-label">Confirmar</label><input class="form-input" name="confirmacao" type="password" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-block" type="submit">Salvar senha</button></form>`);
  enhancePw();
}
const chips = (name, lista, marcados = []) => lista.map((x) => `<label class="chip-opt"><input type="checkbox" name="${name}" value="${x.id}" ${marcados.includes(x.id) ? 'checked' : ''}><span>${esc(x.nome)}</span></label>`).join('');
const addNovo = (alvo, ph) => `<div class="add-row"><input class="form-input" id="novo-${alvo}" placeholder="${ph}" maxlength="60"><button type="button" class="btn btn-outline btn-sm" data-act="add-chip" data-alvo="${alvo}">+ Adicionar</button></div>`;

async function viewCadastro(tipo) {
  tipo = tipo === 'professor' ? 'professor' : 'aluno';
  const o = await opcoes();
  S.fotoTmp = undefined;
  const comuns = `<div class="form-error" id="err"></div>
    <div class="field"><label class="form-label" for="c-nome">Nome completo</label><input id="c-nome" class="form-input" name="nome" maxlength="100" autocomplete="name" required></div>
    <div class="field"><label class="form-label" for="c-email">E-mail</label><input id="c-email" class="form-input" name="email" type="email" autocomplete="email" required></div>
    <div class="field-row"><div class="field"><label class="form-label" for="c-senha">Senha</label><input id="c-senha" class="form-input" name="senha" type="password" minlength="8" autocomplete="new-password" required><div class="hint">Mínimo de 8 caracteres, com letras e números.</div></div>
    <div class="field"><label class="form-label" for="c-conf">Confirmar senha</label><input id="c-conf" class="form-input" name="confirmacao" type="password" autocomplete="new-password" required></div></div>`;
  const prof = `<div class="field"><label class="form-label" for="c-turno">Turno de trabalho</label><select id="c-turno" class="form-input" name="turno">${o.turnos.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
    <div class="field"><label class="form-label">Matérias que leciona</label><div class="chip-box" id="chips-materias">${chips('materias', o.materias)}</div>${addNovo('materias', 'Outra matéria…')}</div>
    <div class="field"><label class="form-label">Turmas em que trabalha</label>${turmaGrupos(o.turmas, turmaOpt('checkbox', 'turmas'))}<div class="hint">As turmas e matérias solicitadas só são liberadas após a aprovação da administração.</div></div>
    <div class="field"><label class="form-label" for="c-foto">Foto de perfil (opcional)</label><input id="c-foto" class="form-input" type="file" accept="image/*" data-change="foto"></div>`;
  const alu = `<div class="field"><label class="form-label">Selecione sua turma</label>${o.turmas.length ? turmaGrupos(o.turmas, turmaOpt('radio', 'turma_id')) : '<div class="perm-note">Nenhuma turma disponível.</div>'}</div>
    <div class="field"><label class="form-label" for="c-mat">Matrícula (opcional)</label><input id="c-mat" class="form-input" name="matricula" maxlength="30"></div>`;
  $('#app').innerHTML = authCard(`<h1>Cadastro de ${tipo === 'professor' ? 'professor(a)' : 'aluno(a)'}</h1><p class="sub">Crie sua conta para acessar o painel</p>
    <form data-form="cadastro-${tipo}" novalidate>${comuns}${tipo === 'professor' ? prof : alu}<button class="btn btn-primary btn-block" type="submit">Criar conta</button></form>
    <p class="auth-alt">Já tem conta? <a href="#/entrar">Entrar</a> · ${tipo === 'professor' ? '<a href="#/cadastro/aluno">Sou aluno</a>' : '<a href="#/cadastro/professor">Sou professor</a>'}</p>`, tipo === 'professor');
  enhancePw();
}

/* ---------- grade semanal ---------- */
const ETAPAS = { fundamental: 'Ensino Fundamental', medio: 'Ensino Médio', outra: 'Outras turmas' };
const turmaOpt = (tipo, name, marcados = []) => (t) => `<label class="turma-card"><input type="${tipo}" name="${name}" value="${t.id}" ${marcados.includes(t.id) ? 'checked' : ''}><span><b>${esc(t.nome)}</b><small>${t.num_horarios} horários por dia</small></span></label>`;
function turmaGrupos(turmas, render) {
  return ['fundamental', 'medio', 'outra'].map((k) => {
    const l = turmas.filter((t) => t.etapa === k);
    return l.length ? `<div class="etapa"><div class="etapa-h"><span class="etapa-dot ${k}"></span>${ETAPAS[k]}</div><div class="turma-grid">${l.map(render).join('')}</div></div>` : '';
  }).join('');
}
const PAUSAS = { 3: 'Intervalo', 6: 'Almoço' };
// Grade por horários: exatamente N linhas (N = horários por dia da turma), segunda a sexta nas colunas.
function grade(hs, turma, modo, slots) {
  const hoje = new Date().getDay(), ed = modo === 'prof', n = Math.min(turma.num_horarios, slots.length);
  const cel = (d, s) => {
    const sl = slots[s - 1], a = hs.find((h) => h.dia === d && h.slot === s);
    let html = '';
    if (a?.ocupado) html = '<div class="blk ocupado"><span>Ocupado</span></div>';
    else if (a) {
      const meu = ed && a.professor_id === S.me.id;
      html = `<div class="blk ${meu ? 'edit' : ''}" style="${corMateria(a.materia)}" ${meu ? `data-act="edit-hor" data-id="${a.id}" role="button" tabindex="0"` : ''}><b>${esc(a.materia)}</b>${ed ? '' : `<span>Prof. ${esc(a.professor)}</span>`}</div>`;
    } else if (ed) html = `<button type="button" class="add-cel" data-act="nova-aula" data-dia="${d}" data-slot="${s}" aria-label="Adicionar aula: ${DIAS[d]}, ${s}º horário">+</button>`;
    return `<td class="${d === hoje ? 'hoje' : ''}">${html}</td>`;
  };
  const linhas = [];
  for (let s = 1; s <= n; s++) {
    const sl = slots[s - 1];
    linhas.push(`<tr><th scope="row"><b>${s}º</b><small>${sl.inicio}–${sl.fim}</small></th>${[1, 2, 3, 4, 5].map((d) => cel(d, s)).join('')}</tr>`);
    if (PAUSAS[s] && s < n) linhas.push(`<tr class="pausa"><td colspan="6">${PAUSAS[s]} · ${sl.fim}–${slots[s].inicio}</td></tr>`);
  }
  return `<div class="grade-scroll"><table class="grade-tab"><thead><tr><th>Horário</th>${[1, 2, 3, 4, 5].map((d) => `<th class="${d === hoje ? 'hoje' : ''}"><span class="d-full">${DIAS[d]}</span><span class="d-ab">${DIAS[d].slice(0, 3)}</span></th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`;
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localStr = (d = new Date()) => `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const aulasHoje = (hs) => hs.filter((h) => h.dia === new Date().getDay()).sort((a, b) => a.slot - b.slot);
const aulaLinha = (h, modo) => `<div class="row-card"><div class="notif-ico" style="${corMateria(h.materia)};background:var(--bg-c);color:var(--c)">${svg('clock')}</div><div class="grow"><div class="t">${esc(h.materia)}</div><div class="m">${h.slot}º horário · ${h.inicio} – ${h.fim} · ${modo === 'prof' ? 'Turma ' + esc(h.turma) : 'Prof. ' + esc(h.professor)}</div></div></div>`;
const chipsMateria = (obj) => Object.entries(obj).map(([m, n]) => `<span class="chip" style="${corMateria(m)};background:var(--bg-c);color:var(--c)">${esc(m)} · ${n}</span>`).join('');
const resumoNums = (itens) => `<div class="resumo-nums">${itens.map(([n, rot, cls]) => `<div><b class="${cls}">${n}</b><span>${rot}</span></div>`).join('')}</div>`;
function resumoAtvAluno(atv) {
  const agora = localStr(), em48 = localStr(new Date(Date.now() + 48 * 36e5));
  const pend = atv.filter((a) => !a.concluida && a.prazo >= agora), atras = atv.filter((a) => !a.concluida && a.prazo < agora), ok = atv.filter((a) => a.concluida);
  const urg = pend.filter((a) => a.prazo <= em48), pct = atv.length ? Math.round((ok.length / atv.length) * 100) : 0;
  const porMat = {}; pend.forEach((a) => { porMat[a.materia] = (porMat[a.materia] || 0) + 1; });
  return `<div class="resumo-atv"><div class="resumo-top"><h3 class="section-title">Resumo das atividades</h3><button class="btn btn-ghost btn-sm" data-act="ir" data-to="#/atividades">Ver todas →</button></div>
    ${resumoNums([[pend.length, 'Pendentes', 'c-or'], [urg.length, 'Vencem em 48h', 'c-pk'], [atras.length, 'Atrasadas', 'c-rd'], [ok.length, 'Concluídas', 'c-gr']])}
    <div class="resumo-prog"><div class="resumo-prog-l"><span>${ok.length} de ${atv.length} concluídas</span><b>${pct}%</b></div><div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div></div>
    ${Object.keys(porMat).length ? `<div class="m" style="margin:10px 0 6px">Pendentes por matéria</div><div class="chip-box">${chipsMateria(porMat)}</div>` : ''}</div>`;
}
function resumoAtvProf(atv) {
  const agora = localStr(), em7 = localStr(new Date(Date.now() + 7 * 864e5));
  const abertas = atv.filter((a) => a.prazo >= agora), enc = atv.filter((a) => a.prazo < agora), semana = abertas.filter((a) => a.prazo <= em7);
  const porTurma = {}; abertas.forEach((a) => { porTurma[a.turma] = (porTurma[a.turma] || 0) + 1; });
  return `<div class="resumo-atv"><div class="resumo-top"><h3 class="section-title">Resumo das atividades</h3><button class="btn btn-ghost btn-sm" data-act="ir" data-to="#/atividades">Gerenciar →</button></div>
    ${resumoNums([[atv.length, 'Publicadas', 'c-pu'], [abertas.length, 'Em aberto', 'c-or'], [semana.length, 'Vencem em 7 dias', 'c-pk'], [enc.length, 'Encerradas', 'c-gr']])}
    ${Object.keys(porTurma).length ? `<div class="m" style="margin:10px 0 6px">Em aberto por turma</div><div class="chip-box">${Object.entries(porTurma).map(([t, n]) => `<span class="chip" style="background:var(--purple-light);color:var(--purple)">${esc(t)} · ${n}</span>`).join('')}</div>` : '<div class="m" style="margin-top:10px">Nenhuma atividade em aberto.</div>'}</div>`;
}
const itemProximo = (i) => {
  const [y, m, d] = i.data.split('-').map(Number);
  const quando = `${new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}${i.inicio ? ' · ' + i.inicio : ''}`;
  return `<div class="row-card"><div class="cat-bar cat-${i.categoria}"></div><div class="grow"><div class="t">${esc(i.titulo)}</div><div class="m">${quando}${i.materia ? ' · ' + esc(i.materia) : ''}${i.turma ? ' · ' + esc(i.turma) : ' · Pessoal'}</div></div><span class="cat-tag cat-${i.categoria}">${CATEG[i.categoria]}</span></div>`;
};
const proximosHtml = (itens) => `<div class="resumo-top" style="margin-top:22px"><h3 class="section-title">Próximos compromissos (14 dias)</h3><button class="btn btn-ghost btn-sm" data-act="ir" data-to="#/calendario">Abrir calendário →</button></div>
  ${itens.map(itemProximo).join('') || vazio('🗓️', 'Nenhum compromisso nos próximos dias.')}`;
function avisoPendencias() {
  const p = S.me.pendentes;
  if (!p || !(p.turmas.length || p.materias.length)) return '';
  return `<div class="perm-note">Aguardando aprovação da administração: ${[...p.turmas, ...p.materias].map((x) => esc(x.nome)).join(', ')}.</div>`;
}

/* ---------- visões do ALUNO ---------- */
const ALUNO = {
  async inicio() {
    const { notas, horarios: hs, atividades: atv, proximos } = await api('GET', '/api/painel');
    const todas = notas.flatMap((n) => Object.values(n.trimestres));
    const geral = media(todas);
    const agora = localStr();
    const pend = atv.filter((a) => !a.concluida && a.prazo >= agora);
    return `<div class="page-title">${saudacao()}, ${esc(primeiroNome(S.me.nome))}! 👋</div>
      <div class="page-sub">Turma ${esc(S.me.turmas.map((t) => t.nome).join(', '))} · ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="stats-row"><div class="stat-card c-purple"><div class="stat-num">${geral == null ? '–' : geral.toFixed(1)}</div><div class="stat-label">Média geral</div></div>
        <div class="stat-card c-blue"><div class="stat-num">${notas.length}</div><div class="stat-label">Matérias com nota</div></div>
        <div class="stat-card c-orange"><div class="stat-num">${pend.length}</div><div class="stat-label">Atividades pendentes</div></div>
        <div class="stat-card c-pink"><div class="stat-num">${aulasHoje(hs).length}</div><div class="stat-label">Aulas hoje</div></div></div>
      <div class="grid">
        <div class="col-8 stack">
          ${resumoAtvAluno(atv)}
          <section class="painel"><h3 class="section-title">📊 Desempenho</h3>${cardsNotas(notas)}</section>
        </div>
        <aside class="col-4 stack">
          <div class="grid"><section class="painel col-t6"><h3 class="section-title">📅 Aulas de hoje</h3>${aulasHoje(hs).map((h) => aulaLinha(h)).join('') || vazio('🌴', 'Sem aulas hoje')}</section>
          <section class="painel col-t6"><h3 class="section-title">📌 Próximas atividades</h3>${pend.slice(0, 4).map(atvLinhaAluno).join('') || vazio('🎉', 'Nada pendente!')}</section></div>
          <section class="painel">${proximosHtml(proximos)}</section>
        </aside>
      </div>`;
  },
  async notas() {
    return `<div class="page-title">Minhas notas</div><div class="page-sub">Somente leitura — as notas são lançadas pelos professores.</div>${cardsNotas(await api('GET', '/api/aluno/notas'))}`;
  },
  async horarios() {
    const [hs, o] = await Promise.all([api('GET', '/api/horarios'), opcoes()]);
    const grades = S.me.turmas.map((t) => `<h3 class="section-title">${esc(t.nome)} <span class="etapa-tag">${t.num_horarios} horários por dia</span></h3>${grade(hs.filter((h) => h.turma_id === t.id), t, 'aluno', o.slots)}`).join('');
    return `<div class="page-title">Meus horários</div><div class="page-sub">Grade da sua turma, de segunda a sexta. Para eventos e compromissos, use o Calendário.</div>${grades}`;
  },
  async atividades() {
    const atv = await api('GET', '/api/atividades');
    const agora = localStr();
    const pend = atv.filter((a) => !a.concluida && a.prazo >= agora), hist = atv.filter((a) => a.concluida || a.prazo < agora).reverse();
    const lista = S.atvTab === 'pend' ? pend : hist;
    return `<div class="page-title">Atividades</div><div class="page-sub">Marque como concluída as que já entregou (é só uma marcação pessoal).</div>
      <div class="filter-row"><button class="fchip ${S.atvTab === 'pend' ? 'active' : ''}" data-act="atv-tab" data-t="pend">Pendentes (${pend.length})</button><button class="fchip ${S.atvTab === 'hist' ? 'active' : ''}" data-act="atv-tab" data-t="hist">Histórico (${hist.length})</button></div>
      ${lista.length ? `<div class="cards">${lista.map(atvLinhaAluno).join('')}</div>` : vazio('📭', S.atvTab === 'pend' ? 'Nenhuma atividade pendente.' : 'Histórico vazio.')}`;
  },
  async professores() {
    const ps = await api('GET', '/api/aluno/professores');
    return `<div class="page-title">Meus professores</div><div class="page-sub">Professores vinculados à sua turma.</div>
      <div class="cards">${ps.map((p) => `<div class="row-card">${avatar(p)}<div class="grow"><div class="t">${esc(p.nome)}</div><div class="m">${esc(p.materia)} · ${esc(p.email)}</div></div></div>`).join('') || vazio('👩‍🏫', 'Nenhum professor vinculado à sua turma ainda.')}</div>`;
  },
};
const cardsNotas = (notas) => (notas.length ? `<div class="materia-grid">${notas.map((n) => `<div class="mat-card" style="${corMateria(n.materia)}"><h3>${esc(n.materia)}</h3>
  <div class="bims">${[1, 2, 3].map((b) => `<div class="bim">${b}º tri<b class="${n.trimestres[b] != null ? classeMedia(n.trimestres[b]) : ''}">${n.trimestres[b] != null ? n.trimestres[b].toFixed(1) : '–'}</b></div>`).join('')}</div>
  <div class="mat-media"><span>Média</span><b class="${classeMedia(n.media)}">${n.media.toFixed(1)}</b></div></div>`).join('')}</div>` : vazio('📊', 'Nenhuma nota lançada ainda.'));
const atvLinhaAluno = (a) => {
  const atrasada = !a.concluida && a.prazo < localStr();
  return `<div class="row-card"><div class="task-check ${a.concluida ? 'done' : ''}" role="checkbox" aria-checked="${!!a.concluida}" tabindex="0" data-act="concluir" data-id="${a.id}" data-v="${a.concluida ? 0 : 1}">${a.concluida ? '✓' : ''}</div>
    <div class="grow"><div class="t ${a.concluida ? 'task-title done' : ''}">${esc(a.titulo)}</div><div class="m">${esc(a.materia)} · Prof. ${esc(a.professor)} · <span class="${atrasada ? 'late' : ''}">${atrasada ? 'Encerrada em ' : 'Prazo: '}${fmtPrazo(a.prazo)}</span></div>${a.descricao ? `<div class="m">${esc(a.descricao)}</div>` : ''}</div></div>`;
};

/* ---------- visões do PROFESSOR ---------- */
const PROF = {
  async inicio() {
    const { resumo: r, horarios: hs, atividades: atv, proximos } = await api('GET', '/api/painel');
    const agora = localStr();
    const prox = atv.filter((a) => a.prazo >= agora).sort((a, b) => a.prazo.localeCompare(b.prazo));
    return `<div class="page-title">${saudacao()}, Prof. ${esc(primeiroNome(S.me.nome))}! 👋</div><div class="page-sub">Turno: ${esc(S.me.turno)} · ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="stats-row"><div class="stat-card c-purple"><div class="stat-num">${S.me.materias.length}</div><div class="stat-label">Matérias</div></div><div class="stat-card c-blue"><div class="stat-num">${r.turmas.length}</div><div class="stat-label">Turmas</div></div>
        <div class="stat-card c-orange"><div class="stat-num">${r.aulas}</div><div class="stat-label">Aulas na semana</div></div><div class="stat-card c-pink"><div class="stat-num">${r.atividades_abertas}</div><div class="stat-label">Atividades abertas</div></div></div>
      ${avisoPendencias()}
      <div class="grid">
        <div class="col-8 stack">
          ${resumoAtvProf(atv)}
          <div class="grid">
            <section class="painel col-6 col-t6"><h3 class="section-title">🕒 Aulas de hoje</h3>${aulasHoje(hs).map((h) => aulaLinha(h, 'prof')).join('') || vazio('🌴', 'Sem aulas hoje')}</section>
            <section class="painel col-6 col-t6"><h3 class="section-title">📌 Próximas entregas</h3>${prox.slice(0, 3).map((a) => `<div class="row-card"><div class="grow"><div class="t">${esc(a.titulo)}</div><div class="m">${esc(a.materia)} · Turma ${esc(a.turma)} · ${fmtPrazo(a.prazo)}</div></div></div>`).join('') || vazio('✅', 'Sem entregas abertas')}</section>
          </div>
          <section class="painel">${proximosHtml(proximos)}</section>
        </div>
        <aside class="col-4 stack">
          <section class="painel"><h3 class="section-title">👥 Turmas</h3>${r.turmas.map((t) => `<div class="row-card"><div class="grow"><div class="t">${esc(t.nome)}</div><div class="m">${t.alunos} aluno(s)</div></div><button class="btn btn-ghost btn-sm" data-act="alunos-turma" data-id="${t.id}">Ver alunos</button></div>`).join('') || vazio('🏫', 'Sem turmas aprovadas')}</section>
          <section class="painel"><h3 class="section-title">📚 Minhas matérias</h3><div class="chip-box">${S.me.materias.map((m) => `<span class="chip" style="${corMateria(m.nome)};background:var(--bg-c);color:var(--c)">${esc(m.nome)}</span>`).join('')}</div></section>
        </aside>
      </div>`;
  },
  async notas() {
    const { turma, materia } = S.notasCtx;
    let corpo = '<div class="perm-note">Selecione a turma e a matéria para lançar notas (de 0 a 10). Salvamento automático ao sair do campo.</div>';
    if (turma && materia) {
      const linhas = await api('GET', `/api/notas?turma_id=${turma}&materia_id=${materia}`);
      S.notaMap = new Map();
      corpo = linhas.length ? `<div class="card table-scroll"><table class="grades-table"><thead><tr><th>Aluno</th>${[1, 2, 3].map((b) => `<th>${b}º tri</th>`).join('')}<th>Média</th></tr></thead><tbody>${linhas.map((l) => {
        l.notas.forEach((n) => S.notaMap.set(`${l.id}-${n.trimestre}`, n.id));
        const m = media(l.notas.map((n) => n.valor));
        return `<tr><td>${esc(l.nome)}</td>${[1, 2, 3].map((b) => { const n = l.notas.find((x) => x.trimestre === b); return `<td><input class="nota-in" type="number" min="0" max="10" step="0.1" inputmode="decimal" aria-label="${esc(l.nome)} ${b}º trimestre" data-change="nota" data-aluno="${l.id}" data-bim="${b}" data-orig="${n ? n.valor : ''}" value="${n ? n.valor : ''}"></td>`; }).join('')}<td class="grade-avg ${m == null ? '' : classeMedia(m)}" id="avg-${l.id}">${m == null ? '–' : m.toFixed(1)}</td></tr>`;
      }).join('')}</tbody></table></div>` : vazio('🎓', 'Nenhum aluno nesta turma ainda.');
    }
    return `<div class="page-title">Notas</div><div class="page-sub">Você só pode lançar notas das matérias e turmas às quais está vinculado.</div>
      <div class="toolbar"><div><label class="form-label">Turma</label><select class="form-input" data-change="ctx-notas" id="n-turma">${opts(S.me.turmas, turma, 'Selecione…')}</select></div>
      <div><label class="form-label">Matéria</label><select class="form-input" data-change="ctx-notas" id="n-materia">${opts(S.me.materias, materia, 'Selecione…')}</select></div></div>${corpo}`;
  },
  async atividades() {
    const lista = await api('GET', '/api/atividades');
    const ed = lista.find((a) => a.id === S.editAtv);
    return `<div class="page-title">Atividades</div><div class="page-sub">Publique atividades — os alunos da turma são avisados automaticamente.</div>
      <div class="split"><aside class="split-aside"><form class="form-wrap open" data-form="atividade" novalidate><div class="form-error" id="err"></div><div class="form-grid">
        <div><label class="form-label">Título</label><input class="form-input" name="titulo" maxlength="120" value="${esc(ed?.titulo)}" required></div>
        <div><label class="form-label">Turma</label><select class="form-input" name="turma_id" required>${opts(S.me.turmas, ed?.turma_id, 'Selecione…')}</select></div>
        <div><label class="form-label">Matéria</label><select class="form-input" name="materia_id" required>${opts(S.me.materias, ed?.materia_id, 'Selecione…')}</select></div>
        <div><label class="form-label">Prazo</label><input class="form-input" type="datetime-local" name="prazo" value="${esc(ed?.prazo)}" required></div></div>
        <div class="field"><label class="form-label">Descrição (opcional)</label><textarea class="form-input" name="descricao" maxlength="1000">${esc(ed?.descricao)}</textarea></div>
        <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" type="submit">${ed ? 'Salvar alterações' : '+ Publicar atividade'}</button>${ed ? '<button type="button" class="btn btn-ghost btn-sm" data-act="cancel-atv">Cancelar</button>' : ''}</div></form></aside>
      <div class="split-main">${lista.map((a) => `<div class="row-card"><div class="grow"><div class="t">${esc(a.titulo)}</div><div class="m">${esc(a.materia)} · Turma ${esc(a.turma)} · Prazo: ${fmtPrazo(a.prazo)}</div>${a.descricao ? `<div class="m">${esc(a.descricao)}</div>` : ''}</div>
        <button class="btn btn-ghost btn-sm" data-act="edit-atv" data-id="${a.id}">✏️ Editar</button><button class="btn btn-danger btn-sm" data-act="del-atv" data-id="${a.id}">🗑️</button></div>`).join('') || vazio('📌', 'Nenhuma atividade publicada.')}</div></div>`;
  },
  async horarios() {
    if (!S.me.turmas.length) return `<div class="page-title">Minha grade de horários</div>${avisoPendencias()}${vazio('🏫','Você ainda não tem turmas aprovadas. Solicite em Perfil e aguarde a administração.')}`;
    const o = await opcoes();
    const turma = S.me.turmas.find((t) => String(t.id) === String(S.horTurma)) || S.me.turmas[0];
    S.horTurma = turma.id;
    const hs = await api('GET', `/api/horarios?turma_id=${turma.id}`);
    const ed = hs.find((h) => h.id === S.editHor), pre = S.horPre || {};
    const slotSel = ed?.slot ?? pre.slot ?? 1, diaSel = ed?.dia ?? pre.dia ?? (new Date().getDay() || 1);
    return `<div class="page-title">Minha grade de horários</div><div class="page-sub">Escolha a turma. A grade mostra apenas as aulas das matérias que você leciona; clique em "+" para adicionar ou numa aula sua para editar.</div>
      <div class="etapas">${turmaGrupos(S.me.turmas, (t) => `<button type="button" class="turma-card ${t.id === turma.id ? 'sel' : ''}" data-act="sel-turma" data-id="${t.id}"><span><b>${esc(t.nome)}</b><small>${t.num_horarios} horários por dia</small></span></button>`)}</div>
      <div class="split split-grade" style="margin-top:8px"><div class="split-main"><h3 class="section-title">${esc(turma.nome)} <span class="etapa-tag">${turma.num_horarios} horários por dia</span></h3>
      ${grade(hs, turma, 'prof', o.slots)}</div>
      <aside class="split-aside"><h3 class="section-title">${ed ? 'Editar aula' : 'Adicionar aula'}</h3>
      <form class="form-wrap open" data-form="horario" novalidate><div class="form-error" id="err"></div><input type="hidden" name="turma_id" value="${turma.id}"><div class="form-grid">
        <div><label class="form-label">Matéria</label><select class="form-input" name="materia_id" required>${opts(S.me.materias, ed?.materia_id, 'Selecione…')}</select></div>
        <div><label class="form-label">Dia</label><select class="form-input" name="dia">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${diaSel === d ? 'selected' : ''}>${DIAS[d]}-feira</option>`).join('')}</select></div>
        <div><label class="form-label">Horário (${turma.num_horarios} por dia)</label><select class="form-input" name="slot">${o.slots.slice(0, turma.num_horarios).map((s) => `<option value="${s.n}" ${slotSel === s.n ? 'selected' : ''}>${s.n}º · ${s.inicio}–${s.fim}</option>`).join('')}</select></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="submit">${ed ? 'Salvar alterações' : '+ Adicionar aula'}</button>${ed ? '<button type="button" class="btn btn-danger btn-sm" data-act="del-hor" data-id="' + ed.id + '">Excluir aula</button><button type="button" class="btn btn-ghost btn-sm" data-act="cancel-hor">Cancelar</button>' : ''}</div></form></aside></div>`;
  },
  async alunos() {
    const tid = S.alunosTurma || S.me.turmas[0]?.id || '';
    const lista = tid ? await api('GET', `/api/turmas/${tid}/alunos`) : [];
    return `<div class="page-title">Alunos</div><div class="page-sub">Alunos das turmas às quais você está vinculado.</div>
      <div class="toolbar"><div><label class="form-label">Turma</label><select class="form-input" data-change="ctx-alunos">${opts(S.me.turmas, tid)}</select></div></div>
      <div class="cards">${lista.map((a) => `<div class="row-card">${avatar(a)}<div class="grow"><div class="t">${esc(a.nome)}</div><div class="m">${esc(a.email)}${a.matricula ? ' · Matrícula ' + esc(a.matricula) : ''}</div></div></div>`).join('') || vazio('🎓', 'Nenhum aluno nesta turma.')}</div>`;
  },
  async avisos() {
    return `<div class="page-title">Enviar aviso</div><div class="page-sub">O aviso chega como notificação para todos os alunos da turma escolhida.</div>
      <form class="form-wrap open" data-form="aviso" novalidate><div class="form-error" id="err"></div>
        <div class="field"><label class="form-label">Turma</label><select class="form-input" name="turma_id" required>${opts(S.me.turmas, '', 'Selecione…')}</select></div>
        <div class="field"><label class="form-label">Título</label><input class="form-input" name="titulo" maxlength="100" required></div>
        <div class="field"><label class="form-label">Mensagem</label><textarea class="form-input" name="mensagem" maxlength="600" required></textarea></div>
        <button class="btn btn-primary btn-sm" type="submit">📣 Enviar aviso</button></form>`;
  },
};

/* ---------- visões comuns ---------- */
const COMUM = {
  async notificacoes() {
    const d = await api('GET', '/api/notificacoes'); S.notifs = d.itens; S.unread = d.nao_lidas;
    const lista = S.notifFiltro === 'nao' ? S.notifs.filter((n) => !n.lida) : S.notifs;
    const perm = 'Notification' in window && Notification.permission === 'default';
    return `<div class="page-title">Notificações</div><div class="page-sub">Histórico completo — ${S.unread} não lida(s).</div>
      <div class="filter-row"><button class="fchip ${S.notifFiltro === 'todas' ? 'active' : ''}" data-act="notif-filtro" data-f="todas">Todas</button><button class="fchip ${S.notifFiltro === 'nao' ? 'active' : ''}" data-act="notif-filtro" data-f="nao">Não lidas</button>
        <button class="btn btn-ghost btn-sm" data-act="ler-todas">✓ Marcar todas como lidas</button>${perm ? '<button class="btn btn-outline btn-sm" data-act="push">🔔 Ativar avisos do navegador</button>' : ''}</div>
      ${lista.map((n) => `<div class="notif-item ${n.lida ? '' : 'unread'}"><div class="notif-dot ${n.lida ? 'read' : ''}"></div><span class="notif-ico">${ICONES[n.tipo] || '🔔'}</span><div class="notif-info"><div class="notif-title">${esc(n.titulo)}</div><div class="notif-desc">${esc(n.mensagem)}</div><div class="notif-date">${fmtDH(n.criado_em)}</div></div>
        <div class="notif-actions">${n.lida ? `<button class="del-btn" title="Marcar como não lida" data-act="notif-lida" data-id="${n.id}" data-v="0">↩</button>` : `<button class="del-btn" title="Marcar como lida" data-act="notif-lida" data-id="${n.id}" data-v="1">✓</button>`}<button class="del-btn" title="Excluir" data-act="notif-del" data-id="${n.id}">🗑️</button></div></div>`).join('') || vazio('🔕', 'Nenhuma notificação.')}`;
  },
  async perfil() {
    const me = S.me, prof = me.perfil === 'professor';
    let vinc = '';
    if (prof) {
      const o = await opcoes();
      const marc = (k) => [...me[k], ...me.pendentes[k]].map((x) => x.id);
      vinc = `<h3 class="section-title">Matérias e turmas</h3>${avisoPendencias()}
        <form data-form="vinculos" novalidate><div class="form-error" id="err"></div>
        <div class="field"><label class="form-label">Matérias que leciona</label><div class="chip-box" id="chips-materias">${chips('materias', o.materias, marc('materias'))}</div>${addNovo('materias', 'Outra matéria…')}</div>
        <div class="field"><label class="form-label">Turmas em que trabalha</label>${turmaGrupos(o.turmas, turmaOpt('checkbox', 'turmas', marc('turmas')))}<div class="hint">Novas solicitações precisam de aprovação. Desmarcar remove o vínculo imediatamente.</div></div>
        <button class="btn btn-primary btn-sm" type="submit">Solicitar alterações</button></form>`;
    }
    const sub = prof ? 'Professor(a)' : me.perfil === 'aluno' ? 'Aluno(a) — turma ' + esc(me.turmas.map((t) => t.nome).join(', ')) : 'Administração';
    return `<div class="page-title">Meu perfil</div><div class="page-sub">${sub} · ${esc(me.email)}</div>
      <div class="grid"><section class="painel col-6"><h3 class="section-title">Dados pessoais</h3><form data-form="perfil" novalidate><div class="form-error" id="err"></div>
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px"><span id="foto-prev">${avatar(me, 'lg')}</span><div><label class="form-label" for="p-foto">Foto</label><input id="p-foto" type="file" accept="image/*" data-change="foto-perfil" class="form-input"></div></div>
        <div class="field"><label class="form-label">Nome completo</label><input class="form-input" name="nome" value="${esc(me.nome)}" maxlength="100" required></div>
        ${prof ? `<div class="field"><label class="form-label">Turno</label><select class="form-input" name="turno">${['manhã', 'tarde', 'noite', 'integral'].map((t) => `<option ${me.turno === t ? 'selected' : ''} value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>` : ''}
        <div class="field-row"><div class="field"><label class="form-label">Senha atual</label><input class="form-input" type="password" name="senha_atual" autocomplete="current-password"></div><div class="field"><label class="form-label">Nova senha</label><input class="form-input" type="password" name="nova_senha" autocomplete="new-password" minlength="8"><div class="hint">Letras e números. Trocar encerra as outras sessões.</div></div></div>
        <button class="btn btn-primary btn-sm" type="submit">Salvar perfil</button></form></section>
      <div class="col-6 stack">${vinc ? `<section class="painel">${vinc}</section>` : ''}
      <section class="painel"><h3 class="section-title">Segurança</h3><p class="m" style="margin-bottom:12px">Encerra a sessão em todos os computadores e celulares.</p><button class="btn btn-danger btn-sm" data-act="sair-todas">Sair de todos os dispositivos</button></section></div></div>`;
  },
};
/* ---------- módulos ---------- */
const MODULOS = [calendario, relatorios, historico, admin];
function tabelaDoPerfil() {
  const comuns = { ...COMUM, ...calendario.VIEWS, ...relatorios.VIEWS, ...historico.VIEWS };
  if (S.me.perfil === 'administrador') return { ...comuns, ...admin.VIEWS };
  return { ...(S.me.perfil === 'professor' ? PROF : ALUNO), ...comuns };
}

/* ---------- roteamento ---------- */
async function route() {
  const my = ++S.nav;
  const [a = '', b] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (a === 'nova-senha') return viewNovaSenha();
    if (!S.me) {
      if (a === 'entrar') return viewLogin(['professor', 'administrador'].includes(b) ? b : 'aluno');
      if (a === 'cadastro') return await viewCadastro(b);
      return viewLanding();
    }
    if (a === '') return viewLanding();
    if (['entrar', 'cadastro'].includes(a)) return go('#/inicio');
    const tabela = tabelaDoPerfil();
    const nome = tabela[a] && MENU[S.me.perfil].some((m) => m[0] === a) ? a : 'inicio';
    S.view = nome;
    const html = await tabela[nome]();
    if (my !== S.nav) return;
    $('#app').innerHTML = shell(nome, html);
    S.sujo = false;
    enhancePw();
    for (const m of MODULOS) m.AFTER?.[nome]?.();  } catch (e) {
    if (my === S.nav && S.me) { $('#app').innerHTML = shell(S.view, vazio('⚠️', e.message)); }
    else if (my === S.nav) toast(e.message, 'err');
  }
}
for (const ev of ['click', 'keydown']) document.addEventListener(ev, marcarUso, true);
window.addEventListener('hashchange', () => { if (S.cal) S.cal.cache = null; S.editAtv = null; S.editHor = null; S.editEv = null; S.horPre = null; route(); });

/* ---------- sessão / tempo real ---------- */
// quais telas dependem de cada recurso alterado no servidor
const DEPENDE = {
  calendario: ['calendario', 'inicio'], horarios: ['horarios', 'inicio'], notas: ['notas', 'inicio', 'relatorios', 'historico'],
  atividades: ['atividades', 'inicio', 'calendario', 'relatorios'], alunos: ['alunos', 'inicio'], vinculos: ['inicio', 'perfil', 'horarios', 'aprovacoes'], perfil: ['inicio', 'perfil', 'horarios', 'calendario'], usuarios: ['usuarios', 'inicio'],
};
// não recarrega a tela enquanto a pessoa está preenchendo um formulário
const podeRecarregar = () => !S.sujo && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
async function iniciarSessao(me) {
  S.me = me;
  try { const d = await api('GET', '/api/notificacoes'); S.notifs = d.itens; S.unread = d.nao_lidas; } catch { /* segue */ }
  clearInterval(S.es);
  S.es = setInterval(verificarNovidades, 30000);
}
// no GitHub Pages não há conexão em tempo real: as novidades são consultadas periodicamente
const RECURSO = { nota: ['notas'], horario: ['horarios'], atividade: ['atividades'], evento: ['calendario'], vinculo: ['vinculos'], turma: ['alunos'], aviso: ['perfil'], lembrete: [] };
let consultando = false;
async function verificarNovidades() {
  if (!S.me || consultando) return;
  consultando = true;
  try {
    const conhecidas = new Set(S.notifs.map((n) => n.id));
    const d = await api('GET', '/api/notificacoes');
    if (!S.me) return;
    const novas = d.itens.filter((n) => !conhecidas.has(n.id)).reverse();
    S.notifs = d.itens; S.unread = d.nao_lidas;
    updateBell();
    const mudou = new Set();
    for (const n of novas) {
      toast(`${ICONES[n.tipo] || '🔔'} ${n.titulo}`);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(n.titulo, { body: n.mensagem, icon: 'logo.webp' });
      for (const r of RECURSO[n.tipo] ?? []) mudou.add(r);
    }
    for (const r of mudou) S.versao[r] = (S.versao[r] || 0) + 1;
    if (mudou.has('vinculos') || mudou.has('perfil')) S.me = await api('GET', '/api/eu');
    if (podeRecarregar() && (novas.length && S.view === 'notificacoes' || [...mudou].some((r) => DEPENDE[r]?.includes(S.view)))) route();
  } catch (e) { if (e.status === 403 && S.me) { toast(e.message, 'err'); sair(); } } finally { consultando = false; }
}
async function sair(chamar = true) {
  if (chamar) { try { await api('POST', '/api/logout'); } catch { /* ignora */ } }
  clearInterval(S.es); S.es = null; S.me = null; S.notifs = []; S.unread = 0; S.versao = {}; limparOpcoes();
  // nada da sessão anterior (filtros, seleções, dados em cache) passa para o próximo usuário
  Object.assign(S, { cal: null, rel: null, hist: null, adm: null, admLista: null, notaMap: null, notasCtx: { turma: '', materia: '' }, alunosTurma: '', horTurma: '', horPre: null, editAtv: null, editHor: null, atvTab: 'pend', notifFiltro: 'todas', fotoTmp: undefined, sujo: false });
  go('#/entrar');
}

/* ---------- ações (cliques) ---------- */
const lerCampos = (form) => Object.fromEntries(new FormData(form).entries());
const marcados = (form, nome) => {
  const ids = [], novas = [];
  form.querySelectorAll(`input[name="${nome}"]:checked`).forEach((i) => (i.dataset.novo ? novas.push(i.value) : ids.push(Number(i.value))));
  return { ids, novas };
};
const setErr = (form, msg) => { const e = $('#err', form); if (e) e.textContent = msg || ''; };
async function lerAtualizarNotif(id, lida) { await api('PATCH', `/api/notificacoes/${id}`, { lida }); const n = S.notifs.find((x) => x.id === id); if (n && !!n.lida !== !!lida) { n.lida = lida ? 1 : 0; S.unread += lida ? -1 : 1; } }

const ACOES = {
  ir: (el) => { $('.account-drawer')?.classList.remove('open'); $('.drawer-overlay')?.classList.remove('open'); $('.bell-wrap')?.classList.remove('open'); go(el.dataset.to); },
  tema: () => { const d = document.documentElement; const novo = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = novo; try { localStorage.setItem('tema', novo); } catch { /* ok */ } },
  drawer: () => { $('.account-drawer').classList.add('open'); $('.drawer-overlay').classList.add('open'); },
  'drawer-fechar': () => { $('.account-drawer').classList.remove('open'); $('.drawer-overlay').classList.remove('open'); },
  bell: () => $('.bell-wrap').classList.toggle('open'),
  sair: () => sair(),
  esqueci: async () => {
    const email = $('input[name=email]')?.value.trim();
    if (!email) return toast('Digite seu e-mail no campo acima e clique de novo.', 'err');
    await api('POST', '/api/recuperar', { email });
    toast('Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.', 'ok');
  },
  'sair-todas': async () => { if (!confirm('Encerrar sua sessão em todos os dispositivos?')) return; await api('POST', '/api/logout-todas'); await sair(false); toast('Sessões encerradas.', 'ok'); },
  'ver-senha': (el) => {
    const inp = el.parentElement.querySelector('input'), mostrar = inp.type === 'password';
    inp.type = mostrar ? 'text' : 'password';
    el.innerHTML = svg(mostrar ? 'eyeoff' : 'eye');
    el.setAttribute('aria-pressed', String(mostrar)); el.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  },
  'tab-perfil': (el) => {
    const p = el.dataset.p;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === el));
    $('input[name=perfil]').value = p; $('#alt-box').hidden = p === 'administrador';
    if (p !== 'administrador') $('#alt-cad').href = `#/cadastro/${p}`;
  },
  'add-chip': (el) => {
    const alvo = el.dataset.alvo, inp = $(`#novo-${alvo}`), v = inp.value.trim();
    if (!v) return;
    const box = $(`#chips-${alvo}`);
    if ([...box.querySelectorAll('input')].some((i) => i.nextElementSibling.textContent.toLowerCase() === v.toLowerCase())) { inp.value = ''; return; }
    const l = document.createElement('label'); l.className = 'chip-opt';
    const i = document.createElement('input'); i.type = 'checkbox'; i.name = alvo; i.value = v; i.checked = true; i.dataset.novo = '1';
    const s = document.createElement('span'); s.textContent = v; l.append(i, s); box.append(l); inp.value = '';
  },
  'ler-todas': async () => { await api('POST', '/api/notificacoes/ler-todas'); S.notifs.forEach((n) => (n.lida = 1)); S.unread = 0; toast('Todas marcadas como lidas.', 'ok'); S.view === 'notificacoes' ? route() : updateBell(); },
  'abrir-notif': async (el) => { await lerAtualizarNotif(Number(el.dataset.id), 1); updateBell(); },
  'notif-lida': async (el) => { await lerAtualizarNotif(Number(el.dataset.id), el.dataset.v === '1'); route(); },
  'notif-del': async (el) => { await api('DELETE', `/api/notificacoes/${el.dataset.id}`); toast('Notificação excluída.', 'ok'); route(); },
  'notif-filtro': (el) => { S.notifFiltro = el.dataset.f; route(); },
  push: async () => { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Avisos do navegador ativados.' : 'Permissão não concedida.', r === 'granted' ? 'ok' : ''); route(); },
  'atv-tab': (el) => { S.atvTab = el.dataset.t; route(); },
  concluir: async (el) => { await api('PUT', `/api/atividades/${el.dataset.id}/concluida`, { concluida: el.dataset.v === '1' }); route(); },
  'edit-atv': (el) => { S.editAtv = Number(el.dataset.id); route(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'cancel-atv': () => { S.editAtv = null; route(); },
  'del-atv': async (el) => { if (!confirm('Excluir esta atividade? Os alunos serão avisados.')) return; await api('DELETE', `/api/atividades/${el.dataset.id}`); toast('Atividade excluída.', 'ok'); route(); },
  'edit-hor': (el) => { S.editHor = Number(el.dataset.id); route(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'cancel-hor': () => { S.editHor = null; S.horPre = null; route(); },
  'sel-turma': (el) => { S.horTurma = el.dataset.id; S.editHor = null; S.horPre = null; route(); },
  'nova-aula': (el) => { S.editHor = null; S.horPre = { dia: Number(el.dataset.dia), slot: Number(el.dataset.slot) }; route(); setTimeout(() => $('form[data-form=horario]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250); },
  'del-hor': async (el) => { if (!confirm('Excluir esta aula da grade? Os alunos serão avisados.')) return; await api('DELETE', `/api/horarios/${el.dataset.id}`); toast('Aula removida da grade.', 'ok'); route(); },
  'alunos-turma': (el) => { S.alunosTurma = el.dataset.id; go('#/alunos'); },
};

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) { if (!ev.target.closest('.bell-wrap')) $('.bell-wrap')?.classList.remove('open'); return; }
  const fn = ACOES[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') ev.preventDefault();
  try { await fn(el, ev); } catch (e) { toast(e.message, 'err'); }
});
document.addEventListener('keydown', (ev) => {
  if ((ev.key === ' ' || ev.key === 'Enter') && ev.target.matches?.('[role=checkbox][data-act],.blk[data-act]')) { ev.preventDefault(); ev.target.click(); }
  if (ev.key === 'Escape') { $('.bell-wrap')?.classList.remove('open'); ACOES['drawer-fechar']?.(); }
});

/* ---------- formulários ---------- */
const SUBMIT = {
  async 'nova-senha'(f) {
    await api('POST', '/api/nova-senha', lerCampos(f));
    toast('Senha atualizada.', 'ok');
    const me = await api('GET', '/api/eu');
    if (!me.anonimo) await iniciarSessao(me);
    go('#/inicio');
  },
  async login(f) {
    const d = lerCampos(f);
    const me = await api('POST', '/api/login', d);
    await iniciarSessao(me); go('#/inicio');
  },
  async 'cadastro-aluno'(f) {
    const d = lerCampos(f);
    if (!d.turma_id) throw new Error('Selecione sua turma.');
    const me = await api('POST', '/api/cadastro/aluno', d);
    if (me.confirmar) return pedirConfirmacao();
    await iniciarSessao(me); toast('Conta criada com sucesso!', 'ok'); go('#/inicio');
  },
  async 'cadastro-professor'(f) {
    const d = lerCampos(f), m = marcados(f, 'materias'), t = marcados(f, 'turmas');
    const me = await api('POST', '/api/cadastro/professor', { ...d, materias: m.ids, novas_materias: m.novas, turmas: t.ids, foto: S.fotoTmp ?? null });
    if (me.confirmar) return pedirConfirmacao();
    await iniciarSessao(me); toast('Conta criada com sucesso!', 'ok'); go('#/inicio');
  },
  async atividade(f) {
    const d = lerCampos(f);
    if (S.editAtv) { await api('PUT', `/api/atividades/${S.editAtv}`, d); toast('Atividade atualizada.', 'ok'); S.editAtv = null; }
    else { await api('POST', '/api/atividades', d); toast('Atividade publicada e alunos avisados.', 'ok'); }
    route();
  },
  async horario(f) {
    const d = lerCampos(f);
    if (S.editHor) { await api('PUT', `/api/horarios/${S.editHor}`, d); toast('Horário atualizado.', 'ok'); S.editHor = null; }
    else { await api('POST', '/api/horarios', d); toast('Aula adicionada à grade.', 'ok'); }
    S.horPre = null;
    route();
  },
  async aviso(f) {
    const r = await api('POST', '/api/avisos', lerCampos(f));
    toast(`Aviso enviado a ${r.enviados} aluno(s).`, 'ok'); f.reset();
  },
  async perfil(f) {
    const d = lerCampos(f);
    const body = { nome: d.nome };
    if (d.turno) body.turno = d.turno;
    if (S.fotoTmp !== undefined) body.foto = S.fotoTmp;
    if (d.nova_senha) { body.nova_senha = d.nova_senha; body.senha_atual = d.senha_atual; }
    S.me = await api('PATCH', '/api/perfil', body); S.fotoTmp = undefined;
    toast('Perfil atualizado.', 'ok'); route();
  },
  async vinculos(f) {
    const m = marcados(f, 'materias'), t = marcados(f, 'turmas');
    S.me = await api('PUT', '/api/professor/vinculos', { materias: m.ids, novas_materias: m.novas, turmas: t.ids });
    limparOpcoes(); toast('Solicitação enviada. Itens novos aguardam aprovação.', 'ok'); route();
  },
};
document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('form[data-form]'); if (!f) return;
  ev.preventDefault();
  const btn = f.querySelector('[type=submit]'); setErr(f, '');
  if (btn) btn.disabled = true;
  try { await SUBMIT[f.dataset.form](f); } catch (e) { setErr(f, e.message); toast(e.message, 'err'); }
  finally { if (btn) btn.disabled = false; }
});

/* ---------- campos que reagem a mudança ---------- */
const CHANGE = {
  async nota(el) {
    const alunoId = el.dataset.aluno, bim = el.dataset.bim, chave = `${alunoId}-${bim}`, v = el.value.trim();
    if (v === el.dataset.orig) return;
    try {
      if (v === '') {
        const id = S.notaMap.get(chave);
        if (id) { await api('DELETE', `/api/notas/${id}`); S.notaMap.delete(chave); toast('Nota removida.', 'ok'); }
      } else {
        const n = await api('PUT', '/api/notas', { aluno_id: Number(alunoId), materia_id: Number(S.notasCtx.materia), trimestre: Number(bim), valor: v });
        S.notaMap.set(chave, n.id); el.value = n.valor; toast('Nota salva.', 'ok');
      }
      el.dataset.orig = el.value; el.classList.remove('bad'); el.classList.add('ok');
      const vals = [...document.querySelectorAll(`.nota-in[data-aluno="${alunoId}"]`)].map((i) => i.value).filter((x) => x !== '').map(Number);
      const m = media(vals), cel = $(`#avg-${alunoId}`);
      cel.textContent = m == null ? '–' : m.toFixed(1); cel.className = `grade-avg ${m == null ? '' : classeMedia(m)}`;
    } catch (e) { el.classList.add('bad'); el.value = el.dataset.orig; toast(e.message, 'err'); }
  },
  'ctx-notas'() { S.notasCtx = { turma: $('#n-turma').value, materia: $('#n-materia').value }; route(); },
  'ctx-alunos'(el) { S.alunosTurma = el.value; route(); },
  async foto(el) { try { S.fotoTmp = await resizeFoto(el.files[0]); toast('Foto selecionada.', 'ok'); } catch (e) { toast(e.message, 'err'); } },
  async 'foto-perfil'(el) { try { S.fotoTmp = await resizeFoto(el.files[0]); $('#foto-prev').innerHTML = avatar({ nome: S.me.nome, foto: S.fotoTmp }, 'lg'); } catch (e) { toast(e.message, 'err'); } },
};
document.addEventListener('change', (ev) => { const el = ev.target.closest('[data-change]'); if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el); });

for (const m of MODULOS) { Object.assign(ACOES, m.ACTIONS); Object.assign(SUBMIT, m.SUBMIT); Object.assign(CHANGE, m.CHANGE); }
document.addEventListener('input', (ev) => { if (ev.target.closest('form[data-form]')) S.sujo = true; });

export {
  $, S, api, esc, toast, go, route, svg, registrarIcones, vazio, avatar, opts, fmtDH, fmtPrazo, ymd, localStr, media, classeMedia, corMateria,
  lerCampos, marcados, opcoes, limparOpcoes, turmaGrupos, turmaOpt, chips, MESES, SEMANA, DIAS, CATEG, ROTULO,
};

/* ---------- início ---------- */
(async function init() {
  try { const t = localStorage.getItem('tema'); if (t) document.documentElement.dataset.theme = t; else document.documentElement.dataset.theme = 'light'; } catch { document.documentElement.dataset.theme = 'light'; }
  const retorno = retornoDoEmail();
  if (retorno?.erro) toast(retorno.erro, 'err');
  try { const me = await api('GET', '/api/eu'); if (!me.anonimo) await iniciarSessao(me); } catch (e) { toast(e.message, 'err'); }
  route();
})();
