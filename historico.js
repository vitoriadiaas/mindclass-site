// Histórico de notas (somente leitura): cada criação, alteração ou exclusão fica registrada no banco.
import { $, S, api, esc, route, opts, vazio, opcoes } from './app.js';

const est = () => (S.hist ??= { turma: '', aluno: '', materia: '', trimestre: '', acao: '', de: '', ate: '', pagina: 1 });
const ACAO = { criada: ['Lançada', 'cat-evento'], alterada: ['Alterada', 'cat-trabalho'], excluida: ['Excluída', 'cat-prova'] };
const nota = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

const item = (h) => {
  const [rotulo, cat] = ACAO[h.acao];
  return `<div class="row-card hist-item"><div class="cat-bar ${cat}"></div>
    <div class="grow"><div class="t">${S.me.perfil === 'aluno' ? '' : esc(h.aluno) + ' · '}${esc(h.materia)}</div>
      <div class="m">${h.trimestre}º trimestre de ${h.ano_letivo}${h.turma ? ' · Turma ' + esc(h.turma) : ''}</div>
      <div class="m">Professor: ${esc(h.professor ?? '—')} · Registrado por ${esc(h.alterado_por_nome)} às ${new Date(h.alterado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${h.origem === 'migracao' ? ' · registro inicial (nota anterior ao histórico)' : ''}</div></div>
    <div class="hist-notas" aria-label="Nota anterior ${nota(h.valor_anterior)}, nova nota ${nota(h.valor_novo)}"><span>${nota(h.valor_anterior)}</span><i>→</i><b>${nota(h.valor_novo)}</b></div>
    <span class="cat-tag ${cat}">${rotulo}</span></div>`;
};

async function pagina() {
  const e = est(), me = S.me, aluno = me.perfil === 'aluno', op = await opcoes();
  const turmas = me.perfil === 'administrador' ? op.turmas : me.turmas;
  const materias = me.perfil === 'professor' ? me.materias : op.materias;
  const alunos = !aluno && e.turma ? await api('GET', `/api/turmas/${e.turma}/alunos`) : [];
  const q = new URLSearchParams({ pagina: e.pagina, por_pagina: 30 });
  for (const [k, v] of [['turma_id', aluno ? '' : e.turma], ['aluno_id', aluno ? '' : e.aluno], ['materia_id', e.materia], ['trimestre', e.trimestre], ['acao', e.acao], ['de', e.de], ['ate', e.ate]]) if (v) q.set(k, v);
  const r = await api('GET', `/api/historico-notas?${q}`);
  const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
  let dia = '', lista = '';
  for (const h of r.itens) {
    const d = new Date(h.alterado_em).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (d !== dia) { dia = d; lista += `<h3 class="section-title hist-dia cap-first">${d}</h3>`; }
    lista += item(h);
  }
  const campo = (rot, id, lista_, ph) => `<div><label class="form-label">${rot}</label><select class="form-input" data-change="hist-filtro" id="${id}">${opts(lista_, e[id.slice(2)], ph)}</select></div>`;
  return `<div class="page-title">Histórico de notas</div><div class="page-sub">${aluno ? 'Todas as alterações das suas notas.' : me.perfil === 'professor' ? 'Alterações das notas dos alunos das suas turmas, nas matérias que você leciona.' : 'Histórico geral da escola.'} Os registros não podem ser editados nem apagados.</div>
    <div class="toolbar">
      ${aluno ? '' : campo('Turma', 'h-turma', turmas, 'Todas')}
      ${aluno || !e.turma ? '' : campo('Aluno', 'h-aluno', alunos, 'Todos')}
      ${campo('Matéria', 'h-materia', materias, 'Todas')}
      ${campo('Trimestre', 'h-trimestre', [1, 2, 3].map((b) => ({ id: b, nome: `${b}º` })), 'Todos')}
      ${campo('Ação', 'h-acao', Object.entries(ACAO).map(([id, [nome]]) => ({ id, nome })), 'Todas')}
      <div><label class="form-label">De</label><input class="form-input" type="date" id="h-de" data-change="hist-filtro" value="${esc(e.de)}"></div>
      <div><label class="form-label">Até</label><input class="form-input" type="date" id="h-ate" data-change="hist-filtro" value="${esc(e.ate)}"></div>
      <button class="btn btn-ghost btn-sm" data-act="hist-limpar">Limpar</button></div>
    <div class="m" style="margin-bottom:8px">${r.total} registro(s)</div>
    ${lista || vazio('🗂️', 'Nenhuma alteração de nota encontrada.')}
    ${paginas > 1 ? `<div class="paginacao"><button class="btn btn-ghost btn-sm" data-act="hist-pagina" data-p="${e.pagina - 1}" ${e.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span>Página ${e.pagina} de ${paginas}</span><button class="btn btn-ghost btn-sm" data-act="hist-pagina" data-p="${e.pagina + 1}" ${e.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button></div>` : ''}`;
}

export const VIEWS = { historico: pagina };
export const ACTIONS = {
  'hist-pagina': (el) => { est().pagina = Number(el.dataset.p); window.scrollTo(0, 0); return route(); },
  'hist-limpar': () => { S.hist = null; return route(); },
};
export const CHANGE = {
  'hist-filtro': () => {
    const e = est(), v = (id) => $(`#h-${id}`)?.value ?? '';
    if (v('turma') !== String(e.turma)) { e.turma = v('turma'); e.aluno = ''; } else e.aluno = v('aluno');
    for (const k of ['materia', 'trimestre', 'acao', 'de', 'ate']) e[k] = v(k);
    e.pagina = 1; route();
  },
};
export const SUBMIT = {};
