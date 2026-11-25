// Cliente mínimo do Supabase (Auth + funções do banco), sem bibliotecas externas.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const CHAVE = 'mindclass.sessao';
const OCIOSO_MS = 12 * 36e5;                 // sai sozinho após 12 h sem uso
const site = () => location.origin + location.pathname;

export class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const MENSAGENS = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  user_already_exists: 'Este e-mail já está cadastrado.',
  email_exists: 'Este e-mail já está cadastrado.',
  email_not_confirmed: 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
  weak_password: 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  signup_disabled: 'Novos cadastros estão desativados.',
  email_address_invalid: 'E-mail inválido ou não aceito.',
  over_email_send_rate_limit: 'Limite de e-mails atingido. Aguarde alguns minutos.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos.',
};

async function requisicao(caminho, { metodo = 'POST', corpo, token } = {}) {
  let r;
  try {
    r = await fetch(SUPABASE_URL + caminho, {
      method: metodo,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
    });
  } catch { throw new Erro(0, 'Sem conexão com o servidor. Verifique sua internet.'); }
  let j = null;
  try { j = await r.json(); } catch { /* resposta sem corpo */ }
  if (r.ok) return j;
  const codigo = j?.error_code || j?.code;
  let msg = MENSAGENS[codigo];
  if (!msg && codigo === 'PGRST202') msg = 'O banco de dados ainda não foi preparado (rode supabase/pages.sql).';
  if (!msg && r.status === 429) msg = 'Muitas tentativas. Aguarde alguns minutos.';
  const bruto = j?.msg || j?.message || j?.error_description || '';
  if (!msg && /database error saving new user/i.test(bruto)) msg = 'Não foi possível concluir o cadastro. Confira os dados (o e-mail pode já estar em uso).';
  if (!msg && ['22007', '22008', '22P02'].includes(codigo)) msg = 'Valor inválido. Confira os campos.';
  if (!msg && /^PT\d{3}$/.test(codigo || '')) msg = bruto;
  throw new Erro(r.status, msg || bruto || 'Erro inesperado. Tente novamente.');
}

/* ---------- sessão ---------- */
const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE)); } catch { return null; } };
let memoria = ler();
function guardar(s) {
  memoria = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expira: Date.now() + (s.expires_in ?? 3600) * 1000, uso: Date.now() } : null;
  try { if (memoria) localStorage.setItem(CHAVE, JSON.stringify(memoria)); else localStorage.removeItem(CHAVE); } catch { /* navegação privada */ }
}
let renovando = null;
async function token() {
  memoria = ler() ?? memoria;
  if (!memoria) return null;
  if (Date.now() - memoria.uso > OCIOSO_MS) { await sair('local'); return null; }
  if (Date.now() > memoria.expira - 60_000) {
    renovando ??= requisicao('/auth/v1/token?grant_type=refresh_token', { corpo: { refresh_token: memoria.refresh_token } })
      .then(guardar).catch((e) => { if (e.status >= 400 && e.status < 500) guardar(null); throw e; }).finally(() => { renovando = null; });
    try { await renovando; } catch { if (!memoria) return null; }
  }
  return memoria?.access_token ?? null;
}
// marca atividade real da pessoa (as consultas automáticas não contam)
export function marcarUso() { if (memoria) { memoria.uso = Date.now(); try { localStorage.setItem(CHAVE, JSON.stringify(memoria)); } catch { /* ok */ } } }
export const temSessao = () => !!(ler() ?? memoria);

export async function rpc(funcao, args = {}) {
  const t = await token();
  if (!t && funcao !== 'mc_opcoes') throw new Erro(401, 'Faça login para continuar.');
  return requisicao(`/rest/v1/rpc/${funcao}`, { corpo: args, token: t });
}

/* ---------- autenticação ---------- */
export async function entrar(email, senha) { guardar(await requisicao('/auth/v1/token?grant_type=password', { corpo: { email, password: senha } })); }
export async function sair(escopo = 'local') {
  const t = memoria?.access_token;
  guardar(null);
  if (t) await requisicao(`/auth/v1/logout?scope=${escopo}`, { token: t }).catch(() => {});
}
// manterSessao=false: cria a conta sem trocar quem está logado (usado pelo administrador)
export async function cadastrar(email, senha, dados, manterSessao = true) {
  const r = await requisicao(`/auth/v1/signup?redirect_to=${encodeURIComponent(site())}`, { corpo: { email, password: senha, data: dados } });
  const usuario = r.user ?? r;
  if (!r.access_token && Array.isArray(usuario.identities) && usuario.identities.length === 0) throw new Erro(409, 'Este e-mail já está cadastrado.');
  if (r.access_token) {
    if (manterSessao) guardar(r);
    else await requisicao('/auth/v1/logout?scope=local', { token: r.access_token }).catch(() => {});
  }
  return { logado: !!r.access_token };
}
export async function trocarSenha(email, atual, nova) {
  const prova = await requisicao('/auth/v1/token?grant_type=password', { corpo: { email, password: atual } })
    .catch((e) => { throw e.status === 429 ? e : new Erro(403, 'Senha atual incorreta.'); });
  await requisicao('/auth/v1/user', { metodo: 'PUT', corpo: { password: nova }, token: prova.access_token });
  guardar(prova);
  await requisicao('/auth/v1/logout?scope=others', { token: prova.access_token }).catch(() => {});
}
export async function definirSenha(nova) {
  const t = await token();
  if (!t) throw new Erro(401, 'O link expirou. Peça um novo em "Esqueci minha senha".');
  await requisicao('/auth/v1/user', { metodo: 'PUT', corpo: { password: nova }, token: t });
}
export const recuperar = (email) => requisicao(`/auth/v1/recover?redirect_to=${encodeURIComponent(site())}`, { corpo: { email } });

// trata o retorno dos links de e-mail (confirmação de cadastro ou redefinição de senha)
export function retornoDoEmail() {
  if (!/(access_token|error_description)=/.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + (p.get('type') === 'recovery' ? '#/nova-senha' : '#/'));
  if (p.get('error_description')) return { erro: 'Link inválido ou expirado. Peça um novo.' };
  guardar({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600 });
  return { tipo: p.get('type') };
}
