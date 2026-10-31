/* =====================================================================
 * Frota — tipos de veículo, veículos, caixas estacionárias e locação mensal.
 * A programadora de cada unidade vê os itens da sua unidade (e os sem unidade definida).
 * O Controle de Destinação só consulta a locação (aba "Locação de veículos").
 * ===================================================================== */

const FROTA_TABELAS = { Veiculos: 1, Caixas: 1, TiposVeiculo: 1 };
const FROTA_LISTAS = {
  propriedade: ['Própria', 'Locada'],
  situacaoVeiculo: ['Em operação', 'Em manutenção', 'Parado', 'Devolvido'],
  situacaoCaixa: ['Na base', 'Em cliente', 'Em manutenção', 'Baixada'],
  categoriaCnh: ['A', 'B', 'C', 'D', 'E'],
  capacidadeCaixa: ['5', '30', '40'],
};
// Sugestões iniciais (a categoria de CNH deve ser conferida pela empresa; tudo é editável na tela Tipos de veículo).
const TIPOS_VEICULO_INICIAIS = [
  ['Roll-on', 'C', '30; 40'], ['Poliguindaste duplo', 'C', '5'], ['3/4 baú', 'C', ''], ['HR baú', 'B', ''],
  ['Sucção 10 m³', 'C', ''], ['Fiorino', 'B', ''], ['Baú', 'C', '']
];
const TIPO_VEICULO_APELIDOS = { 'ROLL ON': 'Roll-on', 'ROLL-ON': 'Roll-on', 'POLIGUINDASTE': 'Poliguindaste duplo', 'HR': 'HR baú', 'HR BAU': 'HR baú', 'BAU': 'Baú', 'FIORINO': 'Fiorino' };

/* ---------------- versão do esquema (migração automática da Fase 1) ---------------- */
const VERSAO_ESQUEMA = '4';
function nomeCaixa_(n) { n = String(n == null ? '' : n).trim(); return /^caixa/i.test(n) ? n : 'Caixa ' + n; }
function garantirEsquema_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('ESQUEMA') === VERSAO_ESQUEMA) return;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const v = Number(p.getProperty('ESQUEMA') || 1);
    if (v >= Number(VERSAO_ESQUEMA)) return;
    if (v < 2) { migrarFase1_(); p.setProperty('ESQUEMA', '2'); }
    if (v < 3) { migrarFase2_(); p.setProperty('ESQUEMA', '3'); }
    if (v < 4) { migrarFase3_(); p.setProperty('ESQUEMA', '4'); }
    gravarHistorico_();
  } finally { lock.releaseLock(); }
}

function migrarFase1_() {
  const agora = new Date();
  // 1. LocacaoMensal no formato novo (colunas por nome; preserva auditoria)
  const sh = aba_('LocacaoMensal');
  const cabNovo = colunas_('LocacaoMensal');
  const v = sh.getDataRange().getValues();
  const cabAtual = (v[0] || []).map(function (x) { return String(x).trim(); });
  if (cabAtual.join('|') !== cabNovo.join('|')) {
    const linhas = v.slice(1).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
      const o = {}; cabAtual.forEach(function (c, i) { if (c) o[c] = r[i]; });
      return cabNovo.map(function (c) { return c in o ? o[c] : ''; });
    });
    sh.clearContents();
    sh.getRange(1, 1, 1, cabNovo.length).setValues([cabNovo]).setFontWeight('bold').setBackground('#dcefe6');
    escreverLinhas_(sh, 'LocacaoMensal', 2, linhas);
    limparCache_('LocacaoMensal');
  }
  // 2. Listas da Frota
  const listas = ler_('Listas');
  Object.keys(FROTA_LISTAS).forEach(function (l) {
    FROTA_LISTAS[l].forEach(function (val, i) {
      if (!listas.some(function (x) { return x.lista === l && String(x.valor) === val; })) inserir_('Listas', { lista: l, valor: val, ordem: i + 1, ativo: true }, null, null);
    });
  });
  // 3. Tipos de veículo
  TIPOS_VEICULO_INICIAIS.forEach(function (t) {
    if (!idPorNome_('TiposVeiculo', t[0])) inserir_('TiposVeiculo', { nome: t[0], categoriaCnh: t[1], capacidadesCaixa: t[2], ativo: true }, null, null);
  });
  // 4. Veículos, caixas e locadoras a partir da locação que já existia
  const itens = ler_('LocacaoMensal').filter(function (r) { return !r.veiculoId && !r.caixaId && String(r.placa).trim(); });
  let ultimoMes = '';
  itens.forEach(function (r) { const m = mesTexto_(r.mes); if (m > ultimoMes) ultimoMes = m; });
  const locadoraDe = function (nome) {
    nome = String(nome || '').trim(); if (!nome) return '';
    const achou = ler_('Cadastros').filter(function (c) { return semAcento_(c.nome) === semAcento_(nome); })[0];
    if (achou) {
      if (separar_(achou.tipos).indexOf('fornecedor') < 0) atualizar_('Cadastros', achou.id, { tipos: separar_(achou.tipos).concat('fornecedor').join(', ') }, null, null);
      return achou.id;
    }
    const c = inserir_('Cadastros', { tipos: 'fornecedor', nome: nome, categoria: 'Locadora de veículos e caixas',
      obs: 'Criado a partir da locação de veículos do Controle de Destinação.', ativo: true }, null, null);
    return c.id;
  };
  const porPlaca = {}; // placa → {mes, row}
  itens.slice().sort(function (a, b) { return mesTexto_(a.mes) < mesTexto_(b.mes) ? -1 : 1; })
    .forEach(function (r) { porPlaca[String(r.placa).trim().toUpperCase()] = r; });
  const resumo = { veiculos: 0, caixas: 0, locadoras: 0 };
  const nLocadorasAntes = ler_('Cadastros').length;
  const idDe = {};
  Object.keys(porPlaca).forEach(function (placa) {
    const r = porPlaca[placa];
    const proprio = /retec/i.test(String(r.fornecedor));
    const locadoraId = proprio ? '' : locadoraDe(r.fornecedor);
    const ativoNoUltimo = itens.some(function (x) { return String(x.placa).trim().toUpperCase() === placa && mesTexto_(x.mes) === ultimoMes; });
    if (semAcento_(r.tipo) === 'CAIXA') {
      const cap = Number((String(r.placa).match(/\d+/) || [''])[0]) || '';
      const c = inserir_('Caixas', { unidadeId: '', numero: String(r.placa).trim(), capacidade: cap, propriedade: proprio ? 'Própria' : 'Locada',
        locadoraId: locadoraId, situacao: ativoNoUltimo ? 'Em cliente' : 'Baixada', cadastroAtualId: '',
        obs: 'Criada a partir da locação do Controle. Confira o número da caixa.', ativo: true }, null, null);
      idDe[placa] = { caixaId: c.id }; resumo.caixas++;
    } else {
      const nomeTipo = TIPO_VEICULO_APELIDOS[semAcento_(r.tipo)] || String(r.tipo || 'Baú').trim();
      let tipoId = idPorNome_('TiposVeiculo', nomeTipo);
      if (!tipoId) tipoId = inserir_('TiposVeiculo', { nome: nomeTipo, categoriaCnh: '', capacidadesCaixa: '', ativo: true }, null, null).id;
      const ve = inserir_('Veiculos', { unidadeId: '', placa: placa, tipoVeiculoId: tipoId, propriedade: proprio ? 'Própria' : 'Locada', locadoraId: locadoraId,
        modelo: '', ano: '', situacao: ativoNoUltimo ? 'Em operação' : 'Devolvido', obs: '', ativo: true }, null, null);
      idDe[placa] = { veiculoId: ve.id }; resumo.veiculos++;
    }
  });
  resumo.locadoras = ler_('Cadastros').length - nLocadorasAntes;
  // 5. Liga cada mês de locação ao veículo/caixa e à locadora (sem mexer em quem/quando foi lançado)
  const shL = aba_('LocacaoMensal');
  ler_('LocacaoMensal').forEach(function (r) {
    if (r.veiculoId || r.caixaId) return;
    const k = idDe[String(r.placa).trim().toUpperCase()]; if (!k) return;
    const locId = /retec/i.test(String(r.fornecedor)) ? '' : locadoraDe(r.fornecedor);
    const o = {}; colunas_('LocacaoMensal').forEach(function (c) { o[c] = r[c]; });
    o.veiculoId = k.veiculoId || ''; o.caixaId = k.caixaId || ''; o.locadoraId = locId;
    shL.getRange(r._linha, 1, 1, colunas_('LocacaoMensal').length).setValues([linhaDe_('LocacaoMensal', o)]);
  });
  limparCache_('LocacaoMensal');
  // 6. Acesso à Frota: mesmo nível que a pessoa já tinha no Controle (a locação ficava lá)
  ler_('Usuarios').forEach(function (us) {
    const mods = onde_('UsuarioModulos', 'usuarioId', us.id);
    if (mods.some(function (m) { return m.modulo === 'frota'; })) return;
    const dest = mods.filter(function (m) { return m.modulo === 'destinacao'; })[0];
    const nivel = simNao_(us.adminPortal) ? 'admin' : (dest ? dest.nivel : '');
    if (nivel) inserir_('UsuarioModulos', { usuarioId: us.id, modulo: 'frota', nivel: nivel }, null, null);
  });
  HIST_BUF_.push([agora, '', 'sistema', 'frota', '', '', '', 'migrou', '', '', '',
    'Fase 1 (Frota): veículos, caixas e locadoras criados a partir da locação mensal: ' + JSON.stringify(resumo)]);
  return resumo;
}

/* ---------------- leitura ---------------- */
function veUnidade_(u, unidadeId) {
  if (!unidadeId || u.adminPortal || !u.unidades || !u.unidades.length) return true;
  return u.unidades.indexOf(String(unidadeId)) >= 0;
}
function unidadesDoUsuario_(u) {
  return unidadesLista_().filter(function (x) { return veUnidade_(u, x.id); });
}
function publico_(nome, r) {
  const o = {};
  colunas_(nome).forEach(function (c) { if (AUDITORIA.indexOf(c) < 0) o[c] = r[c] instanceof Date ? isoMomento_(r[c]) : r[c]; });
  o.ativo = r.ativo !== false;
  const a = auditoria_(r); Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  return o;
}
function listaValores_(lista) {
  return ler_('Listas').filter(function (x) { return x.lista === lista && x.ativo; })
    .sort(function (a, b) { return Number(a.ordem) - Number(b.ordem); }).map(function (x) { return String(x.valor); });
}
function frotaDados_(u) {
  const veis = ler_('Veiculos').filter(function (r) { return veUnidade_(u, r.unidadeId); }).map(function (r) { return publico_('Veiculos', r); });
  const cxs = ler_('Caixas').filter(function (r) { return veUnidade_(u, r.unidadeId); }).map(function (r) { return publico_('Caixas', r); });
  const visiveis = {}; veis.forEach(function (x) { visiveis[x.id] = 1; }); cxs.forEach(function (x) { visiveis[x.id] = 1; });
  const locacao = ler_('LocacaoMensal').filter(function (r) { return r.ativo && (visiveis[r.veiculoId] || visiveis[r.caixaId]); })
    .map(function (r) { const o = publico_('LocacaoMensal', r); o.mes = mesTexto_(r.mes); o.valor = num_(r.valor); return o; });
  const cadastros = ler_('Cadastros').filter(function (c) { return c.ativo; })
    .map(function (c) { return { id: c.id, nome: String(c.nome || c.razaoSocial || c.id), tipos: separar_(c.tipos) }; })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  const usoTipo = {}; ler_('Veiculos').forEach(function (v) { usoTipo[v.tipoVeiculoId] = (usoTipo[v.tipoVeiculoId] || 0) + 1; });
  return { ok: true,
    unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(),
    tipos: ler_('TiposVeiculo').map(function (r) { const o = publico_('TiposVeiculo', r); o.veiculos = usoTipo[r.id] || 0; return o; }),
    veiculos: veis, caixas: cxs, locacao: locacao,
    locadoras: cadastros.filter(function (c) { return c.tipos.indexOf('fornecedor') >= 0; }),
    cadastros: cadastros,
    listas: { propriedade: listaValores_('propriedade'), situacaoVeiculo: listaValores_('situacaoVeiculo'), situacaoCaixa: listaValores_('situacaoCaixa'),
              categoriaCnh: listaValores_('categoriaCnh'), capacidadeCaixa: listaValores_('capacidadeCaixa') } };
}

/* ---------------- escrita ---------------- */
function erroDados_(msg) { return { ok: false, erro: 'dados_invalidos', mensagem: msg }; }
function validarFrota_(tabela, r, u) {
  const L = function (l) { return listaValores_(l); };
  if (tabela === 'TiposVeiculo') {
    r.nome = String(r.nome || '').trim(); if (!r.nome) return 'Informe o nome do tipo de veículo.';
    const dup = idPorNome_('TiposVeiculo', r.nome); if (dup && dup !== r.id) return 'Já existe o tipo "' + r.nome + '".';
    r.categoriaCnh = String(r.categoriaCnh || '').toUpperCase(); if (r.categoriaCnh && L('categoriaCnh').indexOf(r.categoriaCnh) < 0) return 'Categoria de CNH inválida.';
    r.capacidadesCaixa = separar_(r.capacidadesCaixa).join('; ');
    return '';
  }
  if (r.unidadeId && !veUnidade_(u, r.unidadeId)) return 'Você não tem acesso a esta unidade.';
  if (r.unidadeId && !porId_('Unidades', r.unidadeId)) return 'Unidade inválida.';
  if (L('propriedade').indexOf(r.propriedade) < 0) return 'Escolha se é própria ou locada.';
  if (r.propriedade === 'Locada' && !porId_('Cadastros', r.locadoraId)) return 'Escolha a locadora (cadastro de fornecedor no Mapa Operacional).';
  if (r.propriedade !== 'Locada') r.locadoraId = '';
  if (tabela === 'Veiculos') {
    r.placa = String(r.placa || '').replace(/[\s-]/g, '').toUpperCase(); if (!r.placa) return 'Informe a placa.';
    const dup = ler_('Veiculos').filter(function (x) { return String(x.placa).toUpperCase() === r.placa && x.id !== r.id; })[0];
    if (dup) return 'Já existe um veículo com a placa ' + r.placa + '.';
    if (!porId_('TiposVeiculo', r.tipoVeiculoId)) return 'Escolha o tipo de veículo.';
    if (L('situacaoVeiculo').indexOf(r.situacao) < 0) return 'Escolha a situação do veículo.';
  }
  if (tabela === 'Caixas') {
    r.numero = String(r.numero || '').trim(); if (!r.numero) return 'Informe o número da caixa.';
    const dup = ler_('Caixas').filter(function (x) { return semAcento_(x.numero) === semAcento_(r.numero) && x.id !== r.id; })[0];
    if (dup) return 'Já existe a caixa número ' + r.numero + '.';
    if (L('capacidadeCaixa').indexOf(String(r.capacidade)) < 0) return 'Escolha a capacidade da caixa.';
    if (L('situacaoCaixa').indexOf(r.situacao) < 0) return 'Escolha a situação da caixa.';
    if (r.cadastroAtualId && !porId_('Cadastros', r.cadastroAtualId)) return 'Local da caixa não encontrado no Mapa.';
  }
  return '';
}
function rotuloFrota_(tabela, r) {
  if (tabela === 'Veiculos') return r.placa;
  if (tabela === 'Caixas') return nomeCaixa_(r.numero) + (r.capacidade ? ' (' + r.capacidade + ' m³)' : '');
  return r.nome;
}
function frotaSalvar_(tabela, reg, u) {
  if (!FROTA_TABELAS[tabela]) return erroDados_('Tabela inválida.');
  const r = {}; TABELAS[tabela].colunas.forEach(function (c) { if (reg && c in reg) r[c] = reg[c]; });
  r.id = reg && reg.id ? String(reg.id) : '';
  const atual = r.id ? porId_(tabela, r.id) : null;
  if (r.id && !atual) return erroDados_('Registro não encontrado. Atualize a página.');
  if (atual && tabela !== 'TiposVeiculo' && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const erro = validarFrota_(tabela, r, u); if (erro) return erroDados_(erro);
  delete r.ativo;
  let id;
  if (atual) { delete r.id; atualizar_(tabela, atual.id, r, u, 'frota', { registroNome: rotuloFrota_(tabela, Object.assign({}, atual, r)) }); id = atual.id; }
  else { delete r.id; r.ativo = true; id = inserir_(tabela, r, u, 'frota', rotuloFrota_(tabela, r)).id; }
  return { ok: true, id: id, registro: publico_(tabela, porId_(tabela, id)) };
}
function frotaExcluir_(tabela, id, u) {
  if (!FROTA_TABELAS[tabela]) return erroDados_('Tabela inválida.');
  const atual = porId_(tabela, id); if (!atual) return { ok: true };
  if (tabela !== 'TiposVeiculo' && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  return excluir_(tabela, id, u, 'frota');
}
function frotaAtivo_(tabela, id, ativo, u) {
  if (!FROTA_TABELAS[tabela]) return erroDados_('Tabela inválida.');
  const atual = porId_(tabela, id); if (!atual) return erroDados_('Registro não encontrado.');
  if (tabela !== 'TiposVeiculo' && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  atualizar_(tabela, id, { ativo: !!ativo }, u, 'frota', { registroNome: rotuloFrota_(tabela, atual) });
  return { ok: true };
}
/** Locação do mês: itens = [{veiculoId|caixaId, valor}] = o que esteve em uso no mês. Só mexe nos itens que a pessoa vê. */
function frotaSalvarLocacao_(mes, itens, u) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return erroDados_('Mês inválido.');
  const nomesTipo = {}; ler_('TiposVeiculo').forEach(function (t) { nomesTipo[t.id] = String(t.nome); });
  const nomeCad = function (id) { const c = porId_('Cadastros', id); return c ? String(c.nome) : ''; };
  const chave = function (x) { return x.veiculoId ? 'V' + x.veiculoId : 'C' + x.caixaId; };
  const desejados = {};
  (itens || []).forEach(function (x) {
    const item = x.veiculoId ? porId_('Veiculos', x.veiculoId) : porId_('Caixas', x.caixaId);
    if (!item || !veUnidade_(u, item.unidadeId)) return;
    desejados[chave(x)] = { item: item, veiculoId: x.veiculoId || '', caixaId: x.caixaId || '', valor: num_(x.valor) };
  });
  const atuais = ler_('LocacaoMensal').filter(function (r) { return r.ativo && mesTexto_(r.mes) === mes; });
  atuais.forEach(function (r) {
    const k = chave(r);
    const item = r.veiculoId ? porId_('Veiculos', r.veiculoId) : porId_('Caixas', r.caixaId);
    if (item && !veUnidade_(u, item.unidadeId)) return; // de outra unidade: não mexe
    const d = desejados[k];
    const rot = String(r.placa) + ' · ' + mes;
    if (!d) { atualizar_('LocacaoMensal', r.id, { ativo: false }, u, 'frota', { registroNome: rot }); return; }
    atualizar_('LocacaoMensal', r.id, { valor: d.valor }, u, 'frota', { registroNome: rot });
    delete desejados[k];
  });
  Object.keys(desejados).forEach(function (k) {
    const d = desejados[k], it = d.item;
    const placa = d.veiculoId ? String(it.placa) : nomeCaixa_(it.numero);
    inserir_('LocacaoMensal', { unidadeId: it.unidadeId || '', mes: mes, veiculoId: d.veiculoId, caixaId: d.caixaId,
      tipo: d.veiculoId ? (nomesTipo[it.tipoVeiculoId] || '') : 'Caixa ' + (it.capacidade || '') + ' m³', placa: placa,
      locadoraId: it.locadoraId || '', fornecedor: it.locadoraId ? nomeCad(it.locadoraId) : 'Própria', valor: d.valor, ativo: true },
      u, 'frota', placa + ' · ' + mes);
  });
  return { ok: true };
}
