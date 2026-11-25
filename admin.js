// Painel administrativo (só aparece para administradores; o servidor confere a permissão em cada rota).
import { $, S, api, esc, toast, route, go, opts, vazio, avatar, opcoes, limparOpcoes, lerCampos, marcados, chips, turmaGrupos, turmaOpt, fmtDH, ROTULO } from './app.js';

const est = () => (S.adm ??= { q: '', perfil: '', ativo: '', pagina: 1, novo: false, novoPerfil: 'aluno', edit: null, senha: null, aud: 1 });
const TURNOS = ['manhã', 'tarde', 'noite', 'integral'];
const selTurno = (v) => `<div><label class="form-label">Turno</label><select class="form-input" name="turno">${TURNOS.map((t) => `<option value="${t}" ${v === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>`;
const campo = (rot, nome, valor = '', extra = '') => `<div><label class="form-label">${rot}</label><input class="form-input" name="${nome}" value="${esc(valor)}" ${extra}></div>`;
const botoes = (rot) => `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="submit">${rot}</button><button type="button" class="btn btn-ghost btn-sm" data-act="adm-cancelar">Cancelar</button></div>`;
const paginacao = (r, acao) => {
  const total = Math.max(1, Math.ceil(r.total / r.por_pagina));
  return total > 1 ? `<div class="paginacao"><button class="btn btn-ghost btn-sm" data-act="${acao}" data-p="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span>Página ${r.pagina} de ${total}</span><button class="btn btn-ghost btn-sm" data-act="${acao}" data-p="${r.pagina + 1}" ${r.pagina >= total ? 'disabled' : ''}>Próxima ›</button></div>` : '';
};

async function inicio() {
  const r = await api('GET', '/api/admin/resumo');
  const st = (n, t, c) => `<div class="stat-card ${c}"><div class="stat-num">${n ?? 0}</div><div class="stat-label">${t}</div></div>`;
  return `<div class="page-title">Visão geral</div><div class="page-sub">Administração do MindClass</div>
    ${r.pendencias ? `<div class="perm-note aviso-acao"><span>${r.pendencias} professor(es) aguardando aprovação de turmas/matérias.</span><button class="btn btn-primary btn-sm" data-act="ir" data-to="#/aprovacoes">Analisar</button></div>` : ''}
    <div class="stats-row">${st(r.usuarios.alunos, 'Alunos', 'c-purple')}${st(r.usuarios.professores, 'Professores', 'c-blue')}${st(r.usuarios.administradores, 'Administradores', 'c-orange')}${st(r.usuarios.inativos, 'Contas desativadas', 'c-pink')}</div>
    <div class="stats-row">${st(r.notas, 'Notas lançadas', 'c-purple')}${st(r.alteracoes_notas, 'Registros no histórico', 'c-blue')}${st(r.atividades_abertas, 'Atividades em aberto', 'c-orange')}${st(r.pendencias, 'Aprovações pendentes', 'c-pink')}</div>
    <h3 class="section-title">Turmas</h3><div class="card table-scroll"><table class="grades-table"><thead><tr><th>Turma</th><th>Horários/dia</th><th>Alunos</th><th>Professores</th></tr></thead>
    <tbody>${r.turmas.map((t) => `<tr><td>${esc(t.nome)}</td><td>${t.num_horarios}</td><td>${t.alunos}</td><td class="${t.alunos && !t.professores ? 'grade-fail' : ''}">${t.professores}</td></tr>`).join('')}</tbody></table></div>`;
}

function formNovo(e, op) {
  const p = e.novoPerfil;
  return `<h3 class="section-title">Novo usuário</h3><form class="form-wrap open" data-form="adm-novo" novalidate><div class="form-error" id="err"></div><div class="form-grid">
    <div><label class="form-label">Perfil</label><select class="form-input" name="perfil" data-change="adm-perfil-novo">${Object.entries(ROTULO).map(([k, v]) => `<option value="${k}" ${p === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${campo('Nome completo', 'nome', '', 'maxlength="100" required')}${campo('E-mail', 'email', '', 'type="email" required')}${campo('Senha provisória', 'senha', '', 'type="password" autocomplete="new-password" required')}
    ${p === 'aluno' ? `<div><label class="form-label">Turma</label><select class="form-input" name="turma_id">${opts(op.turmas, '', 'Selecione…')}</select></div>${campo('Matrícula (opcional)', 'matricula', '', 'maxlength="30"')}` : ''}
    ${p === 'professor' ? selTurno('manhã') : ''}</div>
    ${p === 'professor' ? `<div class="field"><label class="form-label">Matérias (opcional)</label><div class="chip-box">${chips('materias', op.materias)}</div></div><div class="field"><label class="form-label">Turmas (opcional)</label>${turmaGrupos(op.turmas, turmaOpt('checkbox', 'turmas'))}</div>` : ''}
    ${botoes('Criar usuário')}</form>`;
}

function formEditar(u, op) {
  const idsPorNome = (lista, nomes) => lista.filter((x) => (nomes || '').split(', ').includes(x.nome)).map((x) => x.id);
  return `<h3 class="section-title">Editar ${esc(u.nome)}</h3><form class="form-wrap open" data-form="adm-editar" novalidate><div class="form-error" id="err"></div><div class="form-grid">
    ${campo('Nome completo', 'nome', u.nome, 'maxlength="100"')}${campo('E-mail', 'email', u.email, 'type="email" disabled')}
    ${u.perfil === 'aluno' ? `<div><label class="form-label">Turma</label><select class="form-input" name="turma_id">${opts(op.turmas, u.turma_id)}</select></div>${campo('Matrícula', 'matricula', u.matricula ?? '', 'maxlength="30"')}` : ''}
    ${u.perfil === 'professor' ? selTurno(u.turno) : ''}</div>${botoes('Salvar dados')}</form>
    ${u.perfil === 'professor' ? `<form class="form-wrap open" data-form="adm-vinculos" novalidate><div class="form-error" id="err"></div>
      <div class="field"><label class="form-label">Matérias aprovadas</label><div class="chip-box">${chips('materias', op.materias, idsPorNome(op.materias, u.materias_prof))}</div></div>
      <div class="field"><label class="form-label">Turmas aprovadas</label>${turmaGrupos(op.turmas, turmaOpt('checkbox', 'turmas', idsPorNome(op.turmas, u.turmas_prof)))}</div>
      <div class="hint" style="margin-bottom:10px">Salvar substitui os vínculos deste professor (inclusive solicitações pendentes).</div>${botoes('Salvar vínculos')}</form>` : ''}`;
}

const formSenha = (u) => `<h3 class="section-title">Redefinir senha de ${esc(u.nome)}</h3><form class="form-wrap open" data-form="adm-senha" novalidate><div class="form-error" id="err"></div>
  <div class="form-grid">${campo('Nova senha', 'senha', '', 'type="password" autocomplete="new-password"')}</div><div class="hint" style="margin-bottom:10px">Mínimo de 8 caracteres, com letras e números. As sessões abertas dessa conta serão encerradas.</div>${botoes('Redefinir')}</form>`;

async function usuarios() {
  const e = est(), op = await opcoes();
  const q = new URLSearchParams({ pagina: e.pagina, por_pagina: 20 });
  for (const k of ['q', 'perfil', 'ativo']) if (e[k] !== '') q.set(k, e[k]);
  const r = await api('GET', `/api/admin/usuarios?${q}`);
  S.admLista = r.itens;
  const alvo = r.itens.find((u) => u.id === (e.edit ?? e.senha));
  const detalhe = (u) => (u.perfil === 'aluno' ? `Turma ${esc(u.turma_aluno ?? '—')}` : u.perfil === 'professor' ? `${esc(u.turmas_prof ?? 'sem turmas')} · ${esc(u.materias_prof ?? 'sem matérias')}${u.pendentes ? ` · <b class="grade-warn">${u.pendentes} pendente(s)</b>` : ''}` : 'Acesso total à administração');
  return `<div class="page-title">Usuários</div><div class="page-sub">${r.total} conta(s). Contas não são apagadas, apenas desativadas, para preservar o histórico.</div>
    <div class="toolbar"><div style="flex:2 1 220px"><label class="form-label">Buscar nome ou e-mail</label><input class="form-input" id="a-q" data-change="adm-filtro" value="${esc(e.q)}" placeholder="Digite e pressione Enter"></div>
      <div><label class="form-label">Perfil</label><select class="form-input" id="a-perfil" data-change="adm-filtro">${opts(Object.entries(ROTULO).map(([id, nome]) => ({ id, nome })), e.perfil, 'Todos')}</select></div>
      <div><label class="form-label">Situação</label><select class="form-input" id="a-ativo" data-change="adm-filtro">${opts([{ id: '1', nome: 'Ativas' }, { id: '0', nome: 'Desativadas' }], e.ativo, 'Todas')}</select></div>
      <button class="btn btn-primary btn-sm" data-act="adm-novo-abrir">+ Novo usuário</button></div>
    ${e.novo ? formNovo(e, op) : ''}${e.edit && alvo ? formEditar(alvo, op) : ''}${e.senha && alvo ? formSenha(alvo) : ''}
    <div class="cards">${r.itens.map((u) => `<div class="row-card ${u.ativo ? '' : 'inativo'}">${avatar(u)}<div class="grow"><div class="t">${esc(u.nome)} <span class="etapa-tag">${ROTULO[u.perfil]}</span>${u.ativo ? '' : ' <span class="cat-tag cat-prova">Desativada</span>'}</div>
      <div class="m">${esc(u.email)} · ${u.ultimo_login ? 'último acesso ' + fmtDH(u.ultimo_login) : 'nunca acessou'}</div><div class="m">${detalhe(u)}</div></div>
      <button class="btn btn-ghost btn-sm" data-act="adm-editar" data-id="${u.id}">Editar</button><button class="btn btn-ghost btn-sm" data-act="adm-senha" data-id="${u.id}">Senha</button>
      ${u.id === S.me.id ? '' : `<button class="btn ${u.ativo ? 'btn-danger' : 'btn-outline'} btn-sm" data-act="adm-ativo" data-id="${u.id}" data-v="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>`}</div>`).join('') || vazio('👥', 'Nenhum usuário encontrado.')}</div>
    ${paginacao(r, 'adm-pag')}`;
}

async function aprovacoes() {
  const lista = await api('GET', '/api/admin/pendencias');
  const item = (p, tipo, x) => `<span class="pend-item">${esc(x.nome)}<button data-act="adm-decidir" data-prof="${p.id}" data-tipo="${tipo}" data-ref="${x.id}" data-v="1" title="Aprovar" aria-label="Aprovar ${esc(x.nome)}">✓</button><button class="nao" data-act="adm-decidir" data-prof="${p.id}" data-tipo="${tipo}" data-ref="${x.id}" data-v="0" title="Rejeitar" aria-label="Rejeitar ${esc(x.nome)}">✕</button></span>`;
  const jaTem = (p) => [...p.turmas_aprovadas, ...p.materias_aprovadas].map((x) => esc(x.nome)).join(', ');
  return `<div class="page-title">Aprovações</div><div class="page-sub">Professores só acessam turmas, alunos e notas depois que você aprova. Confira se a pessoa realmente é professor(a) da escola.</div>
    <div class="cards">${lista.map((p) => `<div class="rel-card"><div class="resumo-top"><div><div class="t"><b>${esc(p.nome)}</b></div><div class="m">${esc(p.email)} · turno ${esc(p.turno ?? '—')}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-act="adm-decidir" data-prof="${p.id}" data-v="1">Aprovar tudo</button><button class="btn btn-danger btn-sm" data-act="adm-decidir" data-prof="${p.id}" data-v="0">Rejeitar tudo</button></div></div>
      ${p.turmas_pendentes.length ? `<div class="m">Turmas solicitadas</div><div class="chip-box">${p.turmas_pendentes.map((x) => item(p, 'turma', x)).join('')}</div>` : ''}
      ${p.materias_pendentes.length ? `<div class="m">Matérias solicitadas</div><div class="chip-box">${p.materias_pendentes.map((x) => item(p, 'materia', x)).join('')}</div>` : ''}
      ${jaTem(p) ? `<div class="hint">Já aprovados: ${jaTem(p)}</div>` : ''}</div>`).join('') || vazio('✅', 'Nenhuma solicitação pendente.')}</div>
    <h3 class="section-title" style="margin-top:26px">Cadastrar matéria</h3><form class="form-wrap open" data-form="adm-materia" novalidate><div class="form-error" id="err"></div><div class="add-row"><input class="form-input" name="nome" maxlength="60" placeholder="Nome da nova matéria"><button class="btn btn-primary btn-sm" type="submit">Adicionar</button></div></form>`;
}

const ACOES_AUD = { usuario_criado: 'Usuário criado', usuario_editado: 'Usuário editado', senha_redefinida: 'Senha redefinida', vinculo_aprovado: 'Vínculo aprovado', vinculo_rejeitado: 'Vínculo rejeitado', vinculos_definidos: 'Vínculos definidos', materia_criada: 'Matéria criada', login_falhou: 'Tentativa de login falhou' };
async function auditoria() {
  const r = await api('GET', `/api/admin/auditoria?pagina=${est().aud}&por_pagina=40`);
  return `<div class="page-title">Auditoria</div><div class="page-sub">Ações administrativas e tentativas de acesso malsucedidas. Os registros não podem ser alterados.</div>
    ${r.itens.length ? `<div class="card table-scroll"><table class="grades-table aud"><thead><tr><th>Data</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>IP</th></tr></thead><tbody>${r.itens.map((a) => `<tr><td>${fmtDH(a.em)}</td><td>${esc(a.usuario ?? '—')}</td><td title="${esc(a.detalhe ?? '')}">${ACOES_AUD[a.acao] ?? esc(a.acao)}</td><td>${esc(a.alvo ?? '')}</td><td>${esc(a.ip ?? '')}</td></tr>`).join('')}</tbody></table></div>` : vazio('🗒️', 'Nenhum registro.')}
    ${paginacao(r, 'adm-aud')}`;
}

export const VIEWS = { inicio, usuarios, aprovacoes, auditoria };

const recarregar = () => { S.sujo = false; return route(); };
const fechar = () => { const e = est(); e.novo = false; e.edit = null; e.senha = null; };
export const ACTIONS = {
  'adm-novo-abrir': () => { fechar(); est().novo = true; return recarregar(); },
  'adm-cancelar': () => { fechar(); return recarregar(); },
  'adm-editar': async (el) => { fechar(); est().edit = Number(el.dataset.id); await recarregar(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'adm-senha': async (el) => {
    const u = S.admLista.find((x) => x.id === Number(el.dataset.id));
    if (!confirm(`Enviar um e-mail de redefinição de senha para ${u.email}?`)) return;
    await api('POST', `/api/admin/usuarios/${u.id}/senha`, { email: u.email });
    toast('E-mail de redefinição enviado.', 'ok');
  },
  'adm-ativo': async (el) => {
    const ativar = el.dataset.v === '1';
    if (!ativar && !confirm('Desativar esta conta? A pessoa será desconectada e não poderá entrar até ser reativada.')) return;
    await api('PATCH', `/api/admin/usuarios/${el.dataset.id}`, { ativo: ativar });
    toast(ativar ? 'Conta reativada.' : 'Conta desativada.', 'ok'); await recarregar();
  },
  'adm-pag': (el) => { fechar(); est().pagina = Number(el.dataset.p); return recarregar(); },
  'adm-aud': (el) => { est().aud = Number(el.dataset.p); return recarregar(); },
  'adm-decidir': async (el) => {
    const aprovar = el.dataset.v === '1';
    if (!aprovar && !confirm('Rejeitar esta solicitação?')) return;
    const body = { professor_id: Number(el.dataset.prof), aprovar };
    if (el.dataset.tipo) { body.tipo = el.dataset.tipo; body.ref_id = Number(el.dataset.ref); }
    await api('POST', '/api/admin/pendencias', body);
    toast(aprovar ? 'Aprovado.' : 'Rejeitado.', 'ok'); await recarregar();
  },
};
export const CHANGE = {
  'adm-filtro': () => { const e = est(); fechar(); e.q = $('#a-q').value.trim(); e.perfil = $('#a-perfil').value; e.ativo = $('#a-ativo').value; e.pagina = 1; recarregar(); },
  'adm-perfil-novo': (el) => { est().novoPerfil = el.value; recarregar(); },
};
export const SUBMIT = {
  async 'adm-novo'(f) {
    const d = lerCampos(f), m = marcados(f, 'materias'), t = marcados(f, 'turmas');
    await api('POST', '/api/admin/usuarios', { ...d, materias: m.ids, turmas: t.ids });
    fechar(); toast('Usuário criado.', 'ok'); go('#/usuarios'); await recarregar();
  },
  async 'adm-editar'(f) { await api('PATCH', `/api/admin/usuarios/${est().edit}`, lerCampos(f)); fechar(); toast('Dados salvos.', 'ok'); await recarregar(); },
  async 'adm-vinculos'(f) {
    const m = marcados(f, 'materias'), t = marcados(f, 'turmas');
    await api('PUT', `/api/admin/professores/${est().edit}/vinculos`, { materias: m.ids, turmas: t.ids });
    fechar(); toast('Vínculos salvos.', 'ok'); await recarregar();
  },
  async 'adm-senha'(f) { await api('POST', `/api/admin/usuarios/${est().senha}/senha`, lerCampos(f)); fechar(); toast('Senha redefinida.', 'ok'); await recarregar(); },
  async 'adm-materia'(f) { await api('POST', '/api/admin/materias', lerCampos(f)); limparOpcoes(); toast('Matéria cadastrada.', 'ok'); await recarregar(); },
};
