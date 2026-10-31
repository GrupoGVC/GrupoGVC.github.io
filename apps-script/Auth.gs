/* =====================================================================
 * Portal GVC — login, sessões e usuários (tabelas Usuarios, UsuarioModulos, Unidades)
 * Sessões ficam nas propriedades do script (S_<token>), como antes.
 * Usuarios.unidades: códigos das unidades que a pessoa vê, separados por "; ".
 * Vazio = todas. Admin do portal vê todas.
 * ===================================================================== */

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function dominioOk_(email) {
  if (!DOMINIOS_PERMITIDOS.length) return true;
  const d = email.split('@')[1] || '';
  return DOMINIOS_PERMITIDOS.some(function (x) { return d === String(x).toLowerCase(); });
}

function acharUsuario_(email) {
  email = normEmail_(email);
  const r = ler_('Usuarios').filter(function (x) { return normEmail_(x.email) === email; })[0];
  if (!r) return null;
  const modulos = {};
  Object.keys(MODULOS).forEach(function (m) { modulos[m] = ''; });
  onde_('UsuarioModulos', 'usuarioId', r.id).forEach(function (x) {
    if (x.modulo in modulos && NIVEIS.indexOf(String(x.nivel)) >= 0) modulos[x.modulo] = String(x.nivel);
  });
  return { id: r.id, linha: r._linha, email: email, nome: String(r.nome || email.split('@')[0]), ativo: r.ativo,
           adminPortal: simNao_(r.adminPortal), unidades: separar_(r.unidades), senhaHash: String(r.senhaHash || ''),
           salt: String(r.salt || ''), modulos: modulos, nivel: modulos.destinacao,
           ultimoAcesso: r.ultimoAcesso };
}
function usuarioPublico_(u) {
  return { email: u.email, nome: u.nome, adminPortal: u.adminPortal, modulos: u.modulos, unidades: u.unidades };
}
function hash_(senha, salt) {
  let h = salt + '|' + senha;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}
// Escreve um campo de Usuarios sem mexer em "atualizado em" (senha e último acesso não são alteração de cadastro).
function gravarCampoUsuario_(u, campo, valor) {
  const col = colunas_('Usuarios').indexOf(campo) + 1;
  const rg = aba_('Usuarios').getRange(u.linha, col);
  rg.setNumberFormat(formatoColuna_('Usuarios', campo));
  rg.setValue(valor);
  limparCache_('Usuarios');
}

function login_(email, senha) {
  email = normEmail_(email);
  const cache = CacheService.getScriptCache(); const kt = 'T_' + email;
  const tent = Number(cache.get(kt) || 0);
  if (tent >= 5) return { ok: false, erro: 'bloqueado', mensagem: 'Muitas tentativas. Espere 15 minutos ou use "Primeiro acesso ou esqueci a senha".' };
  const u = acharUsuario_(email);
  if (!u || !dominioOk_(email)) return { ok: false, erro: 'nao_cadastrado', mensagem: 'Este e-mail não tem acesso ao portal. Fale com o administrador.' };
  if (!u.ativo) return { ok: false, erro: 'inativo', mensagem: 'Seu acesso está desativado. Fale com o administrador.' };
  if (!u.senhaHash) return { ok: false, erro: 'sem_senha', mensagem: 'Você ainda não criou sua senha. Use "Primeiro acesso".' };
  if (hash_(String(senha || ''), u.salt) !== u.senhaHash) {
    cache.put(kt, String(tent + 1), 900);
    return { ok: false, erro: 'senha_incorreta', mensagem: 'Senha incorreta.' + (tent + 1 >= 3 ? ' Restam ' + (5 - tent - 1) + ' tentativa(s).' : '') };
  }
  cache.remove(kt);
  return abrirSessao_(u);
}
function abrirSessao_(u) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('S_' + token, JSON.stringify({ email: u.email, exp: Date.now() + DIAS_SESSAO * 864e5 }));
  gravarCampoUsuario_(u, 'ultimoAcesso', new Date());
  limparSessoes_();
  hist_(u, 'portal', 'Usuarios', u.id, u.nome, 'entrou', '', '', '', '');
  return { ok: true, token: token, usuario: usuarioPublico_(u) };
}
function sessao_(token) {
  if (!token) return null;
  const raw = PropertiesService.getScriptProperties().getProperty('S_' + token);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('S_' + token); return null; }
  const u = acharUsuario_(s.email); // nível e situação lidos a cada chamada: mudou, vale na hora
  if (!u || !u.ativo) return null;
  return u;
}
function limparSessoes_() {
  const p = PropertiesService.getScriptProperties(); const all = p.getProperties(); const agora = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < agora) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); }
  });
}
function enviarCodigo_(email) {
  email = normEmail_(email);
  const u = acharUsuario_(email);
  if (!u || !dominioOk_(email)) return { ok: false, erro: 'nao_cadastrado', mensagem: 'Este e-mail não tem acesso ao portal. Fale com o administrador.' };
  if (!u.ativo) return { ok: false, erro: 'inativo', mensagem: 'Seu acesso está desativado. Fale com o administrador.' };
  const cache = CacheService.getScriptCache();
  if (cache.get('E_' + email)) return { ok: false, erro: 'aguarde', mensagem: 'Um código foi enviado há menos de 1 minuto. Confira sua caixa de entrada e o spam.' };
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('C_' + email, JSON.stringify({ codigo: codigo, tent: 0 }), 900);
  cache.put('E_' + email, '1', 60);
  MailApp.sendEmail({
    to: email,
    subject: 'Código de acesso – Portal Grupo GVC',
    body: 'Olá, ' + u.nome + '.\n\nSeu código para criar a senha do Portal Grupo GVC é: ' + codigo +
          '\n\nEle vale por 15 minutos. Se não foi você que pediu, ignore este e-mail.'
  });
  hist_(u, 'portal', 'Usuarios', u.id, u.nome, 'pediu código de senha', '', '', '', '');
  return { ok: true };
}
function definirSenha_(email, codigo, senha) {
  email = normEmail_(email);
  const cache = CacheService.getScriptCache(); const raw = cache.get('C_' + email);
  if (!raw) return { ok: false, erro: 'codigo_expirado', mensagem: 'Código expirado ou não solicitado. Peça um novo.' };
  const c = JSON.parse(raw);
  if (String(codigo || '').trim() !== c.codigo) {
    c.tent++; if (c.tent >= 5) cache.remove('C_' + email); else cache.put('C_' + email, JSON.stringify(c), 900);
    return { ok: false, erro: 'codigo_incorreto', mensagem: c.tent >= 5 ? 'Código incorreto 5 vezes. Peça um novo.' : 'Código incorreto.' };
  }
  senha = String(senha || '');
  if (senha.length < 8) return { ok: false, erro: 'senha_fraca', mensagem: 'A senha precisa ter pelo menos 8 caracteres.' };
  const u = acharUsuario_(email);
  if (!u || !u.ativo) return { ok: false, erro: 'nao_cadastrado', mensagem: 'Este e-mail não tem acesso ao portal.' };
  const salt = Utilities.getUuid();
  gravarCampoUsuario_(u, 'senhaHash', hash_(senha, salt));
  gravarCampoUsuario_(u, 'salt', salt);
  cache.remove('C_' + email); cache.remove('T_' + email);
  hist_(u, 'portal', 'Usuarios', u.id, u.nome, 'criou/trocou a senha', '', '', '', '');
  return abrirSessao_(acharUsuario_(email));
}

/* ---------------- administração de usuários (admin do portal) ---------------- */
function unidadesLista_() {
  return ler_('Unidades').filter(function (x) { return x.ativo; }).map(function (x) { return { id: x.id, nome: String(x.nome) }; });
}
function listarUsuarios_() {
  return { ok: true, modulos: MODULOS, unidades: unidadesLista_(), usuarios: ler_('Usuarios').map(function (r) {
    const u = acharUsuario_(r.email);
    return { email: u.email, nome: u.nome, modulos: u.modulos, adminPortal: u.adminPortal, ativo: u.ativo, temSenha: !!u.senhaHash,
             unidades: u.unidades, ultimoAcesso: r.ultimoAcesso instanceof Date ? Utilities.formatDate(r.ultimoAcesso, tz_(), 'dd/MM/yyyy HH:mm') : '',
             auditoria: auditoria_(r) };
  }) };
}
function salvarUsuario_(x, quem) {
  const email = normEmail_(x && x.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: 'dados_invalidos', mensagem: 'E-mail inválido.' };
  if (!dominioOk_(email)) return { ok: false, erro: 'dados_invalidos', mensagem: 'Só e-mails dos domínios: ' + DOMINIOS_PERMITIDOS.join(', ') };
  const mods = x.modulos || {};
  const adminPortal = x.adminPortal === true;
  const ativo = x.ativo !== false;
  if (email === quem.email && (!adminPortal || !ativo)) return { ok: false, erro: 'dados_invalidos', mensagem: 'Você não pode tirar o seu próprio acesso de administrador do portal.' };
  const niveis = {};
  Object.keys(MODULOS).forEach(function (m) { niveis[m] = NIVEIS.indexOf(mods[m]) >= 0 ? mods[m] : ''; });
  if (!Object.keys(niveis).some(function (m) { return niveis[m]; }) && !adminPortal) return { ok: false, erro: 'dados_invalidos', mensagem: 'Dê acesso a pelo menos um módulo.' };
  const validas = unidadesLista_().map(function (x) { return x.id; });
  const unidades = (Array.isArray(x.unidades) ? x.unidades : separar_(x.unidades)).filter(function (id) { return validas.indexOf(id) >= 0; });
  const nome = String(x.nome || email.split('@')[0]).trim();
  let u = acharUsuario_(email);
  const campos = { email: email, nome: nome, adminPortal: adminPortal ? 'SIM' : 'NÃO', unidades: unidades.join('; '), ativo: ativo };
  let id;
  if (u) { id = u.id; atualizar_('Usuarios', id, campos, quem, 'portal', { registroNome: nome }); }
  else { id = inserir_('Usuarios', campos, quem, 'portal', nome).id; }
  // níveis por módulo
  Object.keys(niveis).forEach(function (m) {
    const atual = onde_('UsuarioModulos', 'usuarioId', id).filter(function (r) { return r.modulo === m; })[0];
    if (atual && niveis[m]) {
      atualizar_('UsuarioModulos', atual.id, { nivel: niveis[m] }, quem, 'portal', { tabela: 'Usuarios', registroId: id, registroNome: nome, prefixoCampo: MODULOS[m] + ' · ' });
    } else if (atual && !niveis[m]) {
      aba_('UsuarioModulos').deleteRow(atual._linha); limparCache_('UsuarioModulos');
      hist_(quem, 'portal', 'Usuarios', id, nome, 'alterou', MODULOS[m] + ' · Nível', atual.nivel, 'sem acesso', '');
    } else if (!atual && niveis[m]) {
      inserir_('UsuarioModulos', { usuarioId: id, modulo: m, nivel: niveis[m] }, quem, null);
      if (u) hist_(quem, 'portal', 'Usuarios', id, nome, 'alterou', MODULOS[m] + ' · Nível', 'sem acesso', niveis[m], '');
    }
  });
  return { ok: true };
}
function resetarSenha_(email, quem) {
  email = normEmail_(email); const u = acharUsuario_(email);
  if (!u) return { ok: false, erro: 'dados_invalidos', mensagem: 'Usuário não encontrado.' };
  gravarCampoUsuario_(u, 'senhaHash', ''); gravarCampoUsuario_(u, 'salt', '');
  const p = PropertiesService.getScriptProperties(); const all = p.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('S_') === 0 && all[k].indexOf('"' + email + '"') >= 0) p.deleteProperty(k); });
  hist_(quem, 'portal', 'Usuarios', u.id, u.nome, 'apagou a senha', '', '', '', 'A pessoa cria uma senha nova no próximo acesso.');
  return { ok: true };
}
function encerrarTodasSessoes() {
  const p = PropertiesService.getScriptProperties(); const all = p.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('S_') === 0) p.deleteProperty(k); });
  try { SpreadsheetApp.getUi().alert('Todos os aparelhos foram desconectados. Cada pessoa vai precisar entrar de novo com a senha.'); } catch (e) {}
}
