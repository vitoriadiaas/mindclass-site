// Calendário escolar: visões mensal, semanal e diária, filtros e eventos por categoria.
import { $, S, api, esc, toast, route, opts, ymd, MESES, SEMANA, CATEG, opcoes, lerCampos } from './app.js';

const est = () => (S.cal ??= { vis: 'mes', data: ymd(new Date()), turma: '', materia: '', categoria: '', edit: null, cache: null });
const paraData = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const soma = (s, dias) => { const d = paraData(s); d.setDate(d.getDate() + dias); return ymd(d); };
const longa = (s, o = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) => paraData(s).toLocaleDateString('pt-BR', o);
const horario = (i) => (i.tipo === 'atividade' ? `Prazo ${i.inicio}` : i.inicio ? `${i.inicio}${i.fim ? '–' + i.fim : ''}` : 'Dia todo');

function intervalo(c) {
  const d = paraData(c.data);
  if (c.vis === 'dia') return [c.data, c.data];
  if (c.vis === 'semana') { const ini = soma(c.data, -d.getDay()); return [ini, soma(ini, 6)]; }
  const primeiro = new Date(d.getFullYear(), d.getMonth(), 1), ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  primeiro.setDate(primeiro.getDate() - primeiro.getDay());
  ultimo.setDate(ultimo.getDate() + (6 - ultimo.getDay()));
  return [ymd(primeiro), ymd(ultimo)];
}

// só busca de novo quando o período, os filtros ou os dados mudam
async function carregar(c) {
  const [de, ate] = intervalo(c);
  const q = new URLSearchParams({ de, ate });
  for (const [k, v] of [['turma_id', c.turma], ['materia_id', c.materia], ['categoria', c.categoria]]) if (v) q.set(k, v);
  const chave = `${S.me.id}|${q}|${S.versao.calendario || 0}|${S.versao.atividades || 0}`;
  if (c.cache?.chave !== chave) c.cache = { chave, itens: await api('GET', `/api/calendario?${q}`) };
  return c.cache.itens;
}

const cartao = (i) => `<div class="row-card"><div class="cat-bar cat-${i.categoria}"></div><div class="grow">
    <div class="t">${i.tipo === 'atividade' ? 'Prazo: ' : ''}${esc(i.titulo)}</div>
    <div class="m">${horario(i)}${i.materia ? ' · ' + esc(i.materia) : ''} · ${i.turma ? 'Turma ' + esc(i.turma) : 'Pessoal'}${i.autor && i.autor !== S.me.nome ? ' · ' + esc(i.autor) : ''}${i.concluida ? ' · concluída' : ''}</div>
    ${i.descricao ? `<div class="m">${esc(i.descricao)}</div>` : ''}</div>
  <span class="cat-tag cat-${i.categoria}">${CATEG[i.categoria]}</span>
  ${i.editavel ? `<button class="btn btn-ghost btn-sm" data-act="cal-editar" data-id="${i.id}">Editar</button>` : ''}</div>`;
const chip = (i) => `<span class="cal-chip cat-${i.categoria}" title="${esc(i.titulo)}">${i.inicio && i.tipo === 'evento' ? i.inicio + ' ' : ''}${esc(i.titulo)}</span>`;

function formulario(ed, c, op) {
  const adm = S.me.perfil === 'administrador', prof = S.me.perfil === 'professor';
  const turmas = adm ? op.turmas : prof ? S.me.turmas : null;
  const materias = prof ? S.me.materias : op.materias;
  const cat = ed?.categoria ?? 'evento';
  return `<h3 class="section-title" style="margin-top:18px">${ed ? 'Editar compromisso' : 'Novo compromisso'}</h3>
  <form class="form-wrap open" data-form="evento" novalidate><div class="form-error" id="err"></div><div class="form-grid">
    <div style="grid-column:1/-1"><label class="form-label">Título</label><input class="form-input" name="titulo" maxlength="80" value="${esc(ed?.titulo)}" placeholder="Ex.: Prova do 2º trimestre" required></div>
    <div><label class="form-label">Tipo</label><select class="form-input" name="categoria">${Object.entries(CATEG).map(([k, v]) => `<option value="${k}" ${cat === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label class="form-label">Data</label><input class="form-input" type="date" name="data" value="${esc(ed?.data ?? c.data)}" required></div>
    <div><label class="form-label">Início (opcional)</label><input class="form-input" type="time" name="inicio" value="${esc(ed?.inicio)}"></div>
    <div><label class="form-label">Término (opcional)</label><input class="form-input" type="time" name="fim" value="${esc(ed?.fim)}"></div>
    ${turmas ? `<div><label class="form-label">Turma</label><select class="form-input" name="turma_id"><option value="">Somente para mim</option>${turmas.map((t) => `<option value="${t.id}" ${(ed ? ed.turma_id : Number(c.turma)) === t.id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></div>` : ''}
    <div><label class="form-label">Matéria (opcional)</label><select class="form-input" name="materia_id">${opts(materias, ed?.materia_id, 'Nenhuma')}</select></div></div>
    <div class="field"><label class="form-label">Descrição (opcional)</label><input class="form-input" name="descricao" maxlength="300" value="${esc(ed?.descricao)}"></div>
    ${turmas ? '<div class="hint" style="margin-bottom:10px">Compromissos de turma avisam os alunos.</div>' : '<div class="hint" style="margin-bottom:10px">Seus compromissos são pessoais: só você os vê.</div>'}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="submit">${ed ? 'Salvar' : '+ Adicionar'}</button>${ed ? `<button type="button" class="btn btn-danger btn-sm" data-act="cal-excluir" data-id="${ed.id}">Excluir</button><button type="button" class="btn btn-ghost btn-sm" data-act="cal-cancelar">Cancelar</button>` : ''}</div></form>`;
}

async function pagina() {
  const c = est();
  const [itens, op] = await Promise.all([carregar(c), opcoes()]);
  const doDia = (k) => itens.filter((i) => i.data === k);
  const hoje = ymd(new Date()), ref = paraData(c.data), [de, ate] = intervalo(c);
  const titulo = c.vis === 'mes' ? `${MESES[ref.getMonth()]} ${ref.getFullYear()}`
    : c.vis === 'semana' ? `${longa(de, { day: '2-digit', month: 'short' })} – ${longa(ate, { day: '2-digit', month: 'short', year: 'numeric' })}`
      : longa(c.data, { day: 'numeric', month: 'long' });

  let corpo = '';
  if (c.vis === 'mes') {
    let celulas = '';
    for (let k = de; k <= ate; k = soma(k, 1)) {
      const d = paraData(k), lista = doDia(k);
      celulas += `<button type="button" class="cal-cel ${d.getMonth() !== ref.getMonth() ? 'fora' : ''} ${k === hoje ? 'hoje' : ''} ${k === c.data ? 'sel' : ''}" data-act="cal-dia" data-d="${k}" aria-label="${longa(k)}${lista.length ? `, ${lista.length} compromisso(s)` : ''}"><span class="cal-n">${d.getDate()}</span><span class="cal-chips">${lista.slice(0, 3).map(chip).join('')}${lista.length > 3 ? `<span class="cal-mais">+${lista.length - 3}</span>` : ''}</span></button>`;
    }
    corpo = `<div class="cal-sem">${SEMANA.map((s) => `<span>${s}</span>`).join('')}</div><div class="cal-grid">${celulas}</div>`;
  } else if (c.vis === 'semana') {
    let cols = '';
    for (let k = de; k <= ate; k = soma(k, 1)) {
      cols += `<button type="button" class="sem-col ${k === hoje ? 'hoje' : ''} ${k === c.data ? 'sel' : ''}" data-act="cal-dia" data-d="${k}"><span class="sem-h">${SEMANA[paraData(k).getDay()]} <b>${paraData(k).getDate()}</b></span><span class="sem-itens">${doDia(k).map((i) => `<span class="sem-item cat-${i.categoria}"><small>${horario(i)}</small>${esc(i.titulo)}</span>`).join('') || '<small class="sem-vazio">—</small>'}</span></button>`;
    }
    corpo = `<div class="sem-grid">${cols}</div>`;
  } else {
    corpo = doDia(c.data).map(cartao).join('') || '<div class="m" style="padding:24px;text-align:center;color:var(--text-3)">Nenhum compromisso neste dia.</div>';
  }

  const ed = itens.find((i) => i.tipo === 'evento' && i.id === c.edit && i.editavel);
  const turmasFiltro = S.me.perfil === 'administrador' ? op.turmas : S.me.turmas;
  const materiasFiltro = S.me.perfil === 'professor' ? S.me.materias : op.materias;
  const selecionado = doDia(c.data);
  return `<div class="page-title">Calendário escolar</div><div class="page-sub">Provas, trabalhos, atividades e eventos. Os prazos das atividades aparecem automaticamente.</div>
    <div class="toolbar">
      <div><label class="form-label">Turma</label><select class="form-input" data-change="cal-filtro" id="f-turma">${opts(turmasFiltro, c.turma, 'Todas')}</select></div>
      <div><label class="form-label">Matéria</label><select class="form-input" data-change="cal-filtro" id="f-materia">${opts(materiasFiltro, c.materia, 'Todas')}</select></div>
      <div><label class="form-label">Tipo</label><select class="form-input" data-change="cal-filtro" id="f-categoria">${opts(Object.entries(CATEG).map(([id, nome]) => ({ id, nome })), c.categoria, 'Todos')}</select></div>
    </div>
    <div class="cal-layout"><div class="cal-box">
      <div class="filter-row" role="tablist">${[['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']].map(([k, n]) => `<button class="fchip ${c.vis === k ? 'active' : ''}" role="tab" aria-selected="${c.vis === k}" data-act="cal-vis" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="cal-head"><button class="btn btn-ghost btn-sm" data-act="cal-nav" data-delta="-1" aria-label="Anterior">‹</button><h2>${titulo}</h2><button class="btn btn-ghost btn-sm" data-act="cal-nav" data-delta="1" aria-label="Próximo">›</button><button class="btn btn-outline btn-sm" data-act="cal-hoje">Hoje</button></div>
      ${corpo}
      <div class="cal-legenda">${Object.entries(CATEG).map(([k, v]) => `<span><i class="cat-dot cat-${k}"></i>${v}</span>`).join('')}</div>
    </div>
    <div class="cal-dia" id="cal-painel">${c.vis === 'dia' ? '' : `<h3 class="section-title cap-first">${longa(c.data)}</h3>${selecionado.map(cartao).join('') || '<div class="m" style="color:var(--text-3)">Nada marcado para este dia.</div>'}`}
      ${formulario(ed, c, op)}</div></div>`;
}

export const VIEWS = { calendario: pagina };
const recarregar = () => { S.sujo = false; return route(); };
export const ACTIONS = {
  'cal-vis': (el) => { est().vis = el.dataset.v; est().edit = null; return recarregar(); },
  'cal-nav': (el) => {
    const c = est(), n = Number(el.dataset.delta);
    if (c.vis === 'mes') { const d = paraData(c.data); c.data = ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
    else c.data = soma(c.data, n * (c.vis === 'semana' ? 7 : 1));
    c.edit = null; return recarregar();
  },
  'cal-hoje': () => { est().data = ymd(new Date()); est().edit = null; return recarregar(); },
  'cal-dia': async (el) => {
    est().data = el.dataset.d; est().edit = null; await recarregar();
    if (innerWidth < 1000) $('#cal-painel')?.scrollIntoView({ behavior: 'smooth' });
  },
  'cal-editar': async (el) => { est().edit = Number(el.dataset.id); await recarregar(); $('form[data-form=evento]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  'cal-cancelar': () => { est().edit = null; return recarregar(); },
  'cal-excluir': async (el) => {
    if (!confirm('Excluir este compromisso?')) return;
    await api('DELETE', `/api/agenda/${el.dataset.id}`);
    est().edit = null; est().cache = null; toast('Compromisso excluído.', 'ok'); return recarregar();
  },
};
export const CHANGE = {
  'cal-filtro': () => { const c = est(); c.turma = $('#f-turma').value; c.materia = $('#f-materia').value; c.categoria = $('#f-categoria').value; c.edit = null; recarregar(); },
};
export const SUBMIT = {
  async evento(f) {
    const c = est(), d = lerCampos(f);
    if (c.edit) await api('PUT', `/api/agenda/${c.edit}`, d); else await api('POST', '/api/agenda', d);
    toast(c.edit ? 'Compromisso atualizado.' : 'Compromisso adicionado.', 'ok');
    c.edit = null; c.cache = null; c.data = d.data;
    await recarregar();
  },
};
