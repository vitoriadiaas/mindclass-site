# MindClass

Plataforma de organização escolar para professores, alunos e administração: turmas, grade de horários, notas por trimestre com histórico, atividades, calendário, relatórios e notificações.

Site estático (GitHub Pages) + Supabase (login e banco de dados). Sem servidor próprio.

## Colocar no ar

### 1. Banco de dados (Supabase)
No **SQL Editor**, rode, nesta ordem:
1. `supabase/schema.sql` (tabelas; pule se já foram criadas);
2. `supabase/pages.sql` (login, permissões e regras).

### 2. Login (painel do Supabase)
- **Authentication > URL Configuration**: coloque o endereço do site (GitHub Pages) em *Site URL* e em *Redirect URLs*.
- **Authentication > Sign In / Providers > Email**: para uma escola sem envio de e-mails, desligue *Confirm email*. Se deixar ligado, configure um SMTP próprio (o envio padrão do Supabase é muito limitado).
- **Authentication > Policies** (senha): mínimo de 8 caracteres.

### 3. GitHub Pages
**Settings > Pages > Source: Deploy from a branch > main / (root)**.

### 4. Primeiro administrador
Cadastre-se no site (como aluno) e rode no SQL Editor:

```sql
select public.promover_admin('seu-email@escola.com');
```

Depois entre pela aba **Admin**.

## Segurança
- As tabelas ficam fechadas (RLS sem políticas e sem permissão para `anon`/`authenticated`).
- O site só chama funções do banco (`mc_*`), que conferem quem está logado e o que pode fazer.
- Professores só acessam turmas e matérias aprovadas pela administração.
- Histórico de notas e auditoria são imutáveis.
- A chave em `config.js` é a **publicável**. Nunca publique a senha do banco nem chaves `secret`/`service_role`.
- A sessão fica no armazenamento do navegador e expira após 12 horas sem uso. Em computadores compartilhados, use "Sair".

## Diferenças em relação à versão com servidor
- As notificações chegam por consulta a cada 30 segundos; lembretes são gerados quando a pessoa está usando o site.
- A redefinição de senha é feita por e-mail.
- O administrador não altera o e-mail de uma conta.
- Os limites contra tentativas repetidas de login são os do Supabase.
