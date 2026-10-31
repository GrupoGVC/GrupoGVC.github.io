/* =====================================================================
 * Mapa Operacional — cadastros (Cadastros + Locais + CadastroLocais), resíduos e preços
 * (CadastroResiduos), equipamentos (CadastroEquipamentos) e os catálogos Residuos/Equipamentos.
 * A tela do Mapa ainda trabalha com um "ponto" por cadastro: o local principal do cadastro.
 * ===================================================================== */

const MAPA_CATALOGOS = {
  residuos:     { tabela: 'Residuos',     filha: 'CadastroResiduos',     col: 'residuoId',     rotulo: 'Resíduos' },
  equipamentos: { tabela: 'Equipamentos', filha: 'CadastroEquipamentos', col: 'equipamentoId', rotulo: 'Equipamentos' },
};
const CAMPOS_CADASTRO = { codigoUplog: 'codigoUplog', tipos: 'tipos', nome: 'nome', razaoSocial: 'razaoSocial', cat: 'categoria', cnpj: 'cnpj',
                          contatoNome: 'contatoNome', telefones: 'telefones', emails: 'emails', obs: 'obs' };
const CAMPOS_LOCAL = ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'lat', 'lng'];

function localPrincipal_(cadId) {
  const l = onde_('Locais', 'cadastroId', cadId);
  return l.filter(function (x) { return x.ativo; })[0] || l[0] || null;
}
function nomesPorId_(tabela) {
  const m = {}; ler_(tabela).forEach(function (x) { m[x.id] = String(x.nome); }); return m;
}
function idPorNome_(tabela, nome) {
  const alvo = semAcento_(nome);
  const r = ler_(tabela).filter(function (x) { return semAcento_(x.nome) === alvo; });
  return (r.filter(function (x) { return x.ativo; })[0] || r[0] || {}).id || null;
}

function pontoDe_(c, nomesRes, nomesEq) {
  const loc = localPrincipal_(c.id) || {};
  const p = {
    id: c.id, ativo: c.ativo, codigoUplog: String(c.codigoUplog || ''), tipos: separar_(c.tipos), nome: String(c.nome || ''),
    razaoSocial: String(c.razaoSocial || ''), cat: String(c.categoria || ''), cnpj: String(c.cnpj || ''), contatoNome: String(c.contatoNome || ''),
    telefones: String(c.telefones || '').split(/\s*;\s*/).filter(String), emails: String(c.emails || '').split(/\s*;\s*/).filter(String),
    obs: String(c.obs || ''), cadastroPrincipalId: String(c.cadastroPrincipalId || ''), localId: loc.id || '',
    residuos: [], precos: {}, naturezas: {}, equipamentos: []
  };
  p.tipo = p.tipos[0] || '';
  CAMPOS_LOCAL.forEach(function (k) { p[k] = loc[k] === undefined ? '' : (k === 'lat' || k === 'lng' ? loc[k] : String(loc[k])); });
  p.gmaps = p.lat !== '' && p.lng !== '' ? 'https://maps.google.com/?q=' + p.lat + ',' + p.lng : '';
  onde_('CadastroResiduos', 'cadastroId', c.id).forEach(function (r) {
    const n = nomesRes[r.residuoId]; if (!n) return;
    p.residuos.push(n);
    if (r.precoKg !== '' && r.precoKg != null) p.precos[n] = Number(r.precoKg);
    if (r.natureza) p.naturezas[n] = String(r.natureza);
  });
  onde_('CadastroEquipamentos', 'cadastroId', c.id).forEach(function (r) { if (nomesEq[r.equipamentoId]) p.equipamentos.push(nomesEq[r.equipamentoId]); });
  const a = auditoria_(c); Object.keys(a).forEach(function (k) { p[k] = a[k]; });
  return p;
}

const MAPA = {
  listar: function () {
    const nr = nomesPorId_('Residuos'), ne = nomesPorId_('Equipamentos');
    return { ok: true, pontos: ler_('Cadastros').map(function (c) { return pontoDe_(c, nr, ne); }) };
  },
  lista: function (nome) {
    const cfg = MAPA_CATALOGOS[nome];
    if (!cfg) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lista desconhecida.' };
    const todos = ler_(cfg.tabela);
    return { ok: true, list: todos.filter(function (x) { return x.ativo; }).map(function (x) { return String(x.nome); }),
             inativos: todos.filter(function (x) { return !x.ativo; }).map(function (x) { return String(x.nome); }) };
  },

  upsert: function (p, u) {
    if (!p || !p.id) return { ok: false, erro: 'dados_invalidos', mensagem: 'Cadastro sem identificador.' };
    let cad = porId_('Cadastros', p.id) || ler_('Cadastros').filter(function (x) { return String(x.idOrigem) === String(p.id); })[0];
    const campos = {};
    Object.keys(CAMPOS_CADASTRO).forEach(function (k) { if (k in p) campos[CAMPOS_CADASTRO[k]] = p[k]; });
    if (Array.isArray(campos.tipos)) campos.tipos = campos.tipos.join(', ');
    const nome = String(p.nome || p.razaoSocial || 'Sem nome');
    let novo = false;
    if (!cad) {
      novo = true;
      campos.idOrigem = /^CAD-/.test(String(p.id)) ? '' : String(p.id);
      cad = inserir_('Cadastros', campos, u, 'mapa', nome);
    } else {
      atualizar_('Cadastros', cad.id, campos, u, 'mapa', { registroNome: nome });
    }
    const id = cad.id;
    const opc = { tabela: 'Cadastros', registroId: id, registroNome: nome };
    // local principal
    const camposLocal = {};
    CAMPOS_LOCAL.forEach(function (k) { if (k in p) camposLocal[k] = p[k] === null ? '' : p[k]; });
    const loc = localPrincipal_(id);
    if (!loc) {
      const l = inserir_('Locais', Object.assign({ cadastroId: id, nome: 'Principal' }, camposLocal), u, null);
      inserir_('CadastroLocais', { cadastroId: id, localId: l.id, situacao: 'ativo' }, u, null);
      hist_(u, 'mapa', 'Cadastros', id, nome, novo ? 'criou' : 'alterou', 'Endereço / localização', '', resumo_('Locais', l), '');
    } else {
      atualizar_('Locais', loc.id, camposLocal, u, 'mapa', Object.assign({ prefixoCampo: 'Local · ' }, opc));
    }
    // resíduos e preços
    if (Array.isArray(p.residuos)) sincronizarResiduos_(id, p, u, opc, novo);
    // equipamentos
    if (Array.isArray(p.equipamentos)) sincronizarEquipamentos_(id, p.equipamentos, u, opc, novo);
    const nr = nomesPorId_('Residuos'), ne = nomesPorId_('Equipamentos');
    return { ok: true, id: id, ponto: pontoDe_(porId_('Cadastros', id), nr, ne) };
  },

  apagar: function (id, u) {
    const cad = porId_('Cadastros', id) || ler_('Cadastros').filter(function (x) { return String(x.idOrigem) === String(id); })[0];
    if (!cad) return { ok: true };
    return excluir_('Cadastros', cad.id, u, 'mapa');
  },
  inativar: function (id, u) { if (!porId_('Cadastros', id)) return naoAchou_(); inativar_('Cadastros', id, u, 'mapa'); return { ok: true }; },
  reativar: function (id, u) { if (!porId_('Cadastros', id)) return naoAchou_(); reativar_('Cadastros', id, u, 'mapa'); return { ok: true }; },

  listaAdd: function (nome, valor, u) {
    const cfg = MAPA_CATALOGOS[nome]; if (!cfg) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lista desconhecida.' };
    const v = String(valor || '').trim().replace(/\s+/g, ' ');
    if (v) {
      const existente = idPorNome_(cfg.tabela, v);
      if (!existente) inserir_(cfg.tabela, { nome: v }, u, 'mapa', v);
      else if (!porId_(cfg.tabela, existente).ativo) reativar_(cfg.tabela, existente, u, 'mapa');
    }
    return MAPA.lista(nome);
  },
  listaDel: function (nome, valor, u) {
    const cfg = MAPA_CATALOGOS[nome]; if (!cfg) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lista desconhecida.' };
    const id = idPorNome_(cfg.tabela, valor);
    if (id) { const r = excluir_(cfg.tabela, id, u, 'mapa'); if (!r.ok) return r; }
    return MAPA.lista(nome);
  },
  listaInativar: function (nome, valor, u) {
    const cfg = MAPA_CATALOGOS[nome]; if (!cfg) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lista desconhecida.' };
    const id = idPorNome_(cfg.tabela, valor);
    if (id) inativar_(cfg.tabela, id, u, 'mapa');
    return MAPA.lista(nome);
  },
  // Só preenche um catálogo vazio (primeiro uso).
  listaSet: function (nome, list, u) {
    const cfg = MAPA_CATALOGOS[nome]; if (!cfg) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lista desconhecida.' };
    if (!ler_(cfg.tabela).length) (list || []).forEach(function (v) { if (String(v).trim()) inserir_(cfg.tabela, { nome: String(v).trim() }, u, 'mapa', String(v)); });
    return MAPA.lista(nome);
  },
};
function naoAchou_() { return { ok: false, erro: 'dados_invalidos', mensagem: 'Cadastro não encontrado. Atualize a página.' }; }

function garantirNoCatalogo_(tabela, nome, u) {
  const id = idPorNome_(tabela, nome);
  if (id) return id;
  return inserir_(tabela, { nome: String(nome).trim() }, u, 'mapa', String(nome)).id;
}
function fmtPreco_(v) { return v === '' || v == null ? 'sem preço' : 'R$ ' + String(Number(v)).replace('.', ',') + '/kg'; }

function sincronizarResiduos_(cadId, p, u, opc, novo) {
  const atuais = onde_('CadastroResiduos', 'cadastroId', cadId);
  const nomes = nomesPorId_('Residuos');
  const desejados = {};
  p.residuos.forEach(function (n) {
    const rid = garantirNoCatalogo_('Residuos', n, u);
    const preco = p.precos && p.precos[n] != null && p.precos[n] !== '' ? Number(p.precos[n]) : '';
    desejados[rid] = { preco: preco, natureza: (p.naturezas && p.naturezas[n]) || '' , nome: n };
  });
  atuais.forEach(function (a) {
    const d = desejados[a.residuoId];
    const nomeRes = nomes[a.residuoId] || a.residuoId;
    if (!d) {
      aba_('CadastroResiduos').deleteRow(porId_('CadastroResiduos', a.id)._linha); limparCache_('CadastroResiduos');
      hist_(u, 'mapa', 'Cadastros', cadId, opc.registroNome, 'alterou', 'Resíduo removido', nomeRes + ' (' + fmtPreco_(a.precoKg) + ')', '', '');
    } else {
      atualizar_('CadastroResiduos', a.id, { precoKg: d.preco, natureza: d.natureza }, u, 'mapa',
                 Object.assign({ prefixoCampo: nomeRes + ' · ' }, opc));
      delete desejados[a.residuoId];
    }
  });
  Object.keys(desejados).forEach(function (rid) {
    const d = desejados[rid];
    inserir_('CadastroResiduos', { cadastroId: cadId, residuoId: rid, precoKg: d.preco, natureza: d.natureza }, u, null);
    hist_(u, 'mapa', 'Cadastros', cadId, opc.registroNome, 'alterou', 'Resíduo incluído', '', d.nome + ' (' + fmtPreco_(d.preco) + (d.natureza ? ', ' + d.natureza : '') + ')', '');
  });
}
function sincronizarEquipamentos_(cadId, lista, u, opc, novo) {
  const atuais = onde_('CadastroEquipamentos', 'cadastroId', cadId);
  const nomes = nomesPorId_('Equipamentos');
  const desejados = {};
  lista.forEach(function (n) { if (String(n).trim()) desejados[garantirNoCatalogo_('Equipamentos', n, u)] = n; });
  const antes = atuais.map(function (a) { return nomes[a.equipamentoId] || a.equipamentoId; }).sort().join('; ');
  atuais.forEach(function (a) {
    if (!desejados[a.equipamentoId]) { aba_('CadastroEquipamentos').deleteRow(porId_('CadastroEquipamentos', a.id)._linha); limparCache_('CadastroEquipamentos'); }
    else delete desejados[a.equipamentoId];
  });
  Object.keys(desejados).forEach(function (eid) { inserir_('CadastroEquipamentos', { cadastroId: cadId, equipamentoId: eid }, u, null); });
  const nomes2 = nomesPorId_('Equipamentos');
  const depois = onde_('CadastroEquipamentos', 'cadastroId', cadId).map(function (a) { return nomes2[a.equipamentoId]; }).sort().join('; ');
  if (antes !== depois) hist_(u, 'mapa', 'Cadastros', cadId, opc.registroNome, 'alterou', 'Equipamentos', antes, depois, '');
}
