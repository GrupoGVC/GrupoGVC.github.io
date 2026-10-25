/**
 * Portal Grupo GVC — API
 * ------------------------------------------------
 * Um único script atende o portal (login e usuários) e os módulos:
 *   • Controle de Destinação → abas desta planilha (Lancamentos, Destinadores, Precos, Locacao)
 *   • Mapa Operacional       → outra planilha, aberta por ID (MAPA_PLANILHA_ID)
 * O código-fonte fica no repositório GrupoGVC/GrupoGVC.github.io, pasta apps-script/.
 *
 * Abas desta planilha (criadas por configurar() se não existirem):
 *   Lancamentos  – um registro por MTR/viagem
 *   Destinadores – cadastro (tipo: custo ou receita)
 *   Precos       – tabela de preço por destinador × resíduo (R$/kg)
 *   Locacao      – veículos alugados, um bloco de linhas por mês
 *   Usuarios     – quem entra no portal; nível em cada módulo (destinacao, mapa) e se é admin do portal
 *   Log          – histórico de alterações e acessos dos dois módulos
 *
 * ACESSO: cada pessoa entra no portal com o e-mail e uma senha que ela mesma cadastra.
 * Só entra quem estiver na aba Usuarios com ativo = SIM. No primeiro acesso (ou ao esquecer a senha)
 * o portal envia um código de 6 dígitos para o e-mail. Em cada módulo a pessoa tem um nível:
 * vazio (sem acesso), leitor, editor ou admin.
 */

/* ======================= AJUSTE AQUI ======================= */
// Domínios de e-mail aceitos. Deixe [] para aceitar qualquer domínio (a aba Usuarios continua valendo).
const DOMINIOS_PERMITIDOS = []; // ex.: ['retec.com.br', 'grupogvc.com.br']
const DIAS_SESSAO = 30;          // quanto tempo o aparelho fica conectado sem pedir senha de novo
/* =========================================================== */

// Planilha do Mapa Operacional (abas Pontos, ResiduosCadastro, Residuos, Equipamentos).
const MAPA_PLANILHA_ID = '176bQkfOlMFCuKuACKfaogA1liMAxaTIIg-W_wPbV_9E';
const MODULOS = { destinacao: 'Controle de Destinação', mapa: 'Mapa Operacional' };

const ABAS = {
  Lancamentos: ['id', 'data', 'mes', 'mtr', 'ticket', 'destinador', 'gerador', 'origem', 'residuo',
                'transportadora', 'placa', 'kg', 'preco', 'valorFixo', 'valor', 'obs', 'atualizadoEm', 'atualizadoPor', 'negocio'],
  Destinadores: ['id', 'nome', 'tipo', 'ativo'],
  Precos: ['destinador', 'residuo', 'preco'],
  Locacao: ['mes', 'tipo', 'placa', 'fornecedor', 'valor'],
  Usuarios: ['email', 'nome', 'destinacao', 'ativo', 'senhaHash', 'salt', 'criadoEm', 'ultimoAcesso', 'mapa', 'adminPortal'],
  Log: ['quando', 'acao', 'registro', 'por', 'detalhe']
};
const COLUNAS_TEXTO = {
  Lancamentos: ['id', 'mes', 'mtr', 'ticket', 'placa'],
  Destinadores: ['id'],
  Precos: ['destinador'],
  Locacao: ['mes', 'placa'],
  Usuarios: ['email', 'senhaHash', 'salt']
};
const NIVEIS = ['leitor', 'editor', 'admin'];
const NEGOCIOS = ['RSS', 'Industrial']; // tipo de negócio do lançamento
const MESES_JANELA = 6;

/* ======================= MENU NA PLANILHA ======================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Portal GVC')
    .addItem('Configurar/verificar abas', 'configurar')
    .addItem('Como cadastrar usuários', 'ajudaUsuarios')
    .addItem('Desconectar todos os aparelhos', 'encerrarTodasSessoes')
    .addToUi();
}

/** Cria abas e cabeçalhos que faltarem, coloca você como administrador e autoriza o envio de e-mail. */
function configurar() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(ABAS).forEach(function (nome) {
    let sh = ss.getSheetByName(nome);
    if (!sh) sh = ss.insertSheet(nome);
    const cab = ABAS[nome];
    const atual = sh.getRange(1, 1, 1, cab.length).getValues()[0];
    if (atual.join('|') !== cab.join('|')) sh.getRange(1, 1, 1, cab.length).setValues([cab]);
    sh.getRange(1, 1, 1, cab.length).setFontWeight('bold').setBackground('#dcefe6');
    sh.setFrozenRows(1);
    (COLUNAS_TEXTO[nome] || []).forEach(function (c) {
      sh.getRange(2, cab.indexOf(c) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    if (nome === 'Lancamentos') {
      sh.getRange(2, cab.indexOf('data') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy');
      sh.getRange(2, cab.indexOf('kg') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0.##');
      sh.getRange(2, cab.indexOf('preco') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.000');
      ['valor', 'valorFixo'].forEach(function (c) { sh.getRange(2, cab.indexOf(c) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('"R$" #,##0.00'); });
    }
    if (nome === 'Lancamentos') {
      const rn = SpreadsheetApp.newDataValidation().requireValueInList(NEGOCIOS, true).setAllowInvalid(false).build();
      sh.getRange(2, cab.indexOf('negocio') + 1, sh.getMaxRows() - 1, 1).setDataValidation(rn);
    }
    if (nome === 'Usuarios') {
      const regra = SpreadsheetApp.newDataValidation().requireValueInList(NIVEIS, true).setAllowInvalid(false).build();
      ['destinacao', 'mapa'].forEach(function (c) { sh.getRange(2, cab.indexOf(c) + 1, sh.getMaxRows() - 1, 1).setDataValidation(regra); });
      const regraSimNao = SpreadsheetApp.newDataValidation().requireValueInList(['SIM', 'NÃO'], true).build();
      ['ativo', 'adminPortal'].forEach(function (c) { sh.getRange(2, cab.indexOf(c) + 1, sh.getMaxRows() - 1, 1).setDataValidation(regraSimNao); });
      sh.hideColumns(cab.indexOf('senhaHash') + 1, 2); // hash e salt ficam ocultos
    }
  });
  // quem roda o configurar vira administrador, se a aba estiver vazia
  migrarUsuarios_();
  const eu = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (eu && !acharUsuario_(eu)) aba_('Usuarios').appendRow([eu, eu.split('@')[0], 'admin', 'SIM', '', '', new Date(), '', 'admin', 'SIM']);
  // pede a permissão de envio de e-mail já agora (usada para o código de primeiro acesso)
  Logger.log('E-mails que ainda podem ser enviados hoje: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Pronto. Administrador: ' + eu + '. Cadastre os demais na aba Usuarios.');
  try { ajudaUsuarios(); } catch (e) { /* rodando pelo editor */ }
}

function ajudaUsuarios() {
  SpreadsheetApp.getUi().alert('Cadastro de usuários',
    'Na aba Usuarios, uma linha por pessoa:\n\n' +
    '• email: o e-mail da empresa\n• nome: como aparece no portal e no Log\n' +
    '• destinacao / mapa: nível em cada módulo — vazio (sem acesso), leitor (só vê), editor (lança e altera) ou admin\n' +
    '• adminPortal: SIM para quem cadastra usuários no portal\n' +
    '• ativo: SIM ou NÃO (NÃO bloqueia na hora)\n\n' +
    'Não preencha senha. No primeiro acesso a pessoa clica em "Primeiro acesso", recebe um código no e-mail e cria a própria senha.\n' +
    'Administradores do portal também cadastram pela tela Usuários do portal.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function encerrarTodasSessoes() {
  const p = PropertiesService.getScriptProperties(); const all = p.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('S_') === 0) p.deleteProperty(k); });
  try { SpreadsheetApp.getUi().alert('Todos os aparelhos foram desconectados. Cada pessoa vai precisar entrar de novo com a senha.'); } catch (e) {}
}

/* ======================= API ======================= */
const ACOES_DESTINACAO_LEITURA = ['dados'];
const ACOES_DESTINACAO_ESCRITA = ['salvarLancamento', 'excluirLancamento', 'definirNegocioLote', 'salvarLocacao', 'salvarDestinador'];
const ACOES_MAPA_LEITURA = ['mapa.listar', 'mapa.lista'];
const ACOES_MAPA_ESCRITA = ['mapa.upsert', 'mapa.delete', 'mapa.listaAdd', 'mapa.listaDel', 'mapa.listaSet'];
const ACOES_ADMIN = ['listarUsuarios', 'salvarUsuario', 'resetarSenha'];

function podeLer_(u, modulo) { return NIVEIS.indexOf(u.modulos[modulo]) >= 0; }
function podeEditar_(u, modulo) { return u.modulos[modulo] === 'editor' || u.modulos[modulo] === 'admin'; }
function semPermissao_(msg) { return { ok: false, erro: 'sem_permissao', mensagem: msg }; }

function doGet(e) {
  try {
    const p = e.parameter || {};
    // O app só usa POST. Um GET sem token quase sempre é um POST que o Google redirecionou
    // (ex.: navegador com várias contas Google) e perdeu o corpo no caminho: não é sessão expirada,
    // é para o app tentar de novo.
    if (!p.token) return json_({ ok: false, erro: 'sem_corpo', mensagem: 'A requisição chegou vazia ao servidor. Tente de novo.' });
    const u = sessao_(p.token);
    if (!u) return json_({ ok: false, erro: 'nao_autenticado' });
    if ((p.acao || 'dados') === 'dados') {
      if (!podeLer_(u, 'destinacao')) return json_(semPermissao_('Você não tem acesso ao Controle de Destinação.'));
      return json_(dados_(p.mes, u));
    }
    return json_({ ok: false, erro: 'acao_desconhecida' });
  } catch (err) {
    return json_({ ok: false, erro: 'interno', mensagem: String(err && err.message || err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erro: 'sem_corpo', mensagem: 'A requisição chegou vazia ao servidor. Tente de novo.' }); }
  try {
    const acao = body.acao;
    // ações sem login
    switch (acao) {
      case 'login': return json_(login_(body.email, body.senha));
      case 'enviarCodigo': return json_(enviarCodigo_(body.email));
      case 'definirSenha': return json_(definirSenha_(body.email, body.codigo, body.senha));
      case 'sair': if (body.token) PropertiesService.getScriptProperties().deleteProperty('S_' + body.token); return json_({ ok: true });
    }
    const u = sessao_(body.token);
    if (!u) return json_({ ok: false, erro: 'nao_autenticado' });
    if (acao === 'eu') return json_({ ok: true, usuario: usuarioPublico_(u) });

    // leituras (sem trava)
    if (acao === 'dados') {
      if (!podeLer_(u, 'destinacao')) return json_(semPermissao_('Você não tem acesso ao Controle de Destinação.'));
      return json_(dados_(body.mes, u));
    }
    if (ACOES_MAPA_LEITURA.indexOf(acao) >= 0) {
      if (!podeLer_(u, 'mapa')) return json_(semPermissao_('Você não tem acesso ao Mapa Operacional.'));
      return json_(acao === 'mapa.listar' ? MAPA.listar() : MAPA.lista(body.nome));
    }

    // escritas e administração (com trava)
    if (ACOES_ADMIN.indexOf(acao) >= 0) {
      if (!u.adminPortal) return json_(semPermissao_('Só administradores do portal podem gerenciar usuários.'));
    } else if (ACOES_DESTINACAO_ESCRITA.indexOf(acao) >= 0) {
      if (!podeEditar_(u, 'destinacao')) return json_(semPermissao_(podeLer_(u, 'destinacao') ? 'Seu acesso ao Controle de Destinação é só de leitura.' : 'Você não tem acesso ao Controle de Destinação.'));
    } else if (ACOES_MAPA_ESCRITA.indexOf(acao) >= 0) {
      if (!podeEditar_(u, 'mapa')) return json_(semPermissao_(podeLer_(u, 'mapa') ? 'Seu acesso ao Mapa Operacional é só de leitura.' : 'Você não tem acesso ao Mapa Operacional.'));
    } else {
      return json_({ ok: false, erro: 'acao_desconhecida' });
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, erro: 'ocupado', mensagem: 'Planilha ocupada. Tente de novo em alguns segundos.' });
    try {
      switch (acao) {
        case 'salvarLancamento': return json_(salvarLancamento_(body.lanc, u));
        case 'excluirLancamento': return json_(excluirLancamento_(body.id, u));
        case 'definirNegocioLote': return json_(definirNegocioLote_(body.ids, body.negocio, u));
        case 'salvarLocacao': return json_(salvarLocacao_(body.mes, body.veiculos || [], u));
        case 'salvarDestinador': return json_(salvarDestinador_(body.dest, u));
        case 'listarUsuarios': return json_(listarUsuarios_());
        case 'salvarUsuario': return json_(salvarUsuario_(body.usuario, u));
        case 'resetarSenha': return json_(resetarSenha_(body.email, u));
        case 'mapa.upsert': return json_(MAPA.upsert(body.point, u));
        case 'mapa.delete': return json_(MAPA.apagar(body.id, u));
        case 'mapa.listaAdd': return json_(MAPA.listaAdd(body.nome, body.valor, u));
        case 'mapa.listaDel': return json_(MAPA.listaDel(body.nome, body.valor, u));
        case 'mapa.listaSet': return json_(MAPA.listaSet(body.nome, body.list));
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ ok: false, erro: 'interno', mensagem: 'Erro na planilha: ' + String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= LOGIN ======================= */
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function dominioOk_(email) {
  if (!DOMINIOS_PERMITIDOS.length) return true;
  const d = email.split('@')[1] || '';
  return DOMINIOS_PERMITIDOS.some(function (x) { return d === String(x).toLowerCase(); });
}
// Converte a aba Usuarios do formato antigo (só o Controle de Destinação, coluna "nivel") para o do portal:
// "nivel" vira "destinacao", e entram as colunas "mapa" (mesmo nível que a pessoa já tinha) e "adminPortal".
function migrarUsuarios_() {
  const sh = aba_('Usuarios'); const cab = ABAS.Usuarios;
  const atual = sh.getRange(1, 1, 1, cab.length).getValues()[0].map(function (x) { return String(x).trim(); });
  if (atual.join('|') === cab.join('|')) return;
  if (atual[2] === 'nivel') sh.getRange(1, 3).setValue('destinacao');
  const n = sh.getLastRow();
  const precisaMapa = atual[8] !== 'mapa', precisaAdmin = atual[9] !== 'adminPortal';
  sh.getRange(1, 9, 1, 2).setValues([['mapa', 'adminPortal']]).setFontWeight('bold').setBackground('#dcefe6');
  if (n >= 2 && (precisaMapa || precisaAdmin)) {
    const vals = sh.getRange(2, 1, n - 1, cab.length).getValues();
    const novos = vals.map(function (r) {
      const niv = String(r[2]).trim().toLowerCase();
      return [precisaMapa ? (NIVEIS.indexOf(niv) >= 0 ? niv : '') : r[8],
              precisaAdmin ? (niv === 'admin' ? 'SIM' : 'NÃO') : r[9]];
    });
    sh.getRange(2, 9, n - 1, 2).setValues(novos);
  }
  log_('migrou usuários para o portal', 'Usuarios', 'sistema', (n - 1) + ' usuário(s)');
}
let usuariosMigrados_ = false;

function acharUsuario_(email) {
  if (!usuariosMigrados_) { migrarUsuarios_(); usuariosMigrados_ = true; }
  const sh = aba_('Usuarios'); const n = sh.getLastRow(); if (n < 2) return null;
  const cab = ABAS.Usuarios;
  const vals = sh.getRange(2, 1, n - 1, cab.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (normEmail_(vals[i][0]) === email) {
      const o = { linha: i + 2 }; cab.forEach(function (c, j) { o[c] = vals[i][j]; });
      const nivelDe = function (v) { v = String(v || '').trim().toLowerCase(); return NIVEIS.indexOf(v) >= 0 ? v : ''; };
      const sim = function (v) { return v === true || ['SIM', 'S', 'TRUE', 'VERDADEIRO', '1'].indexOf(String(v).trim().toUpperCase()) >= 0; };
      o.email = email;
      o.modulos = { destinacao: nivelDe(o.destinacao), mapa: nivelDe(o.mapa) };
      o.nivel = o.modulos.destinacao; // nível no Controle de Destinação (usado nas funções desse módulo)
      o.adminPortal = sim(o.adminPortal);
      o.ativo = sim(o.ativo);
      o.nome = String(o.nome || email.split('@')[0]);
      return o;
    }
  }
  return null;
}
function hash_(senha, salt) {
  let h = salt + '|' + senha;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
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
  if (hash_(String(senha || ''), String(u.salt)) !== String(u.senhaHash)) {
    cache.put(kt, String(tent + 1), 900);
    return { ok: false, erro: 'senha_incorreta', mensagem: 'Senha incorreta.' + (tent + 1 >= 3 ? ' Restam ' + (5 - tent - 1) + ' tentativa(s).' : '') };
  }
  cache.remove(kt);
  return abrirSessao_(u);
}
function abrirSessao_(u) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const p = PropertiesService.getScriptProperties();
  p.setProperty('S_' + token, JSON.stringify({ email: u.email, exp: Date.now() + DIAS_SESSAO * 864e5 }));
  aba_('Usuarios').getRange(u.linha, ABAS.Usuarios.indexOf('ultimoAcesso') + 1).setValue(new Date());
  limparSessoes_();
  log_('entrou no portal', u.email, u.nome, '');
  return { ok: true, token: token, usuario: usuarioPublico_(u) };
}
function usuarioPublico_(u) {
  return { email: u.email, nome: u.nome, adminPortal: u.adminPortal, modulos: u.modulos };
}
function sessao_(token) {
  if (!token) return null;
  const raw = PropertiesService.getScriptProperties().getProperty('S_' + token);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('S_' + token); return null; }
  const u = acharUsuario_(s.email); // alçada e status lidos a cada chamada: mudou na planilha, vale na hora
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
  log_('pediu código de senha', email, u.nome, '');
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
  const sh = aba_('Usuarios'); const cab = ABAS.Usuarios;
  sh.getRange(u.linha, cab.indexOf('senhaHash') + 1, 1, 2).setValues([[hash_(senha, salt), salt]]);
  cache.remove('C_' + email); cache.remove('T_' + email);
  log_('criou/trocou senha', email, u.nome, '');
  return abrirSessao_(u);
}

/* ======================= USUÁRIOS (admin) ======================= */
function listarUsuarios_() {
  return { ok: true, modulos: MODULOS, usuarios: ler_('Usuarios').filter(function (r) { return r.email; }).map(function (r) {
    const u = acharUsuario_(normEmail_(r.email));
    return { email: u.email, nome: u.nome, modulos: u.modulos, adminPortal: u.adminPortal, ativo: u.ativo, temSenha: !!u.senhaHash,
             ultimoAcesso: r.ultimoAcesso instanceof Date ? Utilities.formatDate(r.ultimoAcesso, tz_(), 'dd/MM/yyyy HH:mm') : '' };
  }) };
}
function salvarUsuario_(x, quem) {
  const email = normEmail_(x && x.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: 'dados_invalidos', mensagem: 'E-mail inválido.' };
  if (!dominioOk_(email)) return { ok: false, erro: 'dados_invalidos', mensagem: 'Só e-mails dos domínios: ' + DOMINIOS_PERMITIDOS.join(', ') };
  const mods = x.modulos || {};
  const nivelDe = function (v) { return NIVEIS.indexOf(v) >= 0 ? v : ''; };
  const destinacao = nivelDe(mods.destinacao), mapa = nivelDe(mods.mapa);
  const adminPortal = x.adminPortal === true;
  const ativo = x.ativo === false ? 'NÃO' : 'SIM';
  if (email === quem.email && (!adminPortal || ativo === 'NÃO')) return { ok: false, erro: 'dados_invalidos', mensagem: 'Você não pode tirar o seu próprio acesso de administrador do portal.' };
  if (!destinacao && !mapa && !adminPortal) return { ok: false, erro: 'dados_invalidos', mensagem: 'Dê acesso a pelo menos um módulo.' };
  const sh = aba_('Usuarios'); const cab = ABAS.Usuarios; const u = acharUsuario_(email);
  const nome = String(x.nome || email.split('@')[0]).trim();
  if (u) {
    sh.getRange(u.linha, 1, 1, 4).setValues([[email, nome, destinacao, ativo]]);
    sh.getRange(u.linha, cab.indexOf('mapa') + 1, 1, 2).setValues([[mapa, adminPortal ? 'SIM' : 'NÃO']]);
  } else {
    sh.appendRow([email, nome, destinacao, ativo, '', '', new Date(), '', mapa, adminPortal ? 'SIM' : 'NÃO']);
  }
  log_(u ? 'alterou usuário' : 'cadastrou usuário', email, quem.nome,
       'destinação ' + (destinacao || 'sem acesso') + ' · mapa ' + (mapa || 'sem acesso') + ' · admin do portal ' + (adminPortal ? 'sim' : 'não') + ' · ativo ' + ativo);
  return { ok: true };
}
function resetarSenha_(email, quem) {
  email = normEmail_(email); const u = acharUsuario_(email);
  if (!u) return { ok: false, erro: 'dados_invalidos', mensagem: 'Usuário não encontrado.' };
  aba_('Usuarios').getRange(u.linha, ABAS.Usuarios.indexOf('senhaHash') + 1, 1, 2).setValues([['', '']]);
  const p = PropertiesService.getScriptProperties(); const all = p.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('S_') === 0 && all[k].indexOf('"' + email + '"') >= 0) p.deleteProperty(k); });
  log_('apagou senha', email, quem.nome, 'usuário vai criar nova senha no próximo acesso');
  return { ok: true };
}

/* ======================= LEITURA ======================= */
function dados_(mes, u) {
  garantirCabecalho_('Lancamentos');
  const lanc = ler_('Lancamentos').map(normLanc_).filter(function (l) { return l.id; });
  let ultimo = '';
  lanc.forEach(function (l) { if (l.mes > ultimo) ultimo = l.mes; });
  if (!/^\d{4}-\d{2}$/.test(mes || '')) mes = ultimo || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM');
  const janela = [];
  for (let i = 0; i < MESES_JANELA; i++) janela.push(addMes_(mes, -i));

  let destinadores, fonteDestinadores = 'mapa';
  try { destinadores = destinadoresDoMapa_(); }
  catch (e) { destinadores = destinadoresDaPlanilha_(); fonteDestinadores = 'controle'; }

  const locacao = {};
  ler_('Locacao').forEach(function (r) {
    const m = mesTexto_(r.mes); if (janela.indexOf(m) < 0 || !r.placa) return;
    (locacao[m] = locacao[m] || []).push({ tipo: String(r.tipo || ''), placa: String(r.placa).trim().toUpperCase(),
      fornecedor: String(r.fornecedor || ''), valor: num_(r.valor) });
  });

  return { ok: true, usuario: { email: u.email, nome: u.nome, nivel: u.nivel }, mes: mes, ultimoMes: ultimo,
           destinadores: destinadores, fonteDestinadores: fonteDestinadores, lancamentos: lanc.filter(function (l) { return janela.indexOf(l.mes) >= 0; }), locacao: locacao };
}

function normLanc_(r) {
  const data = dataTexto_(r.data);
  const kg = r.kg === '' || r.kg === null ? null : num_(r.kg);
  const preco = num_(r.preco);
  const fixo = r.valorFixo === '' || r.valorFixo === null ? null : num_(r.valorFixo);
  let valor = r.valor === '' || r.valor === null ? null : num_(r.valor);
  if (valor === null) valor = fixo !== null ? fixo : Math.round((kg || 0) * preco * 100) / 100;
  const o = { id: String(r.id || '').trim(), data: data, mes: mesTexto_(r.mes) || data.slice(0, 7),
    mtr: String(r.mtr || '').trim(), ticket: String(r.ticket || '').trim(), destinador: String(r.destinador || '').trim(),
    gerador: String(r.gerador || ''), origem: String(r.origem || ''), residuo: String(r.residuo || '').toUpperCase(),
    transportadora: String(r.transportadora || ''), placa: String(r.placa || '').toUpperCase(),
    kg: kg, preco: preco, valor: valor, obs: String(r.obs || ''), atualizadoPor: String(r.atualizadoPor || ''), negocio: normNegocio_(r.negocio) };
  if (fixo !== null) o.valorFixo = fixo;
  return o;
}

/* ======================= ESCRITA ======================= */
function salvarLancamento_(l, u) {
  garantirCabecalho_('Lancamentos');
  if (!l || !l.id) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lançamento sem identificador.' };
  l.atualizadoPor = u.nome;
  l.negocio = normNegocio_(l.negocio);
  const sh = aba_('Lancamentos'); const cab = ABAS.Lancamentos;
  const linha = cab.map(function (c) {
    if (c === 'data') return l.data ? paraData_(l.data) : '';
    if (c === 'atualizadoEm') return new Date();
    const v = l[c];
    return v === undefined || v === null ? '' : v;
  });
  const idx = acharLinha_(sh, l.id);
  if (idx > 0) sh.getRange(idx, 1, 1, cab.length).setValues([linha]);
  else sh.appendRow(linha);
  log_(idx > 0 ? 'alterou lançamento' : 'novo lançamento', l.id, u.nome, (l.mtr || 's/ MTR') + ' · ' + l.destinador + ' · ' + (l.kg || 0) + ' kg · R$ ' + l.valor);
  return { ok: true };
}

function normNegocio_(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'RSS') return 'RSS';
  if (t.indexOf('IND') === 0) return 'Industrial';
  return '';
}

/** Define o tipo de negócio de vários lançamentos de uma vez (classificação do histórico). */
function definirNegocioLote_(ids, negocio, u) {
  negocio = normNegocio_(negocio);
  if (!negocio) return { ok: false, erro: 'dados_invalidos', mensagem: 'Escolha RSS ou Industrial.' };
  if (!ids || !ids.length) return { ok: true, alterados: 0 };
  const sh = aba_('Lancamentos'); const n = sh.getLastRow(); if (n < 2) return { ok: true, alterados: 0 };
  const cab = ABAS.Lancamentos; const col = cab.indexOf('negocio') + 1;
  const quer = {}; ids.forEach(function (i) { quer[String(i)] = true; });
  const idsPlan = sh.getRange(2, 1, n - 1, 1).getValues();
  const atual = sh.getRange(2, col, n - 1, 1).getValues();
  let alt = 0;
  for (let i = 0; i < idsPlan.length; i++) if (quer[String(idsPlan[i][0]).trim()]) { atual[i][0] = negocio; alt++; }
  sh.getRange(2, col, n - 1, 1).setValues(atual);
  log_('classificou tipo de negócio', alt + ' lançamento(s)', u.nome, negocio);
  return { ok: true, alterados: alt };
}

function excluirLancamento_(id, u) {
  const sh = aba_('Lancamentos'); const idx = acharLinha_(sh, id);
  if (idx > 0) {
    const antes = sh.getRange(idx, 1, 1, ABAS.Lancamentos.length).getDisplayValues()[0].join(' | ');
    sh.deleteRow(idx);
    log_('excluiu lançamento', id, u.nome, antes);
  }
  return { ok: true };
}

function salvarLocacao_(mes, veiculos, u) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return { ok: false, erro: 'dados_invalidos', mensagem: 'Mês inválido.' };
  const sh = aba_('Locacao'); const cab = ABAS.Locacao;
  const n = sh.getLastRow();
  const resto = n > 1 ? sh.getRange(2, 1, n - 1, cab.length).getValues().filter(function (r) { return mesTexto_(r[0]) !== mes && r.join('') !== ''; }) : [];
  const novos = veiculos.filter(function (v) { return v.placa; }).map(function (v) {
    return [mes, v.tipo || '', String(v.placa).toUpperCase(), v.fornecedor || '', num_(v.valor)];
  });
  const todas = resto.concat(novos).sort(function (a, b) { return String(mesTexto_(a[0])).localeCompare(String(mesTexto_(b[0]))); });
  if (n > 1) sh.getRange(2, 1, n - 1, cab.length).clearContent();
  if (todas.length) sh.getRange(2, 1, todas.length, cab.length).setValues(todas);
  log_('salvou frota', mes, u.nome, novos.length + ' veículos');
  return { ok: true };
}

/* ---------- destinadores e preços: vêm do Mapa Operacional ----------
 * Desde 24/10/2026 a fonte é o cadastro do Mapa (tipos destinador/reciclador, aba ResiduosCadastro).
 * As abas Destinadores e Precos desta planilha ficam como histórico e só servem para dar nome
 * a destinadores antigos que não existem no Mapa (aparecem inativos) ou de reserva se o Mapa falhar. */
// Nomes do catálogo do Mapa que no Controle sempre foram outro nome (mantém o histórico de lançamentos igual).
const RESIDUO_MAPA_PARA_CONTROLE = {
  'PAPEL / PAPELÃO': 'PAPELÃO', 'METAL / SUCATA': 'METAL', 'CLASSE I – PERIGOSO': 'PERIGOSO', 'ELETRÔNICO (REEE)': 'ELETRÔNICO'
};
function residuoControle_(nome) {
  const k = String(nome || '').trim().toUpperCase();
  return RESIDUO_MAPA_PARA_CONTROLE[k] || k;
}
// id no Controle: cadastros importados do Controle têm id "cd-<id antigo>" no Mapa; os lançamentos antigos usam o id antigo.
function idControleDoMapa_(id) { id = String(id); return id.indexOf('cd-') === 0 ? id.slice(3) : id; }

function destinadoresDoMapa_() {
  const pontos = MAPA.listar().pontos.filter(function (p) {
    return p.tipos.indexOf('destinador') !== -1 || p.tipos.indexOf('reciclador') !== -1;
  });
  const vistos = {};
  const lista = pontos.map(function (p) {
    const rec = p.tipos.indexOf('reciclador') !== -1, des = p.tipos.indexOf('destinador') !== -1;
    const precos = {}, naturezas = {};
    (p.residuos || []).forEach(function (r) {
      if (p.precos[r] == null || p.precos[r] === '') return;
      const k = residuoControle_(r);
      precos[k] = num_(p.precos[r]);
      naturezas[k] = p.naturezas[r] || (rec && !des ? 'receita' : 'custo');
    });
    const nats = Object.keys(naturezas).map(function (k) { return naturezas[k]; });
    // Só reciclador → receita; só destinador → custo; os dois → receita se todos os resíduos com preço forem receita.
    const tipo = rec && !des ? 'receita' : (des && !rec ? 'custo' : (nats.length && nats.every(function (n) { return n === 'receita'; }) ? 'receita' : 'custo'));
    const id = idControleDoMapa_(p.id);
    vistos[id] = true;
    return { id: id, mapaId: p.id, nome: String(p.nome || p.razaoSocial || id), tipo: tipo, ativo: true, precos: precos, naturezas: naturezas,
             cidade: [p.cidade, p.uf].filter(function (x) { return x; }).join('/') };
  });
  // Destinadores antigos (só na planilha do Controle): ficam inativos, só para o histórico mostrar o nome.
  destinadoresDaPlanilha_().forEach(function (d) {
    if (vistos[d.id]) return;
    d.ativo = false; d.precos = {}; d.foraDoMapa = true;
    lista.push(d);
  });
  return lista;
}
function destinadoresDaPlanilha_() {
  const precos = {};
  ler_('Precos').forEach(function (r) {
    const d = String(r.destinador || '').trim(); const res = String(r.residuo || '').trim().toUpperCase();
    if (!d || !res || r.preco === '') return;
    (precos[d] = precos[d] || {})[res] = num_(r.preco);
  });
  return ler_('Destinadores').filter(function (r) { return r.id; }).map(function (r) {
    const id = String(r.id).trim();
    return { id: id, nome: String(r.nome || id), tipo: String(r.tipo).toLowerCase() === 'receita' ? 'receita' : 'custo',
             ativo: r.ativo !== false && String(r.ativo).toUpperCase() !== 'FALSE', precos: precos[id] || {} };
  });
}

// Desativado: destinadores e preços são editados no Mapa Operacional. Mantido para não quebrar telas antigas abertas.
function salvarDestinador_(d, u) {
  return { ok: false, erro: 'dados_invalidos',
    mensagem: 'Destinadores, resíduos e preços agora são cadastrados no Mapa Operacional. Edite o cadastro por lá.' };
}
function salvarDestinadorAntigo_(d, u) {
  if (!d || !d.id || !d.nome) return { ok: false, erro: 'dados_invalidos', mensagem: 'Destinador sem nome.' };
  const sh = aba_('Destinadores'); const idx = acharLinha_(sh, d.id);
  const linha = [d.id, d.nome, d.tipo === 'receita' ? 'receita' : 'custo', d.ativo !== false];
  if (idx > 0) sh.getRange(idx, 1, 1, 4).setValues([linha]); else sh.appendRow(linha);
  const ps = aba_('Precos'); const n = ps.getLastRow();
  const resto = n > 1 ? ps.getRange(2, 1, n - 1, 3).getValues().filter(function (r) { return String(r[0]).trim() !== d.id && r.join('') !== ''; }) : [];
  const novos = Object.keys(d.precos || {}).map(function (res) { return [d.id, res, num_(d.precos[res])]; });
  const todas = resto.concat(novos);
  if (n > 1) ps.getRange(2, 1, n - 1, 3).clearContent();
  if (todas.length) ps.getRange(2, 1, todas.length, 3).setValues(todas);
  log_('salvou destinador', d.id, u.nome, d.nome + ' · ' + novos.length + ' preço(s)');
  return { ok: true };
}

/* ======================= UTILITÁRIOS ======================= */
/** Completa colunas novas na linha 1 (quando uma versão nova do script acrescenta campos), sem precisar rodar configurar(). */
function garantirCabecalho_(nome) {
  const sh = aba_(nome); const cab = ABAS[nome];
  const atual = sh.getRange(1, 1, 1, cab.length).getValues()[0];
  for (let i = 0; i < cab.length; i++) {
    if (String(atual[i]).trim() === cab[i]) continue;
    if (String(atual[i]).trim() !== '') return; // cabeçalho diferente do esperado: não mexe, configurar() resolve
    sh.getRange(1, i + 1).setValue(cab[i]).setFontWeight('bold').setBackground('#dcefe6');
  }
}

function aba_(nome) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nome);
  if (!sh) throw new Error('A aba "' + nome + '" não existe. Rode configurar() no Apps Script.');
  return sh;
}
function ler_(nome) {
  const sh = aba_(nome); const n = sh.getLastRow(); const cab = ABAS[nome];
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, cab.length).getValues().map(function (row) {
    const o = {}; cab.forEach(function (c, i) { o[c] = row[i]; }); return o;
  });
}
function acharLinha_(sh, id) {
  const n = sh.getLastRow(); if (n < 2) return -1;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === String(id)) return i + 2;
  return -1;
}
function log_(acao, registro, por, detalhe) {
  try { aba_('Log').appendRow([new Date(), acao, registro, por || '', detalhe || '']); } catch (e) { /* log é opcional */ }
}
function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'America/Bahia'; }
function num_(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').trim(); if (!s) return 0;
  const t = s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t.replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n;
}
function dataTexto_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function mesTexto_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})/); if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) return m[2] + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function paraData_(iso) { return Utilities.parseDate(iso + ' 12:00', tz_(), 'yyyy-MM-dd HH:mm'); }
function addMes_(m, d) {
  let y = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7)) + d;
  while (mm < 1) { mm += 12; y--; } while (mm > 12) { mm -= 12; y++; }
  return y + '-' + ('0' + mm).slice(-2);
}

/* ======================= MÓDULO: MAPA OPERACIONAL ======================= */
// Lê e grava a planilha "GVC Mapa Operacional — Banco de Dados" (MAPA_PLANILHA_ID).
// Abas: Pontos (um cadastro por linha), ResiduosCadastro (um resíduo de um cadastro por linha,
// com preço por kg e receita/custo), Residuos e Equipamentos (listas de tipos).
const MAPA = (function () {
  const PONTOS = 'Pontos';
  const RC = 'ResiduosCadastro';
  const HEADERS = ['id','tipos','nome','razaoSocial','cat','cnpj','contatoNome','telefones','emails','logradouro','numero','bairro','cidade','uf','cep','obs','equipamentos','lat','lng','gmaps'];
  const RC_HEADERS = ['id_cadastro','cadastro','residuo','preco_kg','natureza'];
  const LISTAS = {
    residuos:     { aba: 'Residuos',     cabecalho: 'residuo' },
    equipamentos: { aba: 'Equipamentos', cabecalho: 'equipamento' },
  };
  const NUMERICAS = { lat: true, lng: true, preco_kg: true };
  let ss = null;

  function planilha() { return ss || (ss = SpreadsheetApp.openById(MAPA_PLANILHA_ID)); }
  function getAba(nome, cabecalho) {
    let sheet = planilha().getSheetByName(nome);
    if (!sheet) sheet = planilha().insertSheet(nome);
    if (sheet.getLastRow() === 0) sheet.appendRow(cabecalho);
    return sheet;
  }
  // Grava linhas com colunas de texto em formato texto (telefone/CEP não viram número, "=" não vira fórmula).
  function escrever(sheet, inicio, headers, linhas) {
    if (!linhas.length) return;
    headers.forEach(function (h, j) {
      sheet.getRange(inicio, j + 1, linhas.length, 1).setNumberFormat(NUMERICAS[h] ? '0.######' : '@');
    });
    sheet.getRange(inicio, 1, linhas.length, headers.length).setValues(linhas);
  }
  function reescrever(sheet, headers, linhas) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    escrever(sheet, 2, headers, linhas);
  }
  function lerObjetos(sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    const headers = data[0].map(String);
    return data.slice(1)
      .filter(function (r) { return String(r[0]) !== ''; })
      .map(function (r) { const o = {}; headers.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o; });
  }
  function juntar(v, sep) { return Array.isArray(v) ? v.map(String).filter(function (x) { return x.trim() !== ''; }).join(sep) : (v == null ? '' : String(v)); }
  function separar(v, re) { return String(v == null ? '' : v).split(re).map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; }); }
  function parseJson(v, padrao) { if (typeof v !== 'string') return v || padrao; try { return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
  function naturezaPadrao(tipos) {
    const r = tipos.indexOf('reciclador') !== -1, d = tipos.indexOf('destinador') !== -1;
    return r && !d ? 'receita' : (d && !r ? 'custo' : '');
  }

  function abaPontos() {
    const sheet = getAba(PONTOS, HEADERS);
    const atual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String).filter(function (h) { return h !== ''; });
    if (atual.join('|') !== HEADERS.join('|')) migrar(sheet);
    return sheet;
  }
  // Formato antigo (1 tipo, tel/email, resíduos e preços em JSON na própria aba Pontos) → formato atual.
  function migrar(sheet) {
    const antigos = lerObjetos(sheet);
    const rc = getAba(RC, RC_HEADERS);
    const comRc = {};
    lerObjetos(rc).forEach(function (o) { comRc[String(o.id_cadastro)] = true; });
    const novasRc = [];
    const linhas = antigos.map(function (o) {
      const tipos = o.tipos ? separar(o.tipos, /\s*,\s*/) : (o.tipo ? [String(o.tipo)] : []);
      const p = {
        id: o.id, tipos: tipos, nome: o.nome, razaoSocial: o.razaoSocial || '', cat: o.cat, cnpj: o.cnpj,
        contatoNome: o.contatoNome,
        telefones: o.telefones != null && o.telefones !== '' ? o.telefones : (o.tel || ''),
        emails: o.emails != null && o.emails !== '' ? o.emails : (o.email || ''),
        logradouro: o.logradouro, numero: o.numero, bairro: o.bairro, cidade: o.cidade, uf: o.uf, cep: o.cep,
        obs: o.obs, equipamentos: o.equipamentos || '', lat: o.lat, lng: o.lng, gmaps: o.gmaps,
      };
      if (!comRc[String(o.id)]) {
        const residuos = parseJson(o.residuos, []);
        const precos = parseJson(o.precos, {});
        const nat = naturezaPadrao(tipos);
        if (Array.isArray(residuos)) residuos.forEach(function (r) {
          const preco = precos && precos[r] != null && precos[r] !== '' ? Number(precos[r]) : '';
          novasRc.push([String(o.id), String(o.nome || ''), String(r), preco, nat]);
        });
      }
      return linhaPonto(p);
    });
    reescrever(sheet, HEADERS, linhas);
    if (novasRc.length) escrever(rc, rc.getLastRow() + 1, RC_HEADERS, novasRc);
  }
  function acharLinha(sheet, id) {
    const last = sheet.getLastRow();
    if (last < 2) return -1;
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
    return -1;
  }
  function linhaPonto(p) {
    return HEADERS.map(function (h) {
      if (h === 'tipos') return juntar(p.tipos && p.tipos.length ? p.tipos : (p.tipo ? [p.tipo] : []), ', ');
      if (h === 'telefones' || h === 'emails' || h === 'equipamentos') return juntar(p[h], '; ');
      const v = p[h];
      return v !== undefined && v !== null ? v : '';
    });
  }
  function linhasResiduos(p) {
    const precos = p.precos || {}, naturezas = p.naturezas || {};
    return (p.residuos || []).map(function (r) {
      return [String(p.id), String(p.nome || ''), String(r), precos[r] != null && precos[r] !== '' ? Number(precos[r]) : '', naturezas[r] || ''];
    });
  }
  function semOCadastro(rc, id) {
    return lerObjetos(rc).filter(function (o) { return String(o.id_cadastro) !== String(id); })
      .map(function (o) { return RC_HEADERS.map(function (h) { return o[h] !== undefined ? o[h] : ''; }); });
  }
  function getLista(nome) {
    const cfg = LISTAS[nome];
    const sheet = getAba(cfg.aba, [cfg.cabecalho]);
    const last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }).filter(function (x) { return x !== ''; });
  }
  function setLista(nome, list) {
    const cfg = LISTAS[nome];
    reescrever(getAba(cfg.aba, [cfg.cabecalho]), [cfg.cabecalho], list.map(function (x) { return [String(x)]; }));
  }
  function listaDesconhecida() { return { ok: false, erro: 'dados_invalidos', mensagem: 'Lista desconhecida.' }; }

  return {
    listar: function () {
      const sheet = abaPontos();
      const porCadastro = {};
      lerObjetos(getAba(RC, RC_HEADERS)).forEach(function (o) {
        const id = String(o.id_cadastro);
        const x = porCadastro[id] || (porCadastro[id] = { residuos: [], precos: {}, naturezas: {} });
        const r = String(o.residuo);
        x.residuos.push(r);
        if (o.preco_kg !== '' && o.preco_kg != null) x.precos[r] = Number(o.preco_kg);
        if (o.natureza) x.naturezas[r] = String(o.natureza);
      });
      const pontos = lerObjetos(sheet).map(function (o) {
        o.id = String(o.id);
        o.tipos = separar(o.tipos, /\s*,\s*/);
        o.tipo = o.tipos[0] || '';
        o.telefones = separar(o.telefones, /\s*;\s*/);
        o.emails = separar(o.emails, /\s*;\s*/);
        o.equipamentos = separar(o.equipamentos, /\s*;\s*/);
        const x = porCadastro[o.id] || { residuos: [], precos: {}, naturezas: {} };
        o.residuos = x.residuos; o.precos = x.precos; o.naturezas = x.naturezas;
        return o;
      });
      return { ok: true, pontos: pontos };
    },
    lista: function (nome) {
      if (!LISTAS[nome]) return listaDesconhecida();
      return { ok: true, list: getLista(nome) };
    },
    upsert: function (p, u) {
      if (!p || !p.id) return { ok: false, erro: 'dados_invalidos', mensagem: 'Cadastro sem identificador.' };
      const sheet = abaPontos();
      const idx = acharLinha(sheet, p.id);
      escrever(sheet, idx === -1 ? sheet.getLastRow() + 1 : idx, HEADERS, [linhaPonto(p)]);
      const rc = getAba(RC, RC_HEADERS);
      reescrever(rc, RC_HEADERS, semOCadastro(rc, p.id).concat(linhasResiduos(p)));
      log_(idx === -1 ? 'mapa: novo cadastro' : 'mapa: alterou cadastro', p.id, u.nome, String(p.nome || '') + ' · ' + juntar(p.tipos, ', '));
      return { ok: true };
    },
    apagar: function (id, u) {
      const sheet = abaPontos();
      const idx = acharLinha(sheet, id);
      let nome = '';
      if (idx !== -1) { nome = String(sheet.getRange(idx, 3).getValue()); sheet.deleteRow(idx); }
      const rc = getAba(RC, RC_HEADERS);
      const resto = semOCadastro(rc, id);
      if (resto.length !== Math.max(rc.getLastRow() - 1, 0)) reescrever(rc, RC_HEADERS, resto);
      log_('mapa: excluiu cadastro', id, u.nome, nome);
      return { ok: true };
    },
    listaAdd: function (nome, valor, u) {
      if (!LISTAS[nome]) return listaDesconhecida();
      const list = getLista(nome);
      const v = String(valor || '').trim();
      if (v && !list.some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) {
        list.push(v); setLista(nome, list);
        log_('mapa: adicionou à lista de ' + nome, v, u.nome, '');
      }
      return { ok: true, list: list };
    },
    listaDel: function (nome, valor, u) {
      if (!LISTAS[nome]) return listaDesconhecida();
      const list = getLista(nome).filter(function (x) { return x !== String(valor); });
      setLista(nome, list);
      log_('mapa: removeu da lista de ' + nome, String(valor), u.nome, '');
      return { ok: true, list: list };
    },
    // Só preenche a lista se ela ainda estiver vazia (primeira vez).
    listaSet: function (nome, list) {
      if (!LISTAS[nome]) return listaDesconhecida();
      if (getLista(nome).length === 0 && Array.isArray(list)) setLista(nome, list.map(String).filter(function (x) { return x.trim() !== ''; }));
      return { ok: true, list: getLista(nome) };
    },
  };
})();
