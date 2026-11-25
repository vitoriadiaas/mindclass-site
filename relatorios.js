// Relatórios de desempenho. Todos os valores vêm de /api/relatorios/* (dados reais do banco).
import { $, S, api, esc, route, opts, vazio, opcoes, corMateria, fmtPrazo } from './app.js';

const est = () => (S.rel ??= { aba: 'turma', turma: '', aluno: '', materia: '', trimestre: '' });
const n1 = (v) => (v == null ? '–' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const classe = (v, min) => (v == null ? '' : v >= 7 ? 'grade-pass' : v >= min ? 'grade-warn' : 'grade-fail');
const sinal = (d) => `<span class="${d > 0 ? 'grade-pass' : d < 0 ? 'grade-fail' : ''}">${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}${n1(d)}</span>`;
const cor = (nome) => { const m = /--c:([^;]+)/.exec(corMateria(nome)); return m ? m[1] : 'var(--purple)'; };
const stat = (n, rot, cls = 'c-purple') => `<div class="stat-card ${cls}"><div class="stat-num">${n}</div><div class="stat-label">${rot}</div></div>`;
const cartao = (titulo, corpo) => `<section class="rel-card"><h3 class="section-title">${titulo}</h3>${corpo}</section>`;
const semDados = (t) => `<div class="m" style="color:var(--text-3)">${t}</div>`;

// barras horizontais; `marca` desenha a linha da média mínima
function barras(itens, { max = 10, marca = null, sufixo = '', formato = n1 } = {}) {
  if (!itens.length) return semDados('Sem dados para o período.');
  return `<div class="barras">${itens.map((i) => `<div class="barra-l"><span class="barra-r" title="${esc(i.rotulo)}">${esc(i.rotulo)}</span>
    <span class="barra-t">${i.valor == null ? '' : `<span class="barra-v ${i.alerta ? 'alerta' : ''}" style="width:${Math.max(0, Math.min(100, (i.valor / max) * 100))}%"></span>`}${marca != null ? `<span class="barra-m" style="left:${(marca / max) * 100}%"></span>` : ''}</span>
    <b>${i.valor == null ? '–' : formato(i.valor) + sufixo}</b></div>`).join('')}</div>`;
}

// gráfico de linhas: evolução das notas nos 3 trimestres
function linhas(series, marca) {
  const usaveis = series.filter((s) => Object.values(s.pontos).some((v) => v != null));
  if (!usaveis.length) return semDados('Sem notas para desenhar a evolução.');
  const W = 600, H = 240, esq = 34, dir = 16, topo = 12, base = 30;
  const x = (b) => esq + ((b - 1) * (W - esq - dir)) / 2, y = (v) => topo + ((10 - v) * (H - topo - base)) / 10;
  const grade = [0, 2, 4, 6, 8, 10].map((v) => `<line x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}" class="g-linha"/><text x="${esq - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const eixo = [1, 2, 3].map((b) => `<text x="${x(b)}" y="${H - 8}" text-anchor="${b === 1 ? 'start' : b === 3 ? 'end' : 'middle'}">${b}º tri</text>`).join('');
  const tracos = usaveis.map((s) => {
    const pts = [1, 2, 3].filter((b) => s.pontos[b] != null).map((b) => [x(b), y(s.pontos[b]), s.pontos[b], b]);
    return `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${s.cor}" stroke-width="${s.forte ? 4 : 2.2}" stroke-linejoin="round"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${s.forte ? 5 : 4}" fill="${s.cor}"><title>${esc(s.nome)} — ${p[3]}º tri: ${n1(p[2])}</title></circle>`).join('')}`;
  }).join('');
  const resumo = usaveis.map((s) => `${s.nome}: ${[1, 2, 3].filter((b) => s.pontos[b] != null).map((b) => `${b}º ${n1(s.pontos[b])}`).join(', ')}`).join('; ');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução das notas. ${esc(resumo)}">${grade}${eixo}<line x1="${esq}" x2="${W - dir}" y1="${y(marca)}" y2="${y(marca)}" class="g-minima"/>${tracos}</svg>
    <div class="legenda">${usaveis.map((s) => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}<span><i class="traco"></i>Média mínima (${marca})</span></div>`;
}

const tabelaTrimestres = (porBim, comp, min) => `<div class="bims">${[1, 2, 3].map((b) => `<div class="bim">${b}º trimestre<b class="${classe(porBim[b], min)}">${n1(porBim[b])}</b></div>`).join('')}</div>
  <div class="m">${comp.length ? comp.map((c) => `${c.de}º → ${c.para}º: ${sinal(c.delta)}`).join(' &nbsp;·&nbsp; ') : 'É preciso ter notas em pelo menos dois trimestres para comparar.'}</div>`;

function htmlAluno(r) {
  const min = r.media_minima, a = r.atividades;
  return `<div class="stats-row">${stat(n1(r.geral.media), 'Média geral')}${stat(r.geral.materias, 'Matérias com nota', 'c-blue')}${stat(r.atencao.length, 'Precisam de atenção', 'c-pink')}${stat(a.taxa_conclusao == null ? '–' : Math.round(a.taxa_conclusao) + '%', 'Atividades concluídas', 'c-orange')}</div>
  ${r.por_materia.length ? '' : vazio('📊', 'Ainda não há notas para os filtros escolhidos.')}
  <div class="rel-grid">
    ${cartao('Média por matéria', barras(r.por_materia.map((m) => ({ rotulo: m.materia, valor: m.media, alerta: m.situacao === 'atencao' })), { marca: min }))}
    ${cartao('Matérias que precisam de atenção', r.atencao.length ? r.atencao.map((x) => `<div class="row-card"><div class="cat-bar cat-prova"></div><div class="grow"><div class="t">${esc(x.materia)}</div><div class="m">${x.motivo === 'media_baixa' ? `Média ${n1(x.media)}, abaixo de ${min}` : `Caiu ${n1(Math.abs(x.tendencia))} ponto(s) no último trimestre`}</div></div><b class="${classe(x.media, min)}">${n1(x.media)}</b></div>`).join('') : semDados(r.por_materia.length ? 'Nenhuma matéria em alerta.' : 'Sem notas.'))}
    ${cartao('Evolução das notas', linhas(r.por_materia.map((m) => ({ nome: m.materia, pontos: m.trimestres, cor: cor(m.materia) })), min))}
    ${cartao('Desempenho por trimestre e comparação', tabelaTrimestres(r.por_trimestre, r.comparacao, min))}
  </div>
  ${r.por_materia.length ? cartao('Boletim detalhado', `<div class="table-scroll"><table class="grades-table"><thead><tr><th>Matéria</th>${[1, 2, 3].map((b) => `<th>${b}º</th>`).join('')}<th>Média</th><th>Tendência</th></tr></thead><tbody>${r.por_materia.map((m) => `<tr><td>${esc(m.materia)}</td>${[1, 2, 3].map((b) => `<td class="${classe(m.trimestres[b] ?? null, min)}">${n1(m.trimestres[b] ?? null)}</td>`).join('')}<td class="grade-avg ${classe(m.media, min)}">${n1(m.media)}</td><td>${m.tendencia == null ? '–' : sinal(m.tendencia)}</td></tr>`).join('')}</tbody></table></div>`) : ''}
  ${cartao('Atividades', `<div class="resumo-nums">${[[a.total, 'Total', 'c-pu'], [a.concluidas, 'Concluídas', 'c-gr'], [a.pendentes, 'Pendentes', 'c-or'], [a.atrasadas, 'Atrasadas', 'c-rd']].map(([n, t, c]) => `<div><b class="${c}">${n}</b><span>${t}</span></div>`).join('')}</div>
    ${a.por_materia.length ? `<div class="table-scroll" style="margin-top:12px"><table class="grades-table"><thead><tr><th>Matéria</th><th>Concluídas</th><th>Pendentes</th><th>Atrasadas</th></tr></thead><tbody>${a.por_materia.map((m) => `<tr><td>${esc(m.materia)}</td><td>${m.concluidas}</td><td>${m.pendentes}</td><td>${m.atrasadas}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="hint">As atividades não são divididas por trimestre.</div>`)}`;
}

function htmlTurma(r) {
  const min = r.media_minima, a = r.atividades;
  const series = [{ nome: 'Turma (geral)', pontos: r.por_trimestre, cor: 'var(--purple)', forte: true }, ...r.por_materia.map((m) => ({ nome: m.materia, pontos: m.por_trimestre, cor: cor(m.materia) }))];
  return `<div class="stats-row">${stat(n1(r.geral.media), 'Média da turma')}${stat(r.alunos_total, 'Alunos', 'c-blue')}${stat(r.geral.em_atencao, 'Alunos abaixo da média', 'c-pink')}${stat(a.taxa_conclusao == null ? '–' : Math.round(a.taxa_conclusao) + '%', 'Conclusão de atividades', 'c-orange')}</div>
  ${r.por_materia.length ? '' : vazio('📊', 'Ainda não há notas para os filtros escolhidos.')}
  <div class="rel-grid">
    ${cartao('Média por matéria', barras(r.por_materia.map((m) => ({ rotulo: m.materia, valor: m.media, alerta: m.media != null && m.media < min })), { marca: min }))}
    ${cartao('Distribuição das médias', barras(r.distribuicao.map((d, i) => ({ rotulo: d.faixa, valor: d.alunos, alerta: i < 2 && d.alunos > 0 })), { max: Math.max(1, r.alunos_total), formato: (v) => v, sufixo: ' aluno(s)' }) + (r.geral.sem_nota ? `<div class="hint">${r.geral.sem_nota} aluno(s) sem nota no período.</div>` : ''))}
    ${cartao('Evolução da turma', linhas(series, min))}
    ${cartao('Comparação entre trimestres', tabelaTrimestres(r.por_trimestre, r.comparacao, min))}
  </div>
  ${r.por_materia.length ? cartao('Resultado por matéria', `<div class="table-scroll"><table class="grades-table"><thead><tr><th>Matéria</th><th>Média</th><th>Maior</th><th>Menor</th><th>Alunos com nota</th><th>Em atenção</th></tr></thead><tbody>${r.por_materia.map((m) => `<tr><td>${esc(m.materia)}</td><td class="grade-avg ${classe(m.media, min)}">${n1(m.media)}</td><td>${n1(m.maior)}</td><td>${n1(m.menor)}</td><td>${m.alunos_com_nota}</td><td>${m.em_atencao}</td></tr>`).join('')}</tbody></table></div>`) : ''}
  ${cartao('Alunos', r.alunos.length ? `<div class="table-scroll"><table class="grades-table"><thead><tr><th>Aluno</th>${[1, 2, 3].map((b) => `<th>${b}º</th>`).join('')}<th>Média</th><th class="nao-imprime"></th></tr></thead><tbody>${r.alunos.map((x) => `<tr class="${x.em_atencao ? 'em-atencao' : ''}"><td>${esc(x.nome)}</td>${[1, 2, 3].map((b) => `<td>${n1(x.por_trimestre[b])}</td>`).join('')}<td class="grade-avg ${classe(x.media, min)}">${n1(x.media)}</td><td class="nao-imprime"><button class="btn btn-ghost btn-sm" data-act="rel-aluno" data-id="${x.id}">Ver relatório</button></td></tr>`).join('')}</tbody></table></div>` : semDados('Nenhum aluno nesta turma.'))}
  ${cartao('Atividades da turma', a.recentes.length ? `<div class="m">${a.total} atividade(s), ${a.abertas} em aberto. Percentual de alunos que concluíram:</div>${barras(a.recentes.map((x) => ({ rotulo: `${x.titulo} (${fmtPrazo(x.prazo)})`, valor: x.pct })), { max: 100, sufixo: '%', formato: (v) => Math.round(v) })}` : semDados('Nenhuma atividade publicada.'))}`;
}

async function pagina() {
  const e = est(), me = S.me, aluno = me.perfil === 'aluno', op = await opcoes();
  const turmas = me.perfil === 'administrador' ? op.turmas : me.turmas;
  const materias = me.perfil === 'professor' ? me.materias : op.materias;
  if (!aluno && !turmas.length) return `<div class="page-title">Relatórios</div>${vazio('🏫', 'Você ainda não tem turmas aprovadas.')}`;
  if (!aluno && !turmas.some((t) => String(t.id) === String(e.turma))) { e.turma = turmas[0].id; e.aluno = ''; }
  let alunos = [];
  if (!aluno && e.aba === 'aluno') {
    alunos = await api('GET', `/api/turmas/${e.turma}/alunos`);
    if (!alunos.some((x) => String(x.id) === String(e.aluno))) e.aluno = alunos[0]?.id ?? '';
  }
  const q = new URLSearchParams();
  if (e.materia) q.set('materia_id', e.materia);
  if (e.trimestre) q.set('trimestre', e.trimestre);
  let corpo, nomeRel;
  if (aluno || e.aba === 'aluno') {
    if (!aluno && !e.aluno) { corpo = vazio('🎓', 'Nenhum aluno nesta turma.'); nomeRel = 'Relatório do aluno'; }
    else {
      if (!aluno) q.set('aluno_id', e.aluno);
      const r = await api('GET', `/api/relatorios/aluno?${q}`);
      corpo = htmlAluno(r); nomeRel = `Relatório individual — ${r.aluno.nome} (${r.turmas.map((t) => t.nome).join(', ')})`;
    }
  } else {
    q.set('turma_id', e.turma);
    const r = await api('GET', `/api/relatorios/turma?${q}`);
    corpo = htmlTurma(r); nomeRel = `Relatório da turma — ${r.turma.nome}`;
  }
  const filtros = [e.materia ? materias.find((m) => String(m.id) === String(e.materia))?.nome : 'Todas as matérias', e.trimestre ? `${e.trimestre}º trimestre` : 'Todos os trimestres'].join(' · ');
  return `<div class="nao-imprime"><div class="page-title">Relatórios</div><div class="page-sub">Desempenho calculado a partir das notas e atividades registradas.${me.perfil === 'professor' ? ' Você vê apenas as matérias que leciona.' : ''}</div>
    ${aluno ? '' : `<div class="filter-row"><button class="fchip ${e.aba === 'turma' ? 'active' : ''}" data-act="rel-aba" data-v="turma">Por turma</button><button class="fchip ${e.aba === 'aluno' ? 'active' : ''}" data-act="rel-aba" data-v="aluno">Por aluno</button></div>`}
    <div class="toolbar">
      ${aluno ? '' : `<div><label class="form-label">Turma</label><select class="form-input" data-change="rel-filtro" id="r-turma">${opts(turmas, e.turma)}</select></div>`}
      ${!aluno && e.aba === 'aluno' ? `<div><label class="form-label">Aluno</label><select class="form-input" data-change="rel-filtro" id="r-aluno">${opts(alunos, e.aluno)}</select></div>` : ''}
      <div><label class="form-label">Matéria</label><select class="form-input" data-change="rel-filtro" id="r-materia">${opts(materias, e.materia, 'Todas')}</select></div>
      <div><label class="form-label">Período</label><select class="form-input" data-change="rel-filtro" id="r-trimestre">${opts([1, 2, 3].map((b) => ({ id: b, nome: `${b}º trimestre` })), e.trimestre, 'Ano todo')}</select></div>
      <button class="btn btn-primary btn-sm" data-act="rel-pdf">Exportar PDF</button></div></div>
    <div class="so-impressao"><img src="logo.webp" alt=""><div><h1>MindClass — ${esc(nomeRel)}</h1><p>${esc(filtros)} · emitido em ${new Date().toLocaleString('pt-BR')} por ${esc(me.nome)}</p></div></div>
    <h2 class="rel-nome nao-imprime">${esc(nomeRel)}</h2>${corpo}`;
}

export const VIEWS = { relatorios: pagina };
export const ACTIONS = {
  'rel-aba': (el) => { est().aba = el.dataset.v; return route(); },
  'rel-aluno': (el) => { est().aba = 'aluno'; est().aluno = el.dataset.id; window.scrollTo(0, 0); return route(); },
  // o navegador abre a caixa de impressão; basta escolher "Salvar como PDF"
  'rel-pdf': () => window.print(),
};
export const CHANGE = {
  'rel-filtro': () => {
    const e = est(), turma = $('#r-turma')?.value;
    if (turma && String(turma) !== String(e.turma)) { e.turma = turma; e.aluno = ''; } else e.aluno = $('#r-aluno')?.value ?? e.aluno;
    e.materia = $('#r-materia').value; e.trimestre = $('#r-trimestre').value;
    route();
  },
};
export const SUBMIT = {};
