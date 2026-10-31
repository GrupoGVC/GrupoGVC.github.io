/* =====================================================================
 * Portal GVC — camada de dados (planilha central "Portal GVC — Base")
 * ---------------------------------------------------------------------
 * Regras que valem para todas as tabelas:
 *  • cada registro tem um código com prefixo (CAD-000001, LAN-000001…);
 *  • criadoEm/criadoPor/atualizadoEm/atualizadoPor em toda linha (hora do servidor);
 *  • toda criação/alteração/inativação/exclusão vai para a planilha "Portal GVC — Histórico",
 *    campo a campo (de → para);
 *  • nada que já foi usado é apagado: excluir_ confere os usos (REFERENCIAS) e, se houver,
 *    só deixa inativar.
 * ===================================================================== */

const AUDITORIA = ['criadoEm', 'criadoPor', 'atualizadoEm', 'atualizadoPor'];

// Estrutura das tabelas. texto = colunas guardadas como texto (zeros à esquerda, telefone, CNPJ…);
// numero = colunas numéricas; data = só a data; ocultas = escondidas na planilha.
const TABELAS = {
  Unidades:             { prefixo: 'UNI', colunas: ['id', 'nome', 'ativo'] },
  Usuarios:             { prefixo: 'USU', colunas: ['id', 'email', 'nome', 'adminPortal', 'unidades', 'ativo', 'senhaHash', 'salt', 'ultimoAcesso'],
                          texto: ['email', 'unidades', 'senhaHash', 'salt'], ocultas: ['senhaHash', 'salt'], momento: ['ultimoAcesso'] },
  UsuarioModulos:       { prefixo: 'UMO', colunas: ['id', 'usuarioId', 'modulo', 'nivel'] },
  Cadastros:            { prefixo: 'CAD', colunas: ['id', 'codigoUplog', 'tipos', 'nome', 'razaoSocial', 'categoria', 'cnpj', 'contatoNome',
                                                      'telefones', 'emails', 'obs', 'cadastroPrincipalId', 'idOrigem', 'ativo'],
                          texto: ['codigoUplog', 'cnpj', 'telefones', 'idOrigem'] },
  Locais:               { prefixo: 'LOC', colunas: ['id', 'cadastroId', 'nome', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'lat', 'lng', 'ativo'],
                          texto: ['numero', 'cep'], numero: ['lat', 'lng'] },
  CadastroLocais:       { prefixo: 'CLO', colunas: ['id', 'cadastroId', 'localId', 'situacao'] },
  Residuos:             { prefixo: 'RES', colunas: ['id', 'nome', 'ativo'] },
  CadastroResiduos:     { prefixo: 'CRE', colunas: ['id', 'cadastroId', 'residuoId', 'precoKg', 'natureza'], numero: ['precoKg'] },
  Equipamentos:         { prefixo: 'EQP', colunas: ['id', 'nome', 'ativo'] },
  CadastroEquipamentos: { prefixo: 'CEQ', colunas: ['id', 'cadastroId', 'equipamentoId'] },
  Lancamentos:          { prefixo: 'LAN', colunas: ['id', 'unidadeId', 'data', 'mes', 'mtr', 'ticket', 'destinadorId', 'gerador', 'origem', 'residuoId',
                                                      'transportadora', 'placa', 'kg', 'preco', 'valorFixo', 'valor', 'negocio', 'obs', 'idOrigem', 'ativo'],
                          texto: ['mes', 'mtr', 'ticket', 'placa', 'idOrigem'], numero: ['kg', 'preco', 'valorFixo', 'valor'], data: ['data'] },
  LocacaoMensal:        { prefixo: 'LOM', colunas: ['id', 'unidadeId', 'mes', 'tipo', 'placa', 'fornecedor', 'valor', 'ativo'],
                          texto: ['mes', 'placa'], numero: ['valor'] },
  Listas:               { prefixo: 'LIS', colunas: ['id', 'lista', 'valor', 'ordem', 'ativo'], numero: ['ordem'] },
  Parametros:           { prefixo: 'PRM', colunas: ['id', 'chave', 'valor', 'vigenciaInicio', 'descricao'], data: ['vigenciaInicio'] },
};

// Onde cada tabela é usada. Se houver uso, o registro não pode ser excluído — só inativado.
const REFERENCIAS = {
  Cadastros:    [['Lancamentos', 'destinadorId', 'lançamento(s) no Controle de Destinação'],
                 ['Cadastros', 'cadastroPrincipalId', 'cadastro(s) auxiliar(es) ligados a ele']],
  Residuos:     [['CadastroResiduos', 'residuoId', 'cadastro(s) no Mapa Operacional'],
                 ['Lancamentos', 'residuoId', 'lançamento(s) no Controle de Destinação']],
  Equipamentos: [['CadastroEquipamentos', 'equipamentoId', 'cadastro(s) no Mapa Operacional']],
  Unidades:     [['Lancamentos', 'unidadeId', 'lançamento(s) no Controle de Destinação'],
                 ['LocacaoMensal', 'unidadeId', 'veículo(s) na locação mensal']],
  Locais:       [['CadastroLocais', 'localId', 'cadastro(s) que usam este local']],
};
// Tabelas "filhas" que pertencem ao registro e saem junto quando ele é excluído (sem uso).
const FILHAS = {
  Cadastros: [['CadastroResiduos', 'cadastroId'], ['CadastroEquipamentos', 'cadastroId'], ['CadastroLocais', 'cadastroId'], ['Locais', 'cadastroId']],
};

const HISTORICO_COLUNAS = ['quando', 'usuarioEmail', 'usuarioNome', 'modulo', 'tabela', 'registroId', 'registroNome', 'acao', 'campo', 'de', 'para', 'detalhe'];

/* ---------------- planilhas ---------------- */
let BASE_SS_ = null, HIST_SS_ = null;
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function baseInstalada_() { return !!prop_('BASE_ID'); }
function base_() { return BASE_SS_ || (BASE_SS_ = SpreadsheetApp.openById(prop_('BASE_ID'))); }
function histSS_() { return HIST_SS_ || (HIST_SS_ = SpreadsheetApp.openById(prop_('HIST_ID'))); }
function colunas_(nome) { return TABELAS[nome].colunas.concat(AUDITORIA); }

function aba_(nome) {
  const ss = base_();
  let sh = ss.getSheetByName(nome);
  if (!sh) { sh = ss.insertSheet(nome); prepararAba_(sh, colunas_(nome), TABELAS[nome]); }
  return sh;
}
function abaHist_() {
  const ss = histSS_();
  let sh = ss.getSheetByName('Historico');
  if (!sh) { sh = ss.insertSheet('Historico'); prepararAba_(sh, HISTORICO_COLUNAS, { texto: ['registroId', 'de', 'para'], momento: ['quando'] }); }
  return sh;
}
function prepararAba_(sh, cab, cfg) {
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#dcefe6');
  sh.setFrozenRows(1);
  (cfg && cfg.ocultas || []).forEach(function (c) { sh.hideColumns(cab.indexOf(c) + 1); });
}
function formatoColuna_(nome, col) {
  const t = TABELAS[nome] || {};
  if (AUDITORIA.indexOf(col) >= 0 && /Em$/.test(col)) return 'dd/mm/yyyy hh:mm:ss';
  if ((t.momento || []).indexOf(col) >= 0) return 'dd/mm/yyyy hh:mm:ss';
  if ((t.data || []).indexOf(col) >= 0) return 'dd/mm/yyyy';
  if ((t.numero || []).indexOf(col) >= 0) return col === 'valor' || col === 'valorFixo' ? '#,##0.00' : '0.######';
  return '@';
}
// Escreve um bloco de linhas já com o formato certo de cada coluna.
function escreverLinhas_(sh, nome, inicio, linhas, cab) {
  if (!linhas.length) return;
  cab = cab || colunas_(nome);
  cab.forEach(function (c, j) { sh.getRange(inicio, j + 1, linhas.length, 1).setNumberFormat(formatoColuna_(nome, c)); });
  sh.getRange(inicio, 1, linhas.length, cab.length).setValues(linhas);
}

/* ---------------- leitura ---------------- */
const CACHE_TAB_ = {};
function ler_(nome) {
  if (CACHE_TAB_[nome]) return CACHE_TAB_[nome];
  const sh = aba_(nome);
  const cab = colunas_(nome);
  const n = sh.getLastRow();
  const vals = n > 1 ? sh.getRange(2, 1, n - 1, cab.length).getValues() : [];
  const out = [];
  vals.forEach(function (r, i) {
    if (String(r[0]).trim() === '') return;
    const o = { _linha: i + 2 };
    cab.forEach(function (c, j) { o[c] = r[j]; });
    o.id = String(o.id);
    if ('ativo' in o) o.ativo = simNao_(o.ativo);
    out.push(o);
  });
  CACHE_TAB_[nome] = out;
  return out;
}
function limparCache_(nome) { delete CACHE_TAB_[nome]; }
function porId_(nome, id) {
  id = String(id || '');
  const l = ler_(nome);
  for (let i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
}
function onde_(nome, col, valor) {
  valor = String(valor);
  return ler_(nome).filter(function (o) { return String(o[col]) === valor; });
}
function simNao_(v) { return v === true || ['SIM', 'S', 'TRUE', 'VERDADEIRO', '1'].indexOf(String(v).trim().toUpperCase()) >= 0; }

/* ---------------- códigos ---------------- */
function novoId_(nome) {
  const pre = TABELAS[nome].prefixo;
  const p = PropertiesService.getScriptProperties();
  let n = Number(p.getProperty('SEQ_' + pre) || 0);
  if (!n) { // primeira vez nesta tabela: parte do maior código existente
    ler_(nome).forEach(function (o) { const m = String(o.id).match(/-(\d+)$/); if (m) n = Math.max(n, Number(m[1])); });
  }
  n++;
  p.setProperty('SEQ_' + pre, String(n));
  return pre + '-' + ('00000' + n).slice(-6);
}

/* ---------------- escrita ---------------- */
function valorCelula_(nome, col, v) {
  const t = TABELAS[nome] || {};
  if (col === 'ativo') return v === undefined || v === true || simNao_(v) ? 'SIM' : 'NÃO';
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(String).filter(function (x) { return x.trim() !== ''; }).join('; ');
  if ((t.numero || []).indexOf(col) >= 0) return v === '' ? '' : Number(v);
  if ((t.data || []).indexOf(col) >= 0) return v instanceof Date ? v : (v ? paraData_(String(v).slice(0, 10)) : '');
  if ((t.texto || []).indexOf(col) >= 0) return String(v);
  return v;
}
function linhaDe_(nome, o) {
  return colunas_(nome).map(function (c) { return valorCelula_(nome, c, o[c]); });
}

/** Cria um registro. u = usuário (ou null para o sistema). */
function inserir_(nome, dados, u, modulo, registroNome) {
  const o = {};
  colunas_(nome).forEach(function (c) { o[c] = dados[c]; });
  o.id = dados.id || novoId_(nome);
  if ('ativo' in o && o.ativo === undefined) o.ativo = true;
  const agora = new Date();
  o.criadoEm = agora; o.criadoPor = quemEmail_(u);
  o.atualizadoEm = agora; o.atualizadoPor = quemEmail_(u);
  const sh = aba_(nome);
  escreverLinhas_(sh, nome, sh.getLastRow() + 1, [linhaDe_(nome, o)]);
  limparCache_(nome);
  if (modulo) hist_(u, modulo, nome, o.id, registroNome || o.nome || '', 'criou', '', '', '', resumo_(nome, o));
  return o;
}

/** Altera campos de um registro. Grava no histórico só o que mudou. Devolve a lista de mudanças. */
function atualizar_(nome, id, campos, u, modulo, opcoes) {
  opcoes = opcoes || {};
  const atual = porId_(nome, id);
  if (!atual) throw new Error('Registro ' + id + ' não encontrado em ' + nome + '.');
  const mudancas = [];
  Object.keys(campos).forEach(function (c) {
    if (colunas_(nome).indexOf(c) < 0 || c === 'id' || AUDITORIA.indexOf(c) >= 0) return;
    const de = textoComparavel_(nome, c, atual[c]);
    const para = textoComparavel_(nome, c, campos[c]);
    if (de !== para) mudancas.push({ campo: c, de: de, para: para });
  });
  if (!mudancas.length) return [];
  const novo = {};
  colunas_(nome).forEach(function (c) { novo[c] = c in campos ? campos[c] : atual[c]; });
  novo.atualizadoEm = new Date(); novo.atualizadoPor = quemEmail_(u);
  aba_(nome).getRange(atual._linha, 1, 1, colunas_(nome).length).setValues([linhaDe_(nome, novo)]);
  limparCache_(nome);
  if (modulo) {
    const regId = opcoes.registroId || id, regNome = opcoes.registroNome || atual.nome || '';
    mudancas.forEach(function (m) {
      const acao = m.campo === 'ativo' ? (m.para === 'NÃO' ? 'inativou' : 'reativou') : 'alterou';
      hist_(u, modulo, opcoes.tabela || nome, regId, regNome, acao, (opcoes.prefixoCampo || '') + rotuloCampo_(m.campo), m.de, m.para, '');
    });
  }
  return mudancas;
}
function textoComparavel_(nome, c, v) {
  const t = TABELAS[nome] || {};
  if (c === 'ativo') return v === undefined || v === true || simNao_(v) ? 'SIM' : 'NÃO';
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(String).filter(function (x) { return x.trim() !== ''; }).join('; ');
  if (v instanceof Date) return (t.data || []).indexOf(c) >= 0 ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  if ((t.numero || []).indexOf(c) >= 0) return v === '' ? '' : String(Number(v));
  if ((t.data || []).indexOf(c) >= 0) return String(v).slice(0, 10);
  return String(v).trim();
}
function inativar_(nome, id, u, modulo) { return atualizar_(nome, id, { ativo: false }, u, modulo); }
function reativar_(nome, id, u, modulo) { return atualizar_(nome, id, { ativo: true }, u, modulo); }

/** Onde o registro é usado: [{tabela, rotulo, n}]. */
function usos_(nome, id) {
  const out = [];
  (REFERENCIAS[nome] || []).forEach(function (ref) {
    const n = ler_(ref[0]).filter(function (o) {
      if (ref[0] === nome && o.id === id) return false;
      return String(o[ref[1]]) === String(id); // conta também os inativos: continuam sendo histórico
    }).length;
    if (n) out.push({ tabela: ref[0], rotulo: ref[2], n: n });
  });
  if (nome === 'Unidades') {
    const n = ler_('Usuarios').filter(function (o) { return String(o.unidades).split(/\s*[;,]\s*/).indexOf(id) >= 0; }).length;
    if (n) out.push({ tabela: 'Usuarios', rotulo: 'usuário(s) do portal', n: n });
  }
  return out;
}
function respostaEmUso_(nome, rotuloRegistro, usos) {
  const lista = usos.map(function (x) { return x.n + ' ' + x.rotulo; }).join(', ');
  return { ok: false, erro: 'em_uso', usos: usos,
    mensagem: 'Não é possível excluir "' + rotuloRegistro + '": já está em uso (' + lista + '). Você pode inativar: ' +
              'ele deixa de aparecer para novos registros e o histórico continua igual.' };
}

/** Exclui de verdade só se ninguém usa; senão devolve erro em_uso. */
function excluir_(nome, id, u, modulo) {
  const atual = porId_(nome, id);
  if (!atual) return { ok: true };
  const usos = usos_(nome, id);
  if (usos.length) return respostaEmUso_(nome, atual.nome || id, usos);
  (FILHAS[nome] || []).forEach(function (f) {
    onde_(f[0], f[1], id).sort(function (a, b) { return b._linha - a._linha; })
      .forEach(function (o) { aba_(f[0]).deleteRow(o._linha); });
    limparCache_(f[0]);
  });
  const atual2 = porId_(nome, id); // a linha pode ter mudado de lugar
  aba_(nome).deleteRow(atual2._linha);
  limparCache_(nome);
  hist_(u, modulo, nome, id, atual.nome || '', 'excluiu', '', '', '', 'Sem uso em nenhum módulo. Dados: ' + resumo_(nome, atual));
  return { ok: true };
}

/* ---------------- histórico ---------------- */
const HIST_BUF_ = [];
function hist_(u, modulo, tabela, registroId, registroNome, acao, campo, de, para, detalhe) {
  HIST_BUF_.push([new Date(), quemEmail_(u), u ? u.nome : 'sistema', modulo || '', tabela || '', String(registroId || ''),
                  String(registroNome || ''), acao, campo || '', de == null ? '' : String(de), para == null ? '' : String(para), detalhe || '']);
}
function gravarHistorico_() {
  if (!HIST_BUF_.length || !prop_('HIST_ID')) return;
  const sh = abaHist_();
  const ini = sh.getLastRow() + 1;
  sh.getRange(ini, 1, HIST_BUF_.length, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  sh.getRange(ini, 6, HIST_BUF_.length, 1).setNumberFormat('@');
  sh.getRange(ini, 10, HIST_BUF_.length, 2).setNumberFormat('@');
  sh.getRange(ini, 1, HIST_BUF_.length, HISTORICO_COLUNAS.length).setValues(HIST_BUF_.splice(0, HIST_BUF_.length));
}
function quemEmail_(u) { return u ? u.email : 'sistema'; }

const ROTULOS_CAMPOS = {
  nome: 'Nome', codigoUplog: 'Código UPLOG', tipos: 'Tipos', razaoSocial: 'Razão social', categoria: 'Categoria', cnpj: 'CNPJ',
  contatoNome: 'Contato', telefones: 'Telefones', emails: 'E-mails', obs: 'Observações', cadastroPrincipalId: 'Cadastro principal',
  logradouro: 'Logradouro', numero: 'Número', bairro: 'Bairro', cidade: 'Cidade', uf: 'UF', cep: 'CEP', lat: 'Latitude', lng: 'Longitude',
  ativo: 'Situação', precoKg: 'Preço por kg', natureza: 'Natureza', data: 'Data', mes: 'Mês', mtr: 'MTR', ticket: 'Ticket',
  destinadorId: 'Destinador', gerador: 'Gerador', origem: 'Origem', residuoId: 'Resíduo', transportadora: 'Transportadora', placa: 'Placa',
  kg: 'Peso (kg)', preco: 'Preço (R$/kg)', valorFixo: 'Valor fechado', valor: 'Valor', negocio: 'Tipo de negócio', tipo: 'Tipo',
  fornecedor: 'Fornecedor', email: 'E-mail', adminPortal: 'Admin do portal', unidades: 'Unidades', unidadeId: 'Unidade', nivel: 'Nível'
};
function rotuloCampo_(c) { return ROTULOS_CAMPOS[c] || c; }
function resumo_(nome, o) {
  const pular = { id: 1, _linha: 1, senhaHash: 1, salt: 1, criadoEm: 1, criadoPor: 1, atualizadoEm: 1, atualizadoPor: 1 };
  return colunas_(nome).filter(function (c) { return !pular[c] && o[c] !== '' && o[c] != null; })
    .map(function (c) { return rotuloCampo_(c) + ': ' + textoComparavel_(nome, c, o[c]); }).join(' · ').slice(0, 1500);
}

/* ---------------- utilidades ---------------- */
function tz_() { return 'America/Bahia'; }
function isoMomento_(v) { return v instanceof Date && !isNaN(v) ? Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm:ss") : String(v || ''); }
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
function separar_(v) { return String(v == null ? '' : v).split(/\s*[;,]\s*/).map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; }); }
function semAcento_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
// Nome de quem fez a alteração (o histórico guarda o e-mail; dados migrados guardam o nome).
let NOMES_USUARIOS_ = null;
function nomeDe_(quem) {
  quem = String(quem || '');
  if (quem.indexOf('@') < 0) return quem;
  if (!NOMES_USUARIOS_) { NOMES_USUARIOS_ = {}; ler_('Usuarios').forEach(function (x) { NOMES_USUARIOS_[String(x.email).toLowerCase()] = String(x.nome); }); }
  return NOMES_USUARIOS_[quem.toLowerCase()] || quem;
}
function auditoria_(o) {
  return { criadoEm: isoMomento_(o.criadoEm), criadoPor: nomeDe_(o.criadoPor), atualizadoEm: isoMomento_(o.atualizadoEm), atualizadoPor: nomeDe_(o.atualizadoPor) };
}
