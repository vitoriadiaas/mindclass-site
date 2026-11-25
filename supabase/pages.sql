-- MindClass para GitHub Pages: login pelo Supabase Auth e TODAS as regras de permissão dentro do banco.
-- Rode DEPOIS de schema.sql: Supabase > SQL Editor > cole o arquivo inteiro > Run. Pode rodar de novo sem perder dados.
--
-- As tabelas continuam fechadas (RLS sem políticas). O site só consegue chamar as funções "public.mc_*",
-- e cada uma confere quem está logado e o que essa pessoa pode fazer.

begin;

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

alter table public.usuarios add column if not exists auth_id uuid unique references auth.users(id) on delete set null;
alter table public.usuarios alter column senha_hash drop not null;
alter table public.usuarios alter column salt drop not null;

-- ==================================================================== utilidades
create or replace function app.erro(codigo int, mensagem text) returns void language plpgsql as $$
begin
  raise exception using errcode = 'PT' || codigo::text, message = mensagem;
end $$;

create or replace function app.agora_local() returns timestamp language sql stable as
$$ select (now() at time zone 'America/Sao_Paulo')::timestamp(0) $$;

create or replace function app.slot_inicio(s int) returns time language sql immutable as
$$ select (array['07:00','07:50','08:40','09:50','10:40','11:30','13:30','14:20','15:10'])[s]::time $$;
create or replace function app.slot_fim(s int) returns time language sql immutable as
$$ select (array['07:50','08:40','09:30','10:40','11:30','12:20','14:20','15:10','16:00'])[s]::time $$;

create or replace function app.texto(v text, maximo int, campo text, obrigatorio boolean default true) returns text language plpgsql as $$
declare s text := btrim(coalesce(v, ''));
begin
  if s = '' then
    if obrigatorio then perform app.erro(400, campo || ' é obrigatório.'); end if;
    return null;
  end if;
  if char_length(s) > maximo then perform app.erro(400, campo || ' deve ter no máximo ' || maximo || ' caracteres.'); end if;
  return s;
end $$;

create or replace function app.foto_ok(v text) returns text language plpgsql as $$
begin
  if v is null or v = '' then return null; end if;
  if v !~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' then perform app.erro(400, 'Foto inválida.'); end if;
  if char_length(v) > 400000 then perform app.erro(400, 'Foto muito grande (máximo ~300 KB).'); end if;
  return v;
end $$;

-- usuário logado (conta ativa); "perfis" restringe quem pode chamar
create or replace function app.eu(perfis text[] default null) returns public.usuarios
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare u public.usuarios;
begin
  select * into u from usuarios where auth_id = auth.uid();
  if u.id is null then perform app.erro(401, 'Faça login para continuar.'); end if;
  if u.ativo <> 1 then perform app.erro(403, 'Conta desativada. Procure a administração da escola.'); end if;
  if perfis is not null and not (u.perfil = any(perfis)) then perform app.erro(403, 'Seu perfil não tem permissão para esta ação.'); end if;
  return u;
end $$;

create or replace function app.ensina_turma(p bigint, t bigint) returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as
$$ select exists(select 1 from professor_turmas where professor_id = p and turma_id = t and aprovado = 1) $$;
create or replace function app.ensina_materia(p bigint, m bigint) returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as
$$ select exists(select 1 from professor_materias where professor_id = p and materia_id = m and aprovado = 1) $$;
create or replace function app.leciona(p bigint, t bigint, m bigint) returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as
$$ select app.ensina_turma(p, t) and app.ensina_materia(p, m) $$;
create or replace function app.aluno_do_professor(p bigint, a bigint) returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as
$$ select exists(select 1 from aluno_turmas at join professor_turmas pt on pt.turma_id = at.turma_id and pt.professor_id = p and pt.aprovado = 1 where at.aluno_id = a) $$;
create or replace function app.pode_nota(p bigint, a bigint, m bigint) returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as
$$ select app.ensina_materia(p, m) and app.aluno_do_professor(p, a) $$;

create or replace function app.notificar(uid bigint, tipo text, titulo text, msg text, chave text default null) returns void
language sql security definer set search_path = public, extensions, pg_temp as
$$ insert into notificacoes(usuario_id, tipo, titulo, mensagem, chave) values (uid, tipo, titulo, msg, chave) on conflict do nothing $$;

create or replace function app.avisar_turma(t bigint, tipo text, titulo text, msg text, chave text default null) returns void
language sql security definer set search_path = public, extensions, pg_temp as
$$ select app.notificar(aluno_id, tipo, titulo, msg, chave) from aluno_turmas where turma_id = t $$;

create or replace function app.auditar(quem bigint, acao text, alvo text, detalhe jsonb default null) returns void
language sql security definer set search_path = public, extensions, pg_temp as
$$ insert into auditoria(usuario_id, acao, alvo, detalhe) values (quem, acao, alvo, detalhe::text) $$;

-- aprovado=1 grava direto (administração); aprovado=0 cria pedidos pendentes
create or replace function app.gravar_vinculos(prof bigint, mats bigint[], turs bigint[], aprov int) returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare novas int := 0; n int;
begin
  if exists(select 1 from unnest(mats) x where not exists(select 1 from materias where id = x)) then perform app.erro(400, 'Matéria inexistente.'); end if;
  if exists(select 1 from unnest(turs) x where not exists(select 1 from turmas where id = x)) then perform app.erro(400, 'Turma inexistente.'); end if;
  delete from professor_materias where professor_id = prof and not (materia_id = any(mats));
  delete from professor_turmas where professor_id = prof and not (turma_id = any(turs));
  insert into professor_materias(professor_id, materia_id, aprovado) select prof, x, aprov from (select distinct unnest(mats) x) s
    where not exists(select 1 from professor_materias where professor_id = prof and materia_id = x);
  get diagnostics n = row_count; novas := novas + n;
  insert into professor_turmas(professor_id, turma_id, aprovado) select prof, x, aprov from (select distinct unnest(turs) x) s
    where not exists(select 1 from professor_turmas where professor_id = prof and turma_id = x);
  get diagnostics n = row_count; novas := novas + n;
  if aprov = 1 then
    update professor_materias set aprovado = 1 where professor_id = prof;
    update professor_turmas set aprovado = 1 where professor_id = prof;
    return 0;
  end if;
  return novas;
end $$;

create or replace function app.materias_por_nome(nomes text[]) returns bigint[]
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n text; ids bigint[] := '{}';
begin
  foreach n in array coalesce(nomes, '{}') loop
    n := app.texto(n, 60, 'Nome da matéria');
    insert into materias(nome) values (n) on conflict do nothing;
    ids := ids || (select id from materias where nome = n::citext);
  end loop;
  return ids;
end $$;

-- ==================================================================== cadastro (gatilho do Supabase Auth)
create or replace function app.novo_usuario() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  p text := m->>'perfil';
  nome text; uid bigint; turma bigint; mats bigint[]; turs bigint[]; adm bigint;
begin
  -- contas sem perfil (criadas pelo painel do Supabase) não ganham acesso; "administrador" nunca vem do cadastro
  if p is null or p not in ('aluno', 'professor') then return new; end if;
  nome := app.texto(m->>'nome', 100, 'Nome completo');
  -- um perfil já existente nunca é "assumido" por quem se cadastrar com o mesmo e-mail
  if exists(select 1 from usuarios where email = new.email::citext) then perform app.erro(409, 'Este e-mail já está cadastrado.'); end if;
  insert into usuarios(nome, email, perfil, foto, auth_id) values (nome, new.email, p, app.foto_ok(m->>'foto'), new.id) returning id into uid;
  if p = 'aluno' then
    turma := (m->>'turma_id')::bigint;
    if not exists(select 1 from turmas where id = turma) then perform app.erro(400, 'Turma inexistente.'); end if;
    insert into alunos values (uid, app.texto(m->>'matricula', 30, 'Matrícula', false));
    insert into aluno_turmas values (uid, turma);
    perform app.notificar(uid, 'aviso', 'Bem-vindo ao MindClass!', 'Você foi vinculado à turma ' || (select t.nome::text from turmas t where t.id = turma) || '.');
    perform app.notificar(pt.professor_id, 'turma', 'Novo aluno na turma', nome || ' foi vinculado(a) à turma ' || (select t.nome::text from turmas t where t.id = turma) || '.')
      from professor_turmas pt where pt.turma_id = turma and pt.aprovado = 1;
  else
    if coalesce(m->>'turno', '') not in ('manhã', 'tarde', 'noite', 'integral') then perform app.erro(400, 'Selecione o turno de trabalho.'); end if;
    insert into professores values (uid, m->>'turno');
    mats := array(select jsonb_array_elements_text(coalesce(m->'materias', '[]'::jsonb))::bigint limit 50)
            || app.materias_por_nome(array(select jsonb_array_elements_text(coalesce(m->'novas_materias', '[]'::jsonb)) limit 20));
    turs := array(select jsonb_array_elements_text(coalesce(m->'turmas', '[]'::jsonb))::bigint limit 50);
    perform app.gravar_vinculos(uid, mats, turs, 0);
    perform app.notificar(uid, 'aviso', 'Bem-vindo ao MindClass!', 'Cadastro concluído. As turmas e matérias solicitadas aguardam aprovação da administração.');
    for adm in select id from usuarios where perfil = 'administrador' and ativo = 1 loop
      perform app.notificar(adm, 'vinculo', 'Solicitação de vínculo', nome || ' solicitou turmas/matérias e aguarda aprovação.');
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists mindclass_novo_usuario on auth.users;
create trigger mindclass_novo_usuario after insert on auth.users for each row execute function app.novo_usuario();

-- ==================================================================== opções, perfil
create or replace function public.mc_opcoes() returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'materias', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome), '[]') from materias),
    'turmas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'etapa', etapa, 'num_horarios', num_horarios)
               order by case etapa when 'fundamental' then 0 when 'medio' then 1 else 2 end, id), '[]') from turmas),
    'slots', (select jsonb_agg(jsonb_build_object('n', s, 'inicio', to_char(app.slot_inicio(s), 'HH24:MI'), 'fim', to_char(app.slot_fim(s), 'HH24:MI')) order by s) from generate_series(1, 9) s),
    'turnos', jsonb_build_array('manhã', 'tarde', 'noite', 'integral'),
    'categorias', jsonb_build_array('prova', 'trabalho', 'atividade', 'evento', 'reuniao', 'outro'),
    'media_minima', 6)
$$;

create or replace function app.turmas_de(p bigint, aprov int) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'etapa', t.etapa, 'num_horarios', t.num_horarios)
    order by case t.etapa when 'fundamental' then 0 when 'medio' then 1 else 2 end, t.id), '[]')
  from professor_turmas pt join turmas t on t.id = pt.turma_id where pt.professor_id = p and pt.aprovado = aprov
$$;
create or replace function app.materias_de(p bigint, aprov int) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome) order by m.nome), '[]')
  from professor_materias pm join materias m on m.id = pm.materia_id where pm.professor_id = p and pm.aprovado = aprov
$$;

create or replace function public.mc_eu() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(); j jsonb;
begin
  update usuarios set ultimo_login = now() where id = u.id and (ultimo_login is null or ultimo_login < now() - interval '10 minutes');
  j := jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'perfil', u.perfil, 'foto', u.foto);
  if u.perfil = 'professor' then
    j := j || jsonb_build_object('turno', (select turno from professores where usuario_id = u.id), 'materias', app.materias_de(u.id, 1), 'turmas', app.turmas_de(u.id, 1),
      'pendentes', jsonb_build_object('turmas', app.turmas_de(u.id, 0), 'materias', app.materias_de(u.id, 0)));
  elsif u.perfil = 'aluno' then
    j := j || jsonb_build_object('turmas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'etapa', t.etapa, 'num_horarios', t.num_horarios)), '[]')
      from aluno_turmas at join turmas t on t.id = at.turma_id where at.aluno_id = u.id));
  end if;
  return j;
end $$;

create or replace function public.mc_perfil_atualizar(p_nome text default null, p_foto text default null, p_mudar_foto boolean default false, p_turno text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  if p_turno is not null and u.perfil = 'professor' then
    if p_turno not in ('manhã', 'tarde', 'noite', 'integral') then perform app.erro(400, 'Turno inválido.'); end if;
    update professores set turno = p_turno where usuario_id = u.id;
  end if;
  update usuarios set nome = case when p_nome is null then nome else app.texto(p_nome, 100, 'Nome completo') end,
    foto = case when p_mudar_foto then app.foto_ok(p_foto) else foto end where id = u.id;
  return public.mc_eu();
end $$;

create or replace function public.mc_professor_vinculos(p_materias bigint[], p_novas text[], p_turmas bigint[])
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); mats bigint[]; adm bigint;
begin
  mats := coalesce(p_materias, '{}') || app.materias_por_nome(p_novas);
  if cardinality(mats) = 0 then perform app.erro(400, 'Selecione ao menos uma matéria.'); end if;
  if coalesce(cardinality(p_turmas), 0) = 0 then perform app.erro(400, 'Selecione ao menos uma turma.'); end if;
  if app.gravar_vinculos(u.id, mats, p_turmas, 0) > 0 then
    for adm in select id from usuarios where perfil = 'administrador' and ativo = 1 loop
      perform app.notificar(adm, 'vinculo', 'Solicitação de vínculo', u.nome || ' solicitou turmas/matérias e aguarda aprovação.');
    end loop;
  end if;
  return public.mc_eu();
end $$;

-- ==================================================================== professor / turmas
create or replace function public.mc_professor_resumo() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']);
begin
  return jsonb_build_object(
    'turmas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'alunos', (select count(*) from aluno_turmas a where a.turma_id = t.id))
               order by case t.etapa when 'fundamental' then 0 when 'medio' then 1 else 2 end, t.id), '[]')
               from professor_turmas pt join turmas t on t.id = pt.turma_id where pt.professor_id = u.id and pt.aprovado = 1),
    'aulas', (select count(*) from horarios where professor_id = u.id),
    'atividades_abertas', (select count(*) from atividades where professor_id = u.id and prazo >= app.agora_local()));
end $$;

create or replace function public.mc_turma_alunos(p_turma bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor', 'administrador']);
begin
  if u.perfil = 'professor' and not app.ensina_turma(u.id, p_turma) then perform app.erro(403, 'Você não está vinculado a esta turma.'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'email', x.email, 'foto', x.foto, 'matricula', a.matricula) order by x.nome), '[]')
    from aluno_turmas at join alunos a on a.usuario_id = at.aluno_id join usuarios x on x.id = a.usuario_id where at.turma_id = p_turma and x.ativo = 1);
end $$;

create or replace function public.mc_aluno_professores() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['aluno']);
begin
  return (select coalesce(jsonb_agg(to_jsonb(s) order by s.materia, s.nome), '[]') from (
    select distinct p.id, p.nome, p.email, p.foto, m.nome::text materia from aluno_turmas at
    join professor_turmas pt on pt.turma_id = at.turma_id and pt.aprovado = 1
    join professor_materias pm on pm.professor_id = pt.professor_id and pm.aprovado = 1
    join materias m on m.id = pm.materia_id join usuarios p on p.id = pt.professor_id and p.ativo = 1
    where at.aluno_id = u.id) s);
end $$;

-- ==================================================================== notas e histórico
create or replace function public.mc_notas_turma(p_turma bigint, p_materia bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']);
begin
  if not app.leciona(u.id, p_turma, p_materia) then perform app.erro(403, 'Você não leciona esta matéria nesta turma (ou o vínculo ainda não foi aprovado).'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome,
      'notas', (select coalesce(jsonb_agg(to_jsonb(n)), '[]') from notas n where n.aluno_id = x.id and n.materia_id = p_materia)) order by x.nome), '[]')
    from aluno_turmas at join usuarios x on x.id = at.aluno_id where at.turma_id = p_turma and x.ativo = 1);
end $$;

create or replace function app.turma_da_nota(p bigint, a bigint) returns bigint language sql stable security definer set search_path = public, extensions, pg_temp as
$$ select at.turma_id from aluno_turmas at join professor_turmas pt on pt.turma_id = at.turma_id and pt.professor_id = p and pt.aprovado = 1 where at.aluno_id = a limit 1 $$;

create or replace function public.mc_nota_salvar(p_aluno bigint, p_materia bigint, p_trimestre int, p_valor numeric, p_descricao text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); ant numeric; v numeric; linha notas; mat text;
begin
  if p_trimestre is null or p_trimestre not between 1 and 3 then perform app.erro(400, 'Trimestre deve ser de 1 a 3.'); end if;
  if p_valor is null or p_valor = 'NaN'::numeric or p_valor < 0 or p_valor > 10 then perform app.erro(400, 'A nota deve estar entre 0 e 10.'); end if;
  if not app.pode_nota(u.id, p_aluno, p_materia) then perform app.erro(403, 'Você não pode lançar notas desta matéria para este aluno.'); end if;
  v := round(p_valor, 1);
  perform pg_advisory_xact_lock(hashtext('nota' || p_aluno || '-' || p_materia || '-' || p_trimestre));
  select valor into ant from notas where aluno_id = p_aluno and materia_id = p_materia and trimestre = p_trimestre;
  insert into notas(aluno_id, materia_id, professor_id, trimestre, valor, descricao, atualizado_em)
    values (p_aluno, p_materia, u.id, p_trimestre, v, app.texto(p_descricao, 200, 'Descrição', false), now())
    on conflict (aluno_id, materia_id, trimestre) do update set valor = excluded.valor, descricao = excluded.descricao, professor_id = excluded.professor_id, atualizado_em = excluded.atualizado_em
    returning * into linha;
  mat := (select m.nome::text from materias m where m.id = p_materia);
  if ant is distinct from v then
    insert into notas_historico(aluno_id, materia_id, turma_id, trimestre, ano_letivo, acao, valor_anterior, valor_novo, professor_id, alterado_por)
      values (p_aluno, p_materia, app.turma_da_nota(u.id, p_aluno), p_trimestre, extract(year from app.agora_local()), case when ant is null then 'criada' else 'alterada' end, ant, v, u.id, u.id);
    if ant is null then perform app.notificar(p_aluno, 'nota', 'Nova nota cadastrada', mat || ' — ' || p_trimestre || 'º trimestre: ' || v);
    else perform app.notificar(p_aluno, 'nota', 'Nota atualizada', mat || ' — ' || p_trimestre || 'º trimestre: ' || ant || ' → ' || v); end if;
  end if;
  return to_jsonb(linha);
end $$;

create or replace function public.mc_nota_excluir(p_id bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); n notas;
begin
  select * into n from notas where id = p_id for update;
  if n.id is null then perform app.erro(404, 'Nota não encontrada.'); end if;
  if not app.pode_nota(u.id, n.aluno_id, n.materia_id) then perform app.erro(403, 'Você não pode excluir esta nota.'); end if;
  insert into notas_historico(aluno_id, materia_id, turma_id, trimestre, ano_letivo, acao, valor_anterior, valor_novo, professor_id, alterado_por)
    values (n.aluno_id, n.materia_id, app.turma_da_nota(u.id, n.aluno_id), n.trimestre, extract(year from app.agora_local()), 'excluida', n.valor, null, n.professor_id, u.id);
  delete from notas where id = n.id;
  perform app.notificar(n.aluno_id, 'nota', 'Nota removida', (select m.nome::text from materias m where m.id = n.materia_id) || ' — ' || n.trimestre || 'º trimestre.');
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_aluno_notas() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['aluno']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('materia_id', n.materia_id, 'materia', m.nome, 'trimestre', n.trimestre, 'valor', n.valor) order by m.nome, n.trimestre), '[]')
    from notas n join materias m on m.id = n.materia_id where n.aluno_id = u.id and n.trimestre <= 3);
end $$;

create or replace function public.mc_historico(p_aluno bigint default null, p_turma bigint default null, p_materia bigint default null, p_trimestre int default null,
  p_acao text default null, p_de date default null, p_ate date default null, p_pagina int default 1, p_por int default 30)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(); por int := least(greatest(coalesce(p_por, 30), 1), 100); pag int := greatest(coalesce(p_pagina, 1), 1); r jsonb;
begin
  with f as (
    select h.* from notas_historico h where
      case u.perfil
        when 'aluno' then h.aluno_id = u.id
        when 'professor' then app.aluno_do_professor(u.id, h.aluno_id) and app.ensina_materia(u.id, h.materia_id)
        else true end
      and (u.perfil = 'aluno' or p_aluno is null or h.aluno_id = p_aluno)
      and (u.perfil = 'aluno' or p_turma is null or h.aluno_id in (select aluno_id from aluno_turmas where turma_id = p_turma))
      and (p_materia is null or h.materia_id = p_materia) and (p_trimestre is null or h.trimestre = p_trimestre)
      and (p_acao is null or h.acao = p_acao)
      and (p_de is null or (h.alterado_em at time zone 'America/Sao_Paulo')::date >= p_de)
      and (p_ate is null or (h.alterado_em at time zone 'America/Sao_Paulo')::date <= p_ate)
  )
  select jsonb_build_object('total', (select count(*) from f), 'pagina', pag, 'por_pagina', por, 'itens', coalesce((
    select jsonb_agg(to_jsonb(s) order by s.alterado_em desc, s.id desc) from (
      select f.id, f.aluno_id, a.nome aluno, f.materia_id, m.nome::text materia, f.turma_id, t.nome::text turma, f.trimestre, f.ano_letivo, f.acao,
             f.valor_anterior, f.valor_novo, f.professor_id, p.nome professor, f.alterado_por, x.nome alterado_por_nome, f.alterado_em, f.origem
      from f join usuarios a on a.id = f.aluno_id join materias m on m.id = f.materia_id left join turmas t on t.id = f.turma_id
      left join usuarios p on p.id = f.professor_id join usuarios x on x.id = f.alterado_por
      order by f.alterado_em desc, f.id desc limit por offset (pag - 1) * por) s), '[]')) into r;
  return r;
end $$;

-- ==================================================================== relatórios (dados já filtrados pela permissão; os cálculos são feitos no site)
create or replace function public.mc_relatorio_aluno(p_aluno bigint default null) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(); alvo bigint;
begin
  alvo := case when u.perfil = 'aluno' then u.id else p_aluno end;
  if alvo is null then perform app.erro(400, 'Aluno inválido.'); end if;
  if u.perfil = 'professor' and not app.aluno_do_professor(u.id, alvo) then perform app.erro(403, 'Este aluno não pertence a uma das suas turmas.'); end if;
  if not exists(select 1 from alunos where usuario_id = alvo) then perform app.erro(404, 'Aluno não encontrado.'); end if;
  return jsonb_build_object(
    'aluno', (select jsonb_build_object('id', id, 'nome', nome, 'email', email) from usuarios where id = alvo),
    'turmas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome)), '[]') from aluno_turmas at join turmas t on t.id = at.turma_id where at.aluno_id = alvo),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('materia_id', n.materia_id, 'materia', m.nome, 'trimestre', n.trimestre, 'valor', n.valor) order by m.nome, n.trimestre), '[]')
      from notas n join materias m on m.id = n.materia_id where n.aluno_id = alvo and n.trimestre <= 3 and (u.perfil <> 'professor' or app.ensina_materia(u.id, n.materia_id))),
    'atividades', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'materia_id', a.materia_id, 'materia', m.nome, 'prazo', to_char(a.prazo, 'YYYY-MM-DD"T"HH24:MI'),
        'concluida', case when exists(select 1 from atividades_concluidas c where c.atividade_id = a.id and c.aluno_id = alvo) then 1 else 0 end)), '[]')
      from atividades a join materias m on m.id = a.materia_id where a.turma_id in (select turma_id from aluno_turmas where aluno_id = alvo)
        and (u.perfil <> 'professor' or app.ensina_materia(u.id, a.materia_id))));
end $$;

create or replace function public.mc_relatorio_turma(p_turma bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor', 'administrador']);
begin
  if not exists(select 1 from turmas where id = p_turma) then perform app.erro(404, 'Turma não encontrada.'); end if;
  if u.perfil = 'professor' and not app.ensina_turma(u.id, p_turma) then perform app.erro(403, 'Você não está vinculado a esta turma.'); end if;
  return jsonb_build_object(
    'turma', (select jsonb_build_object('id', id, 'nome', nome, 'etapa', etapa) from turmas where id = p_turma),
    'alunos', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome) order by x.nome), '[]') from aluno_turmas at join usuarios x on x.id = at.aluno_id where at.turma_id = p_turma and x.ativo = 1),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('aluno_id', n.aluno_id, 'materia_id', n.materia_id, 'materia', m.nome, 'trimestre', n.trimestre, 'valor', n.valor)), '[]')
      from notas n join materias m on m.id = n.materia_id where n.trimestre <= 3 and n.aluno_id in (select aluno_id from aluno_turmas where turma_id = p_turma)
        and (u.perfil <> 'professor' or app.ensina_materia(u.id, n.materia_id))),
    'atividades', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'titulo', a.titulo, 'materia_id', a.materia_id, 'materia', m.nome, 'prazo', to_char(a.prazo, 'YYYY-MM-DD"T"HH24:MI'),
        'concluidas', (select count(*) from atividades_concluidas c join aluno_turmas at on at.aluno_id = c.aluno_id and at.turma_id = a.turma_id where c.atividade_id = a.id)) order by a.prazo desc), '[]')
      from atividades a join materias m on m.id = a.materia_id where a.turma_id = p_turma and (u.perfil <> 'professor' or app.ensina_materia(u.id, a.materia_id))));
end $$;

-- ==================================================================== horários
create or replace function app.horario_json(h horarios) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', h.id, 'turma_id', h.turma_id, 'materia_id', h.materia_id, 'professor_id', h.professor_id, 'dia', h.dia, 'slot', h.slot,
    'inicio', to_char(h.inicio, 'HH24:MI'), 'fim', to_char(h.fim, 'HH24:MI'),
    'materia', (select nome from materias where id = h.materia_id), 'turma', (select nome from turmas where id = h.turma_id), 'professor', (select nome from usuarios where id = h.professor_id))
$$;

create or replace function public.mc_horarios(p_turma bigint default null) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  if u.perfil = 'aluno' then
    return (select coalesce(jsonb_agg(app.horario_json(h) order by h.dia, h.slot), '[]') from horarios h where h.turma_id in (select turma_id from aluno_turmas where aluno_id = u.id));
  end if;
  if p_turma is null then
    return (select coalesce(jsonb_agg(app.horario_json(h) order by h.dia, h.slot), '[]') from horarios h where h.professor_id = u.id);
  end if;
  if u.perfil = 'professor' and not app.ensina_turma(u.id, p_turma) then perform app.erro(403, 'Você não está vinculado a esta turma.'); end if;
  return (select coalesce(jsonb_agg(case when u.perfil = 'administrador' or app.ensina_materia(u.id, h.materia_id) then app.horario_json(h)
      else jsonb_build_object('ocupado', true, 'turma_id', h.turma_id, 'dia', h.dia, 'slot', h.slot, 'inicio', to_char(h.inicio, 'HH24:MI'), 'fim', to_char(h.fim, 'HH24:MI')) end
    order by h.dia, h.slot), '[]') from horarios h where h.turma_id = p_turma);
end $$;

create or replace function app.aviso_horario(acao text, h horarios) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare txt text;
begin
  txt := (select nome::text from materias where id = h.materia_id) || ' — ' || (array['segunda','terça','quarta','quinta','sexta'])[h.dia] || '-feira, '
    || to_char(h.inicio, 'HH24:MI') || ' às ' || to_char(h.fim, 'HH24:MI');
  perform app.avisar_turma(h.turma_id, 'horario', 'Horário de aula ' || acao, txt);
  perform app.notificar(h.professor_id, 'horario', 'Grade de horários: aula ' || acao, (select nome::text from turmas where id = h.turma_id) || ' · ' || txt);
end $$;

create or replace function public.mc_horario_salvar(p_id bigint, p_turma bigint, p_materia bigint, p_dia int, p_slot int)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); atual horarios; novo horarios; t turmas; c horarios;
begin
  if p_id is not null then
    select * into atual from horarios where id = p_id;
    if atual.id is null or atual.professor_id <> u.id then perform app.erro(403, 'Você só pode editar seus próprios horários.'); end if;
  end if;
  if p_dia is null or p_dia not between 1 and 5 then perform app.erro(400, 'O dia deve ser de segunda a sexta.'); end if;
  select * into t from turmas where id = p_turma;
  if t.id is null then perform app.erro(400, 'Turma inexistente.'); end if;
  if p_slot is null or p_slot < 1 or p_slot > least(t.num_horarios, 9) then perform app.erro(400, 'A turma ' || t.nome || ' tem apenas ' || t.num_horarios || ' horários por dia.'); end if;
  if not app.leciona(u.id, p_turma, p_materia) then perform app.erro(403, 'Você não leciona esta matéria nesta turma (ou o vínculo ainda não foi aprovado).'); end if;
  perform pg_advisory_xact_lock(hashtext('grade'));
  select * into c from horarios h where h.dia = p_dia and h.id <> coalesce(p_id, 0) and h.inicio < app.slot_fim(p_slot) and h.fim > app.slot_inicio(p_slot)
    and (h.professor_id = u.id or h.turma_id = p_turma) limit 1;
  if c.id is not null then
    perform app.erro(409, case when c.professor_id = u.id then 'Você' else 'A turma' end || ' já tem aula das ' || to_char(c.inicio, 'HH24:MI') || ' às ' || to_char(c.fim, 'HH24:MI') || ' neste dia.');
  end if;
  if p_id is null then
    insert into horarios(turma_id, materia_id, professor_id, dia, slot, inicio, fim) values (p_turma, p_materia, u.id, p_dia, p_slot, app.slot_inicio(p_slot), app.slot_fim(p_slot)) returning * into novo;
    perform app.aviso_horario('adicionada', novo);
  else
    update horarios set turma_id = p_turma, materia_id = p_materia, dia = p_dia, slot = p_slot, inicio = app.slot_inicio(p_slot), fim = app.slot_fim(p_slot) where id = p_id returning * into novo;
    if atual.turma_id <> p_turma then perform app.aviso_horario('cancelada', atual); perform app.aviso_horario('adicionada', novo);
    else perform app.aviso_horario('alterada', novo); end if;
  end if;
  return app.horario_json(novo);
end $$;

create or replace function public.mc_horario_excluir(p_id bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); h horarios;
begin
  select * into h from horarios where id = p_id;
  if h.id is null or h.professor_id <> u.id then perform app.erro(403, 'Você só pode excluir seus próprios horários.'); end if;
  delete from horarios where id = h.id;
  perform app.aviso_horario('cancelada', h);
  return '{"ok":true}'::jsonb;
end $$;

-- ==================================================================== atividades e avisos
create or replace function app.atividade_json(a atividades, aluno bigint default null) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', a.id, 'turma_id', a.turma_id, 'materia_id', a.materia_id, 'professor_id', a.professor_id, 'titulo', a.titulo, 'descricao', a.descricao,
    'prazo', to_char(a.prazo, 'YYYY-MM-DD"T"HH24:MI'), 'materia', (select nome from materias where id = a.materia_id), 'turma', (select nome from turmas where id = a.turma_id),
    'professor', (select nome from usuarios where id = a.professor_id))
    || case when aluno is null then '{}'::jsonb else jsonb_build_object('concluida', case when exists(select 1 from atividades_concluidas c where c.atividade_id = a.id and c.aluno_id = aluno) then 1 else 0 end) end
$$;

create or replace function public.mc_atividades() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  if u.perfil = 'professor' then
    return (select coalesce(jsonb_agg(app.atividade_json(a) order by a.prazo desc), '[]') from atividades a where a.professor_id = u.id);
  elsif u.perfil = 'aluno' then
    return (select coalesce(jsonb_agg(app.atividade_json(a, u.id) order by a.prazo), '[]') from atividades a where a.turma_id in (select turma_id from aluno_turmas where aluno_id = u.id));
  end if;
  return (select coalesce(jsonb_agg(app.atividade_json(s::atividades) order by s.prazo desc), '[]') from (select * from atividades order by prazo desc limit 500) s);
end $$;

create or replace function public.mc_atividade_salvar(p_id bigint, p_turma bigint, p_materia bigint, p_titulo text, p_descricao text, p_prazo timestamp)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); atual atividades; a atividades;
begin
  if p_id is not null then
    select * into atual from atividades where id = p_id;
    if atual.id is null or atual.professor_id <> u.id then perform app.erro(403, 'Você só pode editar suas próprias atividades.'); end if;
  end if;
  if p_turma is null or p_materia is null or not app.leciona(u.id, p_turma, p_materia) then perform app.erro(403, 'Você não leciona esta matéria nesta turma (ou o vínculo ainda não foi aprovado).'); end if;
  if p_prazo is null or extract(year from p_prazo) not between 2000 and 2100 then perform app.erro(400, 'Prazo inválido.'); end if;
  if p_id is null then
    insert into atividades(turma_id, materia_id, professor_id, titulo, descricao, prazo)
      values (p_turma, p_materia, u.id, app.texto(p_titulo, 120, 'Título'), app.texto(p_descricao, 1000, 'Descrição', false), p_prazo) returning * into a;
  else
    update atividades set turma_id = p_turma, materia_id = p_materia, titulo = app.texto(p_titulo, 120, 'Título'), descricao = app.texto(p_descricao, 1000, 'Descrição', false), prazo = p_prazo
      where id = p_id returning * into a;
    delete from notificacoes where chave like 'lembrete:' || p_id || ':%' and lida = 0;
  end if;
  perform app.avisar_turma(a.turma_id, 'atividade', case when p_id is null then 'Nova atividade publicada' else 'Atividade atualizada' end,
    (select nome::text from materias where id = a.materia_id) || ': ' || a.titulo || ' (prazo ' || to_char(a.prazo, 'DD/MM HH24:MI') || ')');
  return app.atividade_json(a);
end $$;

create or replace function public.mc_atividade_excluir(p_id bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); a atividades;
begin
  select * into a from atividades where id = p_id;
  if a.id is null or a.professor_id <> u.id then perform app.erro(403, 'Você só pode excluir suas próprias atividades.'); end if;
  delete from atividades where id = a.id;
  perform app.avisar_turma(a.turma_id, 'atividade', 'Atividade cancelada', (select nome::text from materias where id = a.materia_id) || ': ' || a.titulo);
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_atividade_concluir(p_id bigint, p_concluida boolean) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['aluno']);
begin
  if not exists(select 1 from atividades a join aluno_turmas at on at.turma_id = a.turma_id and at.aluno_id = u.id where a.id = p_id) then perform app.erro(403, 'Atividade não disponível para você.'); end if;
  if coalesce(p_concluida, false) then insert into atividades_concluidas values (u.id, p_id) on conflict do nothing;
  else delete from atividades_concluidas where aluno_id = u.id and atividade_id = p_id; end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_aviso_enviar(p_turma bigint, p_titulo text, p_mensagem text) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['professor']); t text; m text;
begin
  if p_turma is null or not app.ensina_turma(u.id, p_turma) then perform app.erro(403, 'Você não está vinculado a esta turma.'); end if;
  t := app.texto(p_titulo, 100, 'Título'); m := app.texto(p_mensagem, 600, 'Mensagem');
  perform app.avisar_turma(p_turma, 'aviso', 'Aviso: ' || t, u.nome || ' (' || (select nome::text from turmas where id = p_turma) || '): ' || m);
  return jsonb_build_object('enviados', (select count(*) from aluno_turmas where turma_id = p_turma));
end $$;

-- ==================================================================== calendário
create or replace function app.evento_json(c calendario, u usuarios) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('tipo', 'evento', 'id', c.id, 'usuario_id', c.usuario_id, 'titulo', c.titulo, 'descricao', c.descricao, 'data', c.data,
    'inicio', to_char(c.inicio, 'HH24:MI'), 'fim', to_char(c.fim, 'HH24:MI'), 'categoria', c.categoria, 'turma_id', c.turma_id, 'materia_id', c.materia_id,
    'turma', (select nome from turmas where id = c.turma_id), 'materia', (select nome from materias where id = c.materia_id), 'autor', (select nome from usuarios where id = c.usuario_id),
    'editavel', c.usuario_id = u.id or (u.perfil = 'administrador' and c.turma_id is not null))
$$;

create or replace function public.mc_eventos(p_de date default null, p_ate date default null, p_turma bigint default null, p_materia bigint default null, p_categoria text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  return (select coalesce(jsonb_agg(app.evento_json(c, u) order by c.data, c.inicio nulls first), '[]') from calendario c where
    case u.perfil
      when 'aluno' then c.usuario_id = u.id or c.turma_id in (select turma_id from aluno_turmas where aluno_id = u.id)
      when 'professor' then c.usuario_id = u.id or c.turma_id in (select turma_id from professor_turmas where professor_id = u.id and aprovado = 1)
      else c.usuario_id = u.id or c.turma_id is not null end
    and (p_de is null or c.data >= p_de) and (p_ate is null or c.data <= p_ate) and (p_turma is null or c.turma_id = p_turma)
    and (p_materia is null or c.materia_id = p_materia) and (p_categoria is null or c.categoria = p_categoria));
end $$;

create or replace function public.mc_evento_salvar(p_id bigint, p_titulo text, p_descricao text, p_data date, p_inicio time, p_fim time, p_categoria text, p_turma bigint, p_materia bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(); atual calendario; e calendario; c calendario; cat text := coalesce(nullif(p_categoria, ''), 'evento'); tit text; fim_novo time;
begin
  if p_id is not null then
    select * into atual from calendario where id = p_id;
    if atual.id is null or not (atual.usuario_id = u.id or (u.perfil = 'administrador' and atual.turma_id is not null)) then perform app.erro(403, 'Você não tem permissão para alterar este evento.'); end if;
  end if;
  if p_data is null or extract(year from p_data) not between 2000 and 2100 then perform app.erro(400, 'Data inválida.'); end if;
  if p_fim is not null and p_inicio is null then perform app.erro(400, 'Informe o horário de início.'); end if;
  if p_inicio is not null and p_fim is not null and p_inicio >= p_fim then perform app.erro(400, 'O término deve ser depois do início.'); end if;
  if cat not in ('prova', 'trabalho', 'atividade', 'evento', 'reuniao', 'outro') then perform app.erro(400, 'Categoria inválida.'); end if;
  if p_materia is not null and not exists(select 1 from materias where id = p_materia) then perform app.erro(400, 'Matéria inexistente.'); end if;
  if p_turma is not null then
    if u.perfil = 'aluno' then perform app.erro(403, 'Alunos só podem criar eventos pessoais.'); end if;
    if not exists(select 1 from turmas where id = p_turma) then perform app.erro(400, 'Turma inexistente.'); end if;
    if u.perfil = 'professor' and not app.ensina_turma(u.id, p_turma) then perform app.erro(403, 'Você não está vinculado a esta turma.'); end if;
    if u.perfil = 'professor' and p_materia is not null and not app.leciona(u.id, p_turma, p_materia) then perform app.erro(403, 'Você não leciona esta matéria nesta turma.'); end if;
  elsif u.perfil = 'professor' and p_materia is not null and not app.ensina_materia(u.id, p_materia) then perform app.erro(403, 'Você não leciona esta matéria.'); end if;
  tit := app.texto(p_titulo, 80, 'Título');
  perform pg_advisory_xact_lock(hashtext('agenda' || p_data::text));
  if exists(select 1 from calendario o where o.data = p_data and o.id <> coalesce(p_id, 0)
      and (case when p_turma is not null then o.turma_id = p_turma else o.turma_id is null and o.usuario_id = u.id end)
      and lower(o.titulo) = lower(tit) and o.inicio is not distinct from p_inicio and o.materia_id is not distinct from p_materia) then
    perform app.erro(409, 'Já existe um evento igual nesta data.');
  end if;
  if p_inicio is not null then
    fim_novo := coalesce(p_fim, case when p_inicio >= '23:00' then '23:59'::time else p_inicio + interval '1 hour' end);
    select * into c from calendario o where o.data = p_data and o.id <> coalesce(p_id, 0) and o.inicio is not null
      and (case when p_turma is not null then o.turma_id = p_turma else o.turma_id is null and o.usuario_id = u.id end)
      and o.inicio < fim_novo and coalesce(o.fim, case when o.inicio >= '23:00' then '23:59'::time else o.inicio + interval '1 hour' end) > p_inicio limit 1;
    if c.id is not null then perform app.erro(409, 'Conflito de horário com "' || c.titulo || '" (' || to_char(c.inicio, 'HH24:MI') || coalesce('–' || to_char(c.fim, 'HH24:MI'), '') || ').'); end if;
  end if;
  if p_id is null then
    insert into calendario(usuario_id, turma_id, materia_id, titulo, descricao, categoria, data, inicio, fim)
      values (u.id, p_turma, p_materia, tit, app.texto(p_descricao, 300, 'Descrição', false), cat, p_data, p_inicio, p_fim) returning * into e;
  else
    update calendario set turma_id = p_turma, materia_id = p_materia, titulo = tit, descricao = app.texto(p_descricao, 300, 'Descrição', false), categoria = cat, data = p_data, inicio = p_inicio, fim = p_fim
      where id = p_id returning * into e;
    delete from notificacoes where chave like 'ev:' || p_id || ':%' and lida = 0;
  end if;
  if e.turma_id is not null then
    perform app.avisar_turma(e.turma_id, 'evento', case when e.categoria = 'prova' then 'Prova ' else 'Evento ' end || case when p_id is null then 'adicionado' else 'alterado' end,
      e.titulo || ' — ' || to_char(e.data, 'DD/MM/YYYY') || coalesce(' às ' || to_char(e.inicio, 'HH24:MI'), ''));
  end if;
  return app.evento_json(e, u);
end $$;

create or replace function public.mc_evento_excluir(p_id bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(); e calendario;
begin
  select * into e from calendario where id = p_id;
  if e.id is null or not (e.usuario_id = u.id or (u.perfil = 'administrador' and e.turma_id is not null)) then perform app.erro(403, 'Você não tem permissão para alterar este evento.'); end if;
  delete from calendario where id = e.id;
  if e.turma_id is not null then
    perform app.avisar_turma(e.turma_id, 'evento', case when e.categoria = 'prova' then 'Prova cancelado' else 'Evento cancelado' end, e.titulo || ' — ' || to_char(e.data, 'DD/MM/YYYY'));
  end if;
  return '{"ok":true}'::jsonb;
end $$;

-- ==================================================================== notificações (os lembretes de 48 h são gerados quando a pessoa consulta)
create or replace function app.lembretes(u usuarios) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_ini timestamp := app.agora_local(); v_fim timestamp := app.agora_local() + interval '48 hours';
begin
  if u.perfil in ('aluno', 'professor') then
    perform app.notificar(u.id, 'lembrete', 'Atividade perto do prazo', m.nome::text || ': ' || a.titulo || ' vence em ' || to_char(a.prazo, 'DD/MM HH24:MI'), 'lembrete:' || a.id || ':' || a.prazo)
      from atividades a join materias m on m.id = a.materia_id
      where a.prazo >= v_ini and a.prazo <= v_fim and (
        (u.perfil = 'professor' and a.professor_id = u.id) or
        (u.perfil = 'aluno' and a.turma_id in (select turma_id from aluno_turmas where aluno_id = u.id)
          and not exists(select 1 from atividades_concluidas c where c.atividade_id = a.id and c.aluno_id = u.id)));
  end if;
  perform app.notificar(u.id, 'lembrete', case e.categoria when 'prova' then 'Prova próxima' when 'trabalho' then 'Trabalho próximo' else 'Compromisso próximo' end,
      e.titulo || ' — ' || to_char(e.data, 'DD/MM/YYYY') || coalesce(' às ' || to_char(e.inicio, 'HH24:MI'), ''), 'ev:' || e.id || ':' || e.data || ':' || coalesce(e.inicio::text, ''))
    from calendario e where e.data >= v_ini::date and e.data <= v_fim::date and (e.inicio is null or (e.data + e.inicio >= v_ini and e.data + e.inicio <= v_fim))
      and (e.usuario_id = u.id or (u.perfil = 'aluno' and e.turma_id in (select turma_id from aluno_turmas where aluno_id = u.id)));
end $$;

create or replace function public.mc_notificacoes() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  perform app.lembretes(u);
  delete from notificacoes where usuario_id = u.id and lida = 1 and criado_em < now() - interval '90 days';
  return jsonb_build_object(
    'itens', (select coalesce(jsonb_agg(to_jsonb(s) order by s.criado_em desc, s.id desc), '[]') from (select * from notificacoes where usuario_id = u.id order by criado_em desc, id desc limit 200) s),
    'nao_lidas', (select count(*) from notificacoes where usuario_id = u.id and lida = 0));
end $$;

create or replace function public.mc_notificacoes_ler_todas() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin update notificacoes set lida = 1 where usuario_id = u.id and lida = 0; return '{"ok":true}'::jsonb; end $$;

create or replace function public.mc_notificacao_marcar(p_id bigint, p_lida boolean) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  update notificacoes set lida = case when coalesce(p_lida, false) then 1 else 0 end where id = p_id and usuario_id = u.id;
  if not found then perform app.erro(404, 'Notificação não encontrada.'); end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_notificacao_excluir(p_id bigint) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu();
begin
  delete from notificacoes where id = p_id and usuario_id = u.id;
  if not found then perform app.erro(404, 'Notificação não encontrada.'); end if;
  return '{"ok":true}'::jsonb;
end $$;

-- ==================================================================== administração
create or replace function public.mc_admin_resumo() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']);
begin
  return jsonb_build_object(
    'usuarios', (select jsonb_build_object('professores', count(*) filter (where perfil = 'professor'), 'alunos', count(*) filter (where perfil = 'aluno'),
        'administradores', count(*) filter (where perfil = 'administrador'), 'inativos', count(*) filter (where ativo = 0)) from usuarios),
    'turmas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'etapa', t.etapa, 'num_horarios', t.num_horarios,
        'alunos', (select count(*) from aluno_turmas a where a.turma_id = t.id), 'professores', (select count(*) from professor_turmas p where p.turma_id = t.id and p.aprovado = 1))
        order by case t.etapa when 'fundamental' then 0 when 'medio' then 1 else 2 end, t.id), '[]') from turmas t),
    'pendencias', (select count(*) from (select professor_id from professor_turmas where aprovado = 0 union select professor_id from professor_materias where aprovado = 0) p),
    'notas', (select count(*) from notas), 'alteracoes_notas', (select count(*) from notas_historico),
    'atividades_abertas', (select count(*) from atividades where prazo >= app.agora_local()));
end $$;

create or replace function app.usuario_admin(x usuarios) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', x.id, 'nome', x.nome, 'email', x.email, 'perfil', x.perfil, 'ativo', x.ativo, 'criado_em', x.criado_em, 'ultimo_login', x.ultimo_login,
    'turma_aluno', (select string_agg(t.nome::text, ', ') from aluno_turmas at join turmas t on t.id = at.turma_id where at.aluno_id = x.id),
    'turmas_prof', (select string_agg(t.nome::text, ', ') from professor_turmas pt join turmas t on t.id = pt.turma_id where pt.professor_id = x.id and pt.aprovado = 1),
    'materias_prof', (select string_agg(m.nome::text, ', ') from professor_materias pm join materias m on m.id = pm.materia_id where pm.professor_id = x.id and pm.aprovado = 1),
    'pendentes', (select count(*) from professor_turmas where professor_id = x.id and aprovado = 0) + (select count(*) from professor_materias where professor_id = x.id and aprovado = 0),
    'turno', (select turno from professores where usuario_id = x.id), 'turma_id', (select turma_id from aluno_turmas where aluno_id = x.id limit 1),
    'matricula', (select matricula from alunos where usuario_id = x.id))
$$;

create or replace function public.mc_admin_usuarios(p_q text default null, p_perfil text default null, p_ativo int default null, p_pagina int default 1, p_por int default 20)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']); por int := least(greatest(coalesce(p_por, 20), 1), 100); pag int := greatest(coalesce(p_pagina, 1), 1);
  padrao text := case when coalesce(p_q, '') = '' then null else '%' || regexp_replace(left(p_q, 60), '([\\%_])', '\\\1', 'g') || '%' end; r jsonb;
begin
  with f as (select * from usuarios x where (p_perfil is null or x.perfil = p_perfil) and (p_ativo is null or x.ativo = p_ativo)
      and (padrao is null or x.nome ilike padrao or x.email::text ilike padrao))
  select jsonb_build_object('total', (select count(*) from f), 'pagina', pag, 'por_pagina', por,
    'itens', (select coalesce(jsonb_agg(app.usuario_admin(s::usuarios) order by lower(s.nome)), '[]') from (select * from f order by lower(nome) limit por offset (pag - 1) * por) s)) into r;
  return r;
end $$;

create or replace function public.mc_admin_usuario_editar(p_id bigint, p_nome text default null, p_ativo boolean default null, p_turma bigint default null, p_turno text default null, p_matricula text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']); x usuarios;
begin
  select * into x from usuarios where id = p_id;
  if x.id is null then perform app.erro(404, 'Usuário não encontrado.'); end if;
  if p_ativo is false then
    if x.id = u.id then perform app.erro(400, 'Você não pode desativar a própria conta.'); end if;
    if x.perfil = 'administrador' and x.ativo = 1 and (select count(*) from usuarios where perfil = 'administrador' and ativo = 1) <= 1 then
      perform app.erro(400, 'Não é possível desativar o único administrador ativo.'); end if;
  end if;
  update usuarios set nome = case when p_nome is null then nome else app.texto(p_nome, 100, 'Nome completo') end,
    ativo = case when p_ativo is null then ativo when p_ativo then 1 else 0 end where id = x.id;
  if x.perfil = 'professor' and p_turno is not null then
    if p_turno not in ('manhã', 'tarde', 'noite', 'integral') then perform app.erro(400, 'Turno inválido.'); end if;
    update professores set turno = p_turno where usuario_id = x.id;
  end if;
  if x.perfil = 'aluno' then
    if p_matricula is not null then update alunos set matricula = app.texto(p_matricula, 30, 'Matrícula', false) where usuario_id = x.id; end if;
    if p_turma is not null and not exists(select 1 from aluno_turmas where aluno_id = x.id and turma_id = p_turma) then
      if not exists(select 1 from turmas where id = p_turma) then perform app.erro(400, 'Turma inexistente.'); end if;
      delete from aluno_turmas where aluno_id = x.id;
      insert into aluno_turmas values (x.id, p_turma);
      perform app.notificar(x.id, 'aviso', 'Turma alterada', 'Você agora está na turma ' || (select nome::text from turmas where id = p_turma) || '.');
    end if;
  end if;
  perform app.auditar(u.id, 'usuario_editado', x.email::text, jsonb_build_object('ativo', p_ativo, 'turma', p_turma));
  return (select app.usuario_admin(s) from usuarios s where s.id = x.id);
end $$;

-- transforma uma conta já cadastrada em administrador (usado ao criar um administrador pelo painel)
create or replace function public.mc_admin_tornar_admin(p_email text) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']); x usuarios;
begin
  select * into x from usuarios where email = p_email::citext;
  if x.id is null then perform app.erro(404, 'Conta não encontrada.'); end if;
  if x.criado_em < now() - interval '5 minutes' then perform app.erro(400, 'Só é possível promover uma conta recém-criada pelo painel.'); end if;
  delete from alunos where usuario_id = x.id and not exists(select 1 from notas_historico where aluno_id = x.id);
  update usuarios set perfil = 'administrador' where id = x.id;
  perform app.auditar(u.id, 'usuario_criado', x.email::text, '{"perfil":"administrador"}'::jsonb);
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_admin_registrar(p_acao text, p_alvo text) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']);
begin
  if p_acao not in ('usuario_criado', 'senha_redefinida') then perform app.erro(400, 'Ação inválida.'); end if;
  perform app.auditar(u.id, p_acao, left(p_alvo, 120));
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_admin_pendencias() returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email, 'turno', (select turno from professores where usuario_id = p.id),
      'turmas_pendentes', app.turmas_de(p.id, 0), 'materias_pendentes', app.materias_de(p.id, 0), 'turmas_aprovadas', app.turmas_de(p.id, 1), 'materias_aprovadas', app.materias_de(p.id, 1)) order by p.nome), '[]')
    from usuarios p where p.id in (select professor_id from professor_turmas where aprovado = 0 union select professor_id from professor_materias where aprovado = 0));
end $$;

create or replace function public.mc_admin_decidir(p_professor bigint, p_aprovar boolean, p_tipo text default null, p_ref bigint default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']); total int := 0; n int;
begin
  if not exists(select 1 from usuarios where id = p_professor and perfil = 'professor') then perform app.erro(404, 'Professor não encontrado.'); end if;
  if p_tipo is not null and p_tipo not in ('turma', 'materia') then perform app.erro(400, 'Tipo inválido.'); end if;
  if p_tipo is null or p_tipo = 'turma' then
    if p_aprovar then update professor_turmas set aprovado = 1 where professor_id = p_professor and aprovado = 0 and (p_ref is null or turma_id = p_ref);
    else delete from professor_turmas where professor_id = p_professor and aprovado = 0 and (p_ref is null or turma_id = p_ref); end if;
    get diagnostics n = row_count; total := total + n;
  end if;
  if p_tipo is null or p_tipo = 'materia' then
    if p_aprovar then update professor_materias set aprovado = 1 where professor_id = p_professor and aprovado = 0 and (p_ref is null or materia_id = p_ref);
    else delete from professor_materias where professor_id = p_professor and aprovado = 0 and (p_ref is null or materia_id = p_ref); end if;
    get diagnostics n = row_count; total := total + n;
  end if;
  perform app.auditar(u.id, case when p_aprovar then 'vinculo_aprovado' else 'vinculo_rejeitado' end, p_professor::text, jsonb_build_object('itens', total));
  if total > 0 then
    perform app.notificar(p_professor, 'vinculo', case when p_aprovar then 'Vínculos aprovados' else 'Vínculos não aprovados' end,
      case when p_aprovar then 'A administração aprovou suas turmas/matérias. Já pode usar notas, horários e atividades.' else 'A administração não aprovou parte das turmas/matérias solicitadas.' end);
  end if;
  return jsonb_build_object('alterados', total);
end $$;

create or replace function public.mc_admin_vinculos(p_professor bigint, p_materias bigint[], p_turmas bigint[]) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']);
begin
  if not exists(select 1 from usuarios where id = p_professor and perfil = 'professor') then perform app.erro(404, 'Professor não encontrado.'); end if;
  perform app.gravar_vinculos(p_professor, coalesce(p_materias, '{}'), coalesce(p_turmas, '{}'), 1);
  perform app.auditar(u.id, 'vinculos_definidos', p_professor::text, jsonb_build_object('materias', p_materias, 'turmas', p_turmas));
  perform app.notificar(p_professor, 'vinculo', 'Vínculos atualizados', 'A administração atualizou suas turmas e matérias.');
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.mc_admin_materia(p_nome text) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']); n text := app.texto(p_nome, 60, 'Nome da matéria'); novo bigint;
begin
  if exists(select 1 from materias where nome = n::citext) then perform app.erro(409, 'Matéria já cadastrada.'); end if;
  insert into materias(nome) values (n) returning id into novo;
  perform app.auditar(u.id, 'materia_criada', n);
  return jsonb_build_object('id', novo, 'nome', n);
end $$;

create or replace function public.mc_admin_auditoria(p_pagina int default 1, p_por int default 40) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u usuarios := app.eu(array['administrador']); por int := least(greatest(coalesce(p_por, 40), 1), 200); pag int := greatest(coalesce(p_pagina, 1), 1);
begin
  return jsonb_build_object('total', (select count(*) from auditoria), 'pagina', pag, 'por_pagina', por, 'itens', (select coalesce(jsonb_agg(to_jsonb(s) order by s.em desc, s.id desc), '[]') from (
    select a.id, a.acao, a.alvo, a.detalhe, a.ip, a.em, x.nome usuario from auditoria a left join usuarios x on x.id = a.usuario_id order by a.em desc, a.id desc limit por offset (pag - 1) * por) s));
end $$;

-- PRIMEIRO administrador: cadastre-se no site como aluno e depois rode no SQL Editor:
--   select public.promover_admin('seu-email@escola.com');
create or replace function public.promover_admin(p_email text) returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare x usuarios;
begin
  select * into x from usuarios where email = p_email::citext and auth_id is not null;
  if x.id is null then return 'Conta não encontrada. Cadastre-se no site primeiro.'; end if;
  delete from alunos where usuario_id = x.id and not exists(select 1 from notas_historico where aluno_id = x.id);
  update usuarios set perfil = 'administrador', ativo = 1 where id = x.id;
  perform app.auditar(x.id, 'usuario_editado', x.email::text, '{"perfil":"administrador","origem":"sql"}'::jsonb);
  return 'Pronto: ' || x.email || ' agora é administrador. Saia e entre novamente pela aba Admin.';
end $$;

-- ==================================================================== permissões de execução
-- Nada é executável por padrão; só o que está listado abaixo.
revoke execute on all functions in schema app from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'mc\_%' or p.proname = 'promover_admin') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    if f.proname <> 'promover_admin' then execute format('grant execute on function %s to authenticated', f.assinatura); end if;
  end loop;
end $$;
grant execute on function public.mc_opcoes() to anon;

commit;
notify pgrst, 'reload schema';
