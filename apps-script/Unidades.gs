/* =====================================================================
 * Unidades do grupo GVC
 *  Cada unidade é um cadastro do Mapa Operacional marcado como "Unidade GVC" (tipo 'empresa').
 *  A tabela Unidades continua sendo a lista usada pelos módulos (unidadeId), mas é espelhada
 *  dos cadastros: criar/renomear/inativar o cadastro no Mapa cria/renomeia/inativa a unidade.
 * ===================================================================== */

const UNIDADES_GVC = ['Retec S/A SF', 'Retec S/A JUA', 'Retec Oeste Guanambi', 'Retec Oeste BJL', 'Retec Oeste Barreiras',
                      'CVR Oeste', 'CVR Alto Sertão', 'CVR São Francisco', 'EVE Ambiental'];

function ehUnidadeGvc_(c) { return separar_(c.tipos).indexOf('empresa') >= 0; }
function nomeCadastro_(c) { return String(c.nome || c.razaoSocial || c.id).trim(); }

/** Espelha os cadastros "Unidade GVC" na tabela Unidades. Idempotente. */
function sincronizarUnidades_(u) {
  const cads = ler_('Cadastros').filter(ehUnidadeGvc_);
  const unis = ler_('Unidades');
  const porCad = {}; unis.forEach(function (x) { if (x.cadastroId) porCad[x.cadastroId] = x; });
  const usados = {};
  cads.forEach(function (c) {
    const nome = nomeCadastro_(c), ativo = !!c.ativo;
    let x = porCad[c.id];
    if (!x) x = unis.filter(function (y) { return !y.cadastroId && !usados[y.id] && semAcento_(y.nome) === semAcento_(nome); })[0];
    if (!x) { x = inserir_('Unidades', { nome: nome, ativo: ativo, cadastroId: c.id }, u, 'mapa', nome); usados[x.id] = 1; return; }
    usados[x.id] = 1;
    const mud = {};
    if (String(x.cadastroId || '') !== c.id) mud.cadastroId = c.id;
    if (String(x.nome) !== nome) mud.nome = nome;
    if (!!x.ativo !== ativo) mud.ativo = ativo;
    if (Object.keys(mud).length) atualizar_('Unidades', x.id, mud, u, 'mapa', { registroNome: nome });
  });
  // cadastro que deixou de ser "Unidade GVC" (ou foi excluído) → unidade inativa
  const ids = {}; cads.forEach(function (c) { ids[c.id] = 1; });
  ler_('Unidades').forEach(function (x) {
    if (x.cadastroId && !ids[x.cadastroId] && x.ativo) atualizar_('Unidades', x.id, { ativo: false }, u, 'mapa', { registroNome: String(x.nome) });
  });
}

/** Exclusão de um cadastro Unidade GVC: a unidade sai junto se não tiver uso; senão, bloqueia. */
function liberarUnidadeDoCadastro_(cadId, u) {
  const x = ler_('Unidades').filter(function (y) { return String(y.cadastroId) === String(cadId); })[0];
  if (!x) return { ok: true };
  const usos = usos_('Unidades', x.id);
  if (usos.length) return respostaEmUso_('Unidades', 'Unidade ' + x.nome, usos);
  return excluir_('Unidades', x.id, u, 'mapa');
}

/* ---------------- migração (ESQUEMA 7) ---------------- */
function migrarUnidades_() {
  migrarCabecalho_('Unidades');
  // os dados que já existem: "Retec S/A" → Retec S/A SF, "Retec Oeste" → Retec Oeste Barreiras
  const renomear = { 'RETEC S/A': 'Retec S/A SF', 'RETEC OESTE': 'Retec Oeste Barreiras' };
  ler_('Unidades').forEach(function (x) {
    const novo = renomear[semAcento_(x.nome)];
    if (novo && !x.cadastroId) atualizar_('Unidades', x.id, { nome: novo }, null, 'mapa');
  });
  const cads = function () { return ler_('Cadastros'); };
  UNIDADES_GVC.forEach(function (nome) {
    let c = cads().filter(function (y) { return semAcento_(nomeCadastro_(y)) === semAcento_(nome); })[0];
    // o cadastro "RETEC" (Unidade GVC, Simões Filho) passa a ser a Retec S/A SF
    if (!c && nome === 'Retec S/A SF') {
      c = cads().filter(function (y) { return ehUnidadeGvc_(y) && /^RETEC( S\/?A)?$/.test(semAcento_(nomeCadastro_(y))); })[0];
      if (c) atualizar_('Cadastros', c.id, { nome: nome }, null, 'mapa', { registroNome: nome });
    }
    if (c) {
      if (!ehUnidadeGvc_(c)) atualizar_('Cadastros', c.id, { tipos: ['empresa'].concat(separar_(c.tipos)).join(', ') }, null, 'mapa', { registroNome: nome });
      if (!c.ativo) atualizar_('Cadastros', c.id, { ativo: true }, null, 'mapa', { registroNome: nome });
    } else {
      const novo = inserir_('Cadastros', { nome: nome, tipos: 'empresa', ativo: true }, null, 'mapa', nome);
      const l = inserir_('Locais', { cadastroId: novo.id, nome: 'Principal' }, null, null);
      inserir_('CadastroLocais', { cadastroId: novo.id, localId: l.id, situacao: 'ativo' }, null, null);
    }
  });
  sincronizarUnidades_(null);
  HIST_BUF_.push([new Date(), '', 'sistema', 'mapa', 'Unidades', '', '', 'migrou', '', '', '',
    'Unidades do grupo GVC passaram a ser cadastros "Unidade GVC" no Mapa (' + UNIDADES_GVC.length + ' unidades).']);
}
