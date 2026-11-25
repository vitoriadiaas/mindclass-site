// Mesmas "rotas" usadas pelas telas, atendidas pelas funções do banco no Supabase.
// Permissões e validações são feitas no banco (supabase/pages.sql); aqui só se monta a resposta.
import { Erro, rpc, entrar, sair, cadastrar, trocarSenha, definirSenha, recuperar, temSessao } from './supabase.js';

const MEDIA_MINIMA = 6;
const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const s = (v) => (v === undefined || v === null || v === '' ? null : v);
const pad = (x) => String(x).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStr = (d = new Date()) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const COMUNS = new Set(['12345678', '123456789', '1234567890', '87654321', 'qwertyui', 'password', 'password1', 'abc12345', 'senha123', 'senha12345', 'mudar123', 'admin123', 'admin1234', 'trocar123']);
function conferirSenha(senha = '', email = '') {
  let p = null;
  if (senha.length < 8 || senha.length > 72) p = 'A senha deve ter de 8 a 72 caracteres.';
  else if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) p = 'A senha deve ter pelo menos uma letra e um número.';
  else if (COMUNS.has(senha.toLowerCase()) || /^(.)\1+$/.test(senha)) p = 'Essa senha é muito comum. Escolha outra.';
  else { const local = email.split('@')[0].toLowerCase(); if (local.length >= 4 && senha.toLowerCase().includes(local)) p = 'A senha não pode conter o seu e-mail.'; }
  if (p) throw new Erro(400, p);
}
function dadosDeCadastro(b) {
  const nome = (b.nome ?? '').trim(), email = (b.email ?? '').trim().toLowerCase();
  if (!nome) throw new Erro(400, 'Nome completo é obrigatório.');
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Erro(400, 'E-mail inválido.');
  conferirSenha(b.senha, email);
  return { nome, email };
}

async function eu() {
  try { return await rpc('mc_eu'); } catch (e) {
    if (e.status === 401 || e.status === 403) { await sair(); return { anonimo: true }; }
    throw e;
  }
}

/* ---------- cálculos (os dados já chegam filtrados pela permissão de quem pede) ---------- */
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const compara = (porTri) => {
  const t = Object.keys(porTri).map(Number).filter((b) => porTri[b] != null).sort((a, b) => a - b), out = [];
  for (let i = 1; i < t.length; i++) out.push({ de: t[i - 1], para: t[i], delta: r2(porTri[t[i]] - porTri[t[i - 1]]) });
  return out;
};

async function notasAluno() {
  const por = new Map();
  for (const x of await rpc('mc_aluno_notas')) {
    if (!por.has(x.materia_id)) por.set(x.materia_id, { materia_id: x.materia_id, materia: x.materia, trimestres: {} });
    por.get(x.materia_id).trimestres[x.trimestre] = x.valor;
  }
  return [...por.values()].map((m) => ({ ...m, media: media(Object.values(m.trimestres)) }));
}

async function relatorioAluno(q) {
  const d = await rpc('mc_relatorio_aluno', { p_aluno: n(q.get('aluno_id')) });
  const materiaId = n(q.get('materia_id')), trimestre = n(q.get('trimestre'));
  const ok = (m) => !materiaId || m === materiaId;
  const rows = d.notas.filter((r) => ok(r.materia_id));
  const mats = new Map();
  for (const r of rows) {
    if (!mats.has(r.materia_id)) mats.set(r.materia_id, { materia_id: r.materia_id, materia: r.materia, trimestres: {} });
    mats.get(r.materia_id).trimestres[r.trimestre] = r.valor;
  }
  const por_materia = [...mats.values()].map((m) => {
    const md = media(trimestre ? (m.trimestres[trimestre] != null ? [m.trimestres[trimestre]] : []) : Object.values(m.trimestres));
    const ordem = Object.keys(m.trimestres).map(Number).sort((a, b) => a - b);
    const tendencia = ordem.length >= 2 ? r2(m.trimestres[ordem.at(-1)] - m.trimestres[ordem.at(-2)]) : null;
    return { ...m, media: r2(md), tendencia, situacao: md == null ? 'sem_nota' : md < MEDIA_MINIMA ? 'atencao' : 'ok' };
  });
  const porTri = {};
  for (let b = 1; b <= 3; b++) porTri[b] = r2(media(rows.filter((r) => r.trimestre === b).map((r) => r.valor)));
  const medias = por_materia.map((m) => m.media).filter((x) => x != null);
  const atencao = por_materia.filter((m) => m.media != null && (m.media < MEDIA_MINIMA || (m.tendencia != null && m.tendencia <= -1)))
    .map((m) => ({ materia_id: m.materia_id, materia: m.materia, media: m.media, tendencia: m.tendencia, motivo: m.media < MEDIA_MINIMA ? 'media_baixa' : 'queda' }));
  const atv = d.atividades.filter((a) => ok(a.materia_id)), agora = localStr(), pm = new Map();
  const atividades = { total: atv.length, concluidas: 0, pendentes: 0, atrasadas: 0 };
  for (const a of atv) {
    const estado = a.concluida ? 'concluidas' : a.prazo >= agora ? 'pendentes' : 'atrasadas';
    atividades[estado]++;
    if (!pm.has(a.materia_id)) pm.set(a.materia_id, { materia: a.materia, concluidas: 0, pendentes: 0, atrasadas: 0 });
    pm.get(a.materia_id)[estado]++;
  }
  atividades.por_materia = [...pm.values()].sort((a, b) => a.materia.localeCompare(b.materia));
  atividades.taxa_conclusao = atv.length ? r2((atividades.concluidas / atv.length) * 100) : null;
  return { aluno: d.aluno, turmas: d.turmas, media_minima: MEDIA_MINIMA, geral: { media: r2(media(medias)), materias: por_materia.length, notas: rows.length },
    por_materia, por_trimestre: porTri, comparacao: compara(porTri), atencao, atividades };
}

async function relatorioTurma(q) {
  const d = await rpc('mc_relatorio_turma', { p_turma: n(q.get('turma_id')) });
  const materiaId = n(q.get('materia_id')), trimestre = n(q.get('trimestre'));
  const ok = (m) => !materiaId || m === materiaId;
  const naTurma = new Set(d.alunos.map((a) => a.id));
  const dados = d.notas.filter((r) => ok(r.materia_id) && naTurma.has(r.aluno_id));
  const mats = new Map();
  for (const r of dados) {
    if (!mats.has(r.materia_id)) mats.set(r.materia_id, { materia_id: r.materia_id, materia: r.materia, alunos: new Map() });
    const am = mats.get(r.materia_id).alunos;
    if (!am.has(r.aluno_id)) am.set(r.aluno_id, {});
    am.get(r.aluno_id)[r.trimestre] = r.valor;
  }
  const periodo = (t) => (trimestre ? (t[trimestre] != null ? [t[trimestre]] : []) : Object.values(t));
  const mediasAluno = new Map();
  const por_materia = [...mats.values()].sort((a, b) => a.materia.localeCompare(b.materia)).map((m) => {
    const medias = [];
    for (const [aid, t] of m.alunos) {
      const md = media(periodo(t));
      if (md != null) { medias.push(md); if (!mediasAluno.has(aid)) mediasAluno.set(aid, []); mediasAluno.get(aid).push(md); }
    }
    const por_trimestre = {};
    for (let b = 1; b <= 3; b++) por_trimestre[b] = r2(media(dados.filter((r) => r.materia_id === m.materia_id && r.trimestre === b).map((r) => r.valor)));
    return { materia_id: m.materia_id, materia: m.materia, media: r2(media(medias)), por_trimestre, alunos_com_nota: medias.length,
      em_atencao: medias.filter((x) => x < MEDIA_MINIMA).length, maior: medias.length ? r2(Math.max(...medias)) : null, menor: medias.length ? r2(Math.min(...medias)) : null };
  });
  const alunos = d.alunos.map((a) => {
    const md = media(mediasAluno.get(a.id) ?? []), porT = {};
    for (let b = 1; b <= 3; b++) porT[b] = r2(media(dados.filter((r) => r.aluno_id === a.id && r.trimestre === b).map((r) => r.valor)));
    return { id: a.id, nome: a.nome, media: r2(md), em_atencao: md != null && md < MEDIA_MINIMA, por_trimestre: porT };
  });
  const porTri = {};
  for (let b = 1; b <= 3; b++) porTri[b] = r2(media(dados.filter((r) => r.trimestre === b).map((r) => r.valor)));
  const dist = [0, 0, 0, 0];
  for (const a of alunos) if (a.media != null) dist[a.media < 5 ? 0 : a.media < 6 ? 1 : a.media < 8 ? 2 : 3]++;
  const atv = d.atividades.filter((a) => ok(a.materia_id)), total = d.alunos.length, agora = localStr();
  const concl = atv.reduce((x, a) => x + a.concluidas, 0);
  return {
    turma: d.turma, media_minima: MEDIA_MINIMA, alunos_total: total,
    geral: { media: r2(media(alunos.map((a) => a.media).filter((x) => x != null))), em_atencao: alunos.filter((a) => a.em_atencao).length, sem_nota: alunos.filter((a) => a.media == null).length },
    por_materia, por_trimestre: porTri, comparacao: compara(porTri), alunos,
    distribuicao: ['Abaixo de 5', '5 a 5,9', '6 a 7,9', '8 a 10'].map((faixa, i) => ({ faixa, alunos: dist[i] })),
    atividades: { total: atv.length, abertas: atv.filter((a) => a.prazo >= agora).length, taxa_conclusao: atv.length && total ? r2((concl / (atv.length * total)) * 100) : null,
      recentes: atv.slice(0, 10).map((a) => ({ ...a, alunos: total, pct: total ? r2((a.concluidas / total) * 100) : null })) },
  };
}

async function calendario(q) {
  const f = { de: s(q.get('de')), ate: s(q.get('ate')), turma: n(q.get('turma_id')), materia: n(q.get('materia_id')), categoria: s(q.get('categoria')) };
  const querAtividades = !f.categoria || f.categoria === 'atividade';
  const [eventos, atividades] = await Promise.all([
    rpc('mc_eventos', { p_de: f.de, p_ate: f.ate, p_turma: f.turma, p_materia: f.materia, p_categoria: f.categoria }),
    querAtividades ? rpc('mc_atividades') : [],
  ]);
  const prazos = atividades.map((a) => ({ tipo: 'atividade', id: a.id, titulo: a.titulo, descricao: a.descricao, data: a.prazo.slice(0, 10), inicio: a.prazo.slice(11), fim: null,
    categoria: 'atividade', turma_id: a.turma_id, turma: a.turma, materia_id: a.materia_id, materia: a.materia, autor: a.professor, editavel: false, concluida: a.concluida ? 1 : 0 }))
    .filter((a) => (!f.de || a.data >= f.de) && (!f.ate || a.data <= f.ate) && (!f.turma || a.turma_id === f.turma) && (!f.materia || a.materia_id === f.materia));
  return [...eventos, ...prazos].sort((a, b) => (a.data + (a.inicio || '')).localeCompare(b.data + (b.inicio || '')));
}

async function painel() {
  const hoje = new Date();
  const q = new URLSearchParams({ de: ymd(hoje), ate: ymd(new Date(hoje.getTime() + 14 * 864e5)) });
  const [usuario, horarios, atividades, itens] = await Promise.all([rpc('mc_eu'), rpc('mc_horarios'), rpc('mc_atividades'), calendario(q)]);
  const base = { horarios, atividades, proximos: itens.filter((i) => i.tipo === 'evento' || !i.concluida).slice(0, 6) };
  return usuario.perfil === 'aluno' ? { ...base, notas: await notasAluno() } : { ...base, resumo: await rpc('mc_professor_resumo') };
}

async function criarUsuario(b) {
  const { nome, email } = dadosDeCadastro(b);
  const admin = b.perfil === 'administrador';
  let meta;
  if (b.perfil === 'professor') meta = { perfil: 'professor', nome, turno: b.turno, materias: b.materias ?? [], turmas: b.turmas ?? [] };
  else {
    const turma = admin ? (await rpc('mc_opcoes')).turmas[0].id : n(b.turma_id);
    if (!turma) throw new Error('Selecione a turma.');
    meta = { perfil: 'aluno', nome, turma_id: turma, matricula: b.matricula ?? null };
  }
  await cadastrar(email, b.senha, meta, false);
  if (admin) await rpc('mc_admin_tornar_admin', { p_email: email });
  else {
    if (b.perfil === 'professor' && b.materias?.length && b.turmas?.length) {
      const achado = (await rpc('mc_admin_usuarios', { p_q: email })).itens.find((u) => u.email.toLowerCase() === email);
      if (achado) await rpc('mc_admin_vinculos', { p_professor: achado.id, p_materias: b.materias, p_turmas: b.turmas });
    }
    await rpc('mc_admin_registrar', { p_acao: 'usuario_criado', p_alvo: email });
  }
  return { ok: true };
}

/* ---------- tabela de rotas ---------- */
const R = [];
const rota = (metodo, caminho, fn) => R.push({ metodo, re: new RegExp(`^${caminho.replace(/:id/g, '(\\d+)')}$`), fn });

rota('GET', '/api/opcoes', () => rpc('mc_opcoes'));
rota('GET', '/api/eu', () => (temSessao() ? eu() : { anonimo: true }));
rota('POST', '/api/login', async ({ b }) => {
  await entrar((b.email ?? '').trim(), b.senha ?? '');
  let u;
  try { u = await rpc('mc_eu'); } catch (e) { await sair(); throw e.status === 401 ? new Erro(403, 'Esta conta ainda não tem perfil na escola. Procure a administração.') : e; }
  if (b.perfil && b.perfil !== u.perfil) { await sair(); throw new Erro(403, `Esta conta é de ${u.perfil}. Selecione o tipo de acesso correto.`); }
  return u;
});
rota('POST', '/api/logout', () => sair('local'));
rota('POST', '/api/logout-todas', () => sair('global'));
for (const perfil of ['aluno', 'professor']) {
  rota('POST', `/api/cadastro/${perfil}`, async ({ b }) => {
    const { nome, email } = dadosDeCadastro(b);
    if (b.senha !== b.confirmacao) throw new Erro(400, 'A confirmação de senha não confere.');
    let meta;
    if (perfil === 'aluno') meta = { perfil, nome, turma_id: n(b.turma_id), matricula: s(b.matricula) };
    else {
      if (!b.materias?.length && !b.novas_materias?.length) throw new Erro(400, 'Selecione ao menos uma matéria.');
      if (!b.turmas?.length) throw new Erro(400, 'Selecione ao menos uma turma.');
      meta = { perfil, nome, turno: b.turno, materias: b.materias, novas_materias: b.novas_materias, turmas: b.turmas };
    }
    const r = await cadastrar(email, b.senha, meta);
    if (!r.logado) return { confirmar: true };
    // a foto é gravada depois, para não inflar os dados da conta
    if (b.foto) await rpc('mc_perfil_atualizar', { p_foto: b.foto, p_mudar_foto: true }).catch(() => {});
    return rpc('mc_eu');
  });
}
rota('POST', '/api/recuperar', async ({ b }) => { await recuperar(b.email); return { ok: true }; });
rota('POST', '/api/nova-senha', async ({ b }) => {
  conferirSenha(b.senha);
  if (b.senha !== b.confirmacao) throw new Erro(400, 'A confirmação de senha não confere.');
  await definirSenha(b.senha); return { ok: true };
});
rota('PATCH', '/api/perfil', async ({ b }) => {
  let u = await rpc('mc_perfil_atualizar', { p_nome: b.nome ?? null, p_foto: b.foto ?? null, p_mudar_foto: b.foto !== undefined, p_turno: b.turno ?? null });
  if (b.nova_senha) { conferirSenha(b.nova_senha, u.email); await trocarSenha(u.email, b.senha_atual ?? '', b.nova_senha); }
  return u;
});
rota('PUT', '/api/professor/vinculos', ({ b }) => rpc('mc_professor_vinculos', { p_materias: b.materias ?? [], p_novas: b.novas_materias ?? [], p_turmas: b.turmas ?? [] }));
rota('GET', '/api/professor/resumo', () => rpc('mc_professor_resumo'));
rota('GET', '/api/painel', painel);
rota('GET', '/api/turmas/:id/alunos', ({ id }) => rpc('mc_turma_alunos', { p_turma: id }));
rota('GET', '/api/notas', ({ q }) => rpc('mc_notas_turma', { p_turma: n(q.get('turma_id')), p_materia: n(q.get('materia_id')) }));
rota('PUT', '/api/notas', ({ b }) => rpc('mc_nota_salvar', { p_aluno: n(b.aluno_id), p_materia: n(b.materia_id), p_trimestre: n(b.trimestre), p_valor: n(b.valor), p_descricao: s(b.descricao) }));
rota('DELETE', '/api/notas/:id', ({ id }) => rpc('mc_nota_excluir', { p_id: id }));
rota('GET', '/api/aluno/notas', notasAluno);
rota('GET', '/api/aluno/professores', () => rpc('mc_aluno_professores'));
rota('GET', '/api/horarios', ({ q }) => rpc('mc_horarios', { p_turma: n(q.get('turma_id')) }));
const horario = (id, b) => rpc('mc_horario_salvar', { p_id: id, p_turma: n(b.turma_id), p_materia: n(b.materia_id), p_dia: n(b.dia), p_slot: n(b.slot) });
rota('POST', '/api/horarios', ({ b }) => horario(null, b));
rota('PUT', '/api/horarios/:id', ({ id, b }) => horario(id, b));
rota('DELETE', '/api/horarios/:id', ({ id }) => rpc('mc_horario_excluir', { p_id: id }));
rota('GET', '/api/atividades', () => rpc('mc_atividades'));
const atividade = (id, b) => rpc('mc_atividade_salvar', { p_id: id, p_turma: n(b.turma_id), p_materia: n(b.materia_id), p_titulo: b.titulo ?? '', p_descricao: s(b.descricao), p_prazo: s(b.prazo) });
rota('POST', '/api/atividades', ({ b }) => atividade(null, b));
rota('PUT', '/api/atividades/:id', ({ id, b }) => atividade(id, b));
rota('DELETE', '/api/atividades/:id', ({ id }) => rpc('mc_atividade_excluir', { p_id: id }));
rota('PUT', '/api/atividades/:id/concluida', ({ id, b }) => rpc('mc_atividade_concluir', { p_id: id, p_concluida: !!b.concluida }));
rota('POST', '/api/avisos', ({ b }) => rpc('mc_aviso_enviar', { p_turma: n(b.turma_id), p_titulo: b.titulo ?? '', p_mensagem: b.mensagem ?? '' }));
rota('GET', '/api/calendario', ({ q }) => calendario(q));
const evento = (id, b) => rpc('mc_evento_salvar', { p_id: id, p_titulo: b.titulo ?? '', p_descricao: s(b.descricao), p_data: s(b.data), p_inicio: s(b.inicio), p_fim: s(b.fim), p_categoria: s(b.categoria), p_turma: n(b.turma_id), p_materia: n(b.materia_id) });
rota('POST', '/api/agenda', ({ b }) => evento(null, b));
rota('PUT', '/api/agenda/:id', ({ id, b }) => evento(id, b));
rota('DELETE', '/api/agenda/:id', ({ id }) => rpc('mc_evento_excluir', { p_id: id }));
rota('GET', '/api/notificacoes', () => rpc('mc_notificacoes'));
rota('POST', '/api/notificacoes/ler-todas', () => rpc('mc_notificacoes_ler_todas'));
rota('PATCH', '/api/notificacoes/:id', ({ id, b }) => rpc('mc_notificacao_marcar', { p_id: id, p_lida: !!b.lida }));
rota('DELETE', '/api/notificacoes/:id', ({ id }) => rpc('mc_notificacao_excluir', { p_id: id }));
rota('GET', '/api/relatorios/aluno', ({ q }) => relatorioAluno(q));
rota('GET', '/api/relatorios/turma', ({ q }) => relatorioTurma(q));
rota('GET', '/api/historico-notas', ({ q }) => rpc('mc_historico', { p_aluno: n(q.get('aluno_id')), p_turma: n(q.get('turma_id')), p_materia: n(q.get('materia_id')),
  p_trimestre: n(q.get('trimestre')), p_acao: s(q.get('acao')), p_de: s(q.get('de')), p_ate: s(q.get('ate')), p_pagina: n(q.get('pagina')) ?? 1, p_por: n(q.get('por_pagina')) ?? 30 }));
rota('GET', '/api/admin/resumo', () => rpc('mc_admin_resumo'));
rota('GET', '/api/admin/usuarios', ({ q }) => rpc('mc_admin_usuarios', { p_q: s(q.get('q')), p_perfil: s(q.get('perfil')), p_ativo: n(q.get('ativo')), p_pagina: n(q.get('pagina')) ?? 1, p_por: n(q.get('por_pagina')) ?? 20 }));
rota('POST', '/api/admin/usuarios', ({ b }) => criarUsuario(b));
rota('PATCH', '/api/admin/usuarios/:id', ({ id, b }) => rpc('mc_admin_usuario_editar', { p_id: id, p_nome: b.nome ?? null, p_ativo: b.ativo ?? null, p_turma: n(b.turma_id), p_turno: s(b.turno), p_matricula: b.matricula ?? null }));
rota('POST', '/api/admin/usuarios/:id/senha', async ({ b }) => { await recuperar(b.email); await rpc('mc_admin_registrar', { p_acao: 'senha_redefinida', p_alvo: b.email }); return { ok: true }; });
rota('GET', '/api/admin/pendencias', () => rpc('mc_admin_pendencias'));
rota('POST', '/api/admin/pendencias', ({ b }) => rpc('mc_admin_decidir', { p_professor: n(b.professor_id), p_aprovar: !!b.aprovar, p_tipo: s(b.tipo), p_ref: n(b.ref_id) }));
rota('PUT', '/api/admin/professores/:id/vinculos', ({ id, b }) => rpc('mc_admin_vinculos', { p_professor: id, p_materias: b.materias ?? [], p_turmas: b.turmas ?? [] }));
rota('POST', '/api/admin/materias', ({ b }) => rpc('mc_admin_materia', { p_nome: b.nome ?? '' }));
rota('GET', '/api/admin/auditoria', ({ q }) => rpc('mc_admin_auditoria', { p_pagina: n(q.get('pagina')) ?? 1, p_por: n(q.get('por_pagina')) ?? 40 }));

export async function api(metodo, caminho, corpo) {
  const [rotaPura, consulta = ''] = caminho.split('?');
  for (const r of R) {
    if (r.metodo !== metodo) continue;
    const m = r.re.exec(rotaPura);
    if (m) return (await r.fn({ id: m[1] ? Number(m[1]) : null, q: new URLSearchParams(consulta), b: corpo ?? {} })) ?? { ok: true };
  }
  throw new Erro(404, 'Rota não encontrada.');
}
