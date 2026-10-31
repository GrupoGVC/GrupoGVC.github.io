/* =====================================================================
 * Controle de Destinação — Lancamentos e LocacaoMensal na planilha central.
 * Destinadores, resíduos e preços vêm dos cadastros do Mapa (Cadastros + CadastroResiduos).
 * Na tela, o resíduo aparece em MAIÚSCULAS (nome do catálogo); na planilha fica o código (RES-…).
 * ===================================================================== */

// Nomes que a equipe sempre usou no Controle e que no catálogo do Mapa têm outro nome.
const RESIDUO_APELIDOS = { 'PAPELAO': 'Papel / Papelão', 'METAL': 'Metal / Sucata', 'PERIGOSO': 'Classe I – Perigoso', 'ELETRONICO': 'Eletrônico (REEE)' };
function residuoPorTexto_(txt) {
  const k = semAcento_(txt);
  if (!k) return null;
  let id = idPorNome_('Residuos', txt);
  if (!id && RESIDUO_APELIDOS[k]) id = idPorNome_('Residuos', RESIDUO_APELIDOS[k]);
  return id;
}
function nomeResiduoControle_(nomes, id) { return nomes[id] ? String(nomes[id]).toUpperCase() : ''; }

function destinadoresControle_() {
  const nomesRes = nomesPorId_('Residuos');
  const usados = {};
  ler_('Lancamentos').forEach(function (l) { usados[l.destinadorId] = true; });
  return ler_('Cadastros').filter(function (c) {
    const t = separar_(c.tipos);
    return t.indexOf('destinador') >= 0 || t.indexOf('reciclador') >= 0 || usados[c.id];
  }).map(function (c) {
    const t = separar_(c.tipos);
    const rec = t.indexOf('reciclador') >= 0, des = t.indexOf('destinador') >= 0;
    const precos = {}, naturezas = {};
    onde_('CadastroResiduos', 'cadastroId', c.id).forEach(function (r) {
      if (r.precoKg === '' || r.precoKg == null) return;
      const k = nomeResiduoControle_(nomesRes, r.residuoId); if (!k) return;
      precos[k] = Number(r.precoKg);
      naturezas[k] = String(r.natureza || (rec && !des ? 'receita' : 'custo'));
    });
    const nats = Object.keys(naturezas).map(function (k) { return naturezas[k]; });
    const tipo = rec && !des ? 'receita' : (des && !rec ? 'custo' : (nats.length && nats.every(function (n) { return n === 'receita'; }) ? 'receita' : 'custo'));
    const loc = localPrincipal_(c.id) || {};
    return { id: c.id, mapaId: c.id, nome: String(c.nome || c.razaoSocial || c.id), tipo: tipo, ativo: c.ativo && (rec || des),
             precos: precos, naturezas: naturezas, cidade: [loc.cidade, loc.uf].filter(function (x) { return x; }).join('/'),
             foraDoMapa: !(rec || des) };
  });
}

function lancPublico_(r, nomesRes) {
  const kg = r.kg === '' || r.kg === null ? null : num_(r.kg);
  const preco = num_(r.preco);
  const fixo = r.valorFixo === '' || r.valorFixo === null ? null : num_(r.valorFixo);
  let valor = r.valor === '' || r.valor === null ? null : num_(r.valor);
  if (valor === null) valor = fixo !== null ? fixo : Math.round((kg || 0) * preco * 100) / 100;
  const data = dataTexto_(r.data);
  const o = { id: r.id, data: data, mes: mesTexto_(r.mes) || data.slice(0, 7), mtr: String(r.mtr || '').trim(), ticket: String(r.ticket || '').trim(),
    destinador: String(r.destinadorId || ''), gerador: String(r.gerador || ''), origem: String(r.origem || ''),
    residuo: nomeResiduoControle_(nomesRes, r.residuoId), residuoId: String(r.residuoId || ''),
    transportadora: String(r.transportadora || ''), placa: String(r.placa || '').toUpperCase(),
    kg: kg, preco: preco, valor: valor, obs: String(r.obs || ''), negocio: normNegocio_(r.negocio), unidadeId: String(r.unidadeId || '') };
  if (fixo !== null) o.valorFixo = fixo;
  const a = auditoria_(r); Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  return o;
}

function dados_(mes, u) {
  const nomesRes = nomesPorId_('Residuos');
  const lanc = ler_('Lancamentos').filter(function (r) { return r.ativo; }).map(function (r) { return lancPublico_(r, nomesRes); });
  let ultimo = '';
  lanc.forEach(function (l) { if (l.mes > ultimo) ultimo = l.mes; });
  if (!/^\d{4}-\d{2}$/.test(mes || '')) mes = ultimo || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM');
  const janela = [];
  for (let i = 0; i < MESES_JANELA; i++) janela.push(addMes_(mes, -i));
  const locacao = {};
  ler_('LocacaoMensal').forEach(function (r) {
    const m = mesTexto_(r.mes); if (!r.ativo || janela.indexOf(m) < 0 || !r.placa) return;
    (locacao[m] = locacao[m] || []).push({ id: r.id, tipo: String(r.tipo || ''), placa: String(r.placa).trim().toUpperCase(),
      fornecedor: String(r.fornecedor || ''), valor: num_(r.valor) });
  });
  const residuos = ler_('Residuos').filter(function (x) { return x.ativo; }).map(function (x) { return String(x.nome).toUpperCase(); }).sort();
  return { ok: true, usuario: { email: u.email, nome: u.nome, nivel: u.nivel }, mes: mes, ultimoMes: ultimo,
           destinadores: destinadoresControle_(), fonteDestinadores: 'mapa', residuos: residuos,
           lancamentos: lanc.filter(function (l) { return janela.indexOf(l.mes) >= 0; }), locacao: locacao };
}

function normNegocio_(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'RSS') return 'RSS';
  if (t.indexOf('IND') === 0) return 'Industrial';
  return '';
}
function acharLanc_(id) {
  return porId_('Lancamentos', id) || ler_('Lancamentos').filter(function (x) { return String(x.idOrigem) === String(id); })[0] || null;
}
function salvarLancamento_(l, u) {
  if (!l) return { ok: false, erro: 'dados_invalidos', mensagem: 'Lançamento vazio.' };
  const dest = porId_('Cadastros', l.destinador);
  if (!dest) return { ok: false, erro: 'dados_invalidos', mensagem: 'Destinador não encontrado no Mapa Operacional. Atualize a página.' };
  let residuoId = '';
  if (String(l.residuo || '').trim()) {
    residuoId = residuoPorTexto_(l.residuo);
    if (!residuoId) return { ok: false, erro: 'dados_invalidos', mensagem: 'O resíduo "' + l.residuo + '" não está no catálogo do Mapa Operacional. Escolha um da lista ou peça para cadastrá-lo no Mapa.' };
  }
  const data = dataTexto_(l.data);
  const campos = { data: data, mes: mesTexto_(l.mes) || data.slice(0, 7), mtr: String(l.mtr || '').trim(), ticket: String(l.ticket || '').trim(),
    destinadorId: dest.id, gerador: String(l.gerador || ''), origem: String(l.origem || ''), residuoId: residuoId,
    transportadora: String(l.transportadora || ''), placa: String(l.placa || '').toUpperCase(), kg: l.kg === null || l.kg === '' ? '' : num_(l.kg),
    preco: num_(l.preco), valorFixo: l.valorFixo === undefined || l.valorFixo === null || l.valorFixo === '' ? '' : num_(l.valorFixo),
    valor: num_(l.valor), negocio: normNegocio_(l.negocio), obs: String(l.obs || '') };
  const rotulo = (campos.mtr ? 'MTR ' + campos.mtr : 'sem MTR') + ' · ' + dest.nome;
  const atual = l.id ? acharLanc_(l.id) : null;
  if (atual) {
    if (!atual.ativo) campos.ativo = true;
    atualizar_('Lancamentos', atual.id, campos, u, 'destinacao', { registroNome: rotulo });
    return { ok: true, id: atual.id };
  }
  campos.idOrigem = l.id && !/^LAN-/.test(String(l.id)) ? String(l.id) : '';
  campos.unidadeId = u.unidades && u.unidades.length === 1 ? u.unidades[0] : '';
  const novo = inserir_('Lancamentos', campos, u, 'destinacao', rotulo);
  return { ok: true, id: novo.id };
}
// "Excluir" um lançamento só o tira das telas (fica inativo e no histórico).
function excluirLancamento_(id, u) {
  const atual = acharLanc_(id);
  if (atual && atual.ativo) atualizar_('Lancamentos', atual.id, { ativo: false }, u, 'destinacao',
    { registroNome: (atual.mtr ? 'MTR ' + atual.mtr : 'sem MTR') });
  return { ok: true };
}
function definirNegocioLote_(ids, negocio, u) {
  negocio = normNegocio_(negocio);
  if (!negocio) return { ok: false, erro: 'dados_invalidos', mensagem: 'Escolha RSS ou Industrial.' };
  let alt = 0;
  (ids || []).forEach(function (id) {
    const a = acharLanc_(id);
    if (a && atualizar_('Lancamentos', a.id, { negocio: negocio }, u, 'destinacao', { registroNome: a.mtr ? 'MTR ' + a.mtr : 'sem MTR' }).length) alt++;
  });
  return { ok: true, alterados: alt };
}
function salvarLocacao_(mes, veiculos, u) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return { ok: false, erro: 'dados_invalidos', mensagem: 'Mês inválido.' };
  const atuais = ler_('LocacaoMensal').filter(function (r) { return r.ativo && mesTexto_(r.mes) === mes; });
  const usados = {};
  (veiculos || []).filter(function (v) { return v.placa; }).forEach(function (v) {
    const placa = String(v.placa).trim().toUpperCase();
    const campos = { mes: mes, tipo: String(v.tipo || ''), placa: placa, fornecedor: String(v.fornecedor || ''), valor: num_(v.valor) };
    const a = atuais.filter(function (r) { return !usados[r.id] && String(r.placa).toUpperCase() === placa; })[0];
    if (a) { usados[a.id] = true; atualizar_('LocacaoMensal', a.id, campos, u, 'destinacao', { registroNome: placa + ' · ' + mes }); }
    else inserir_('LocacaoMensal', campos, u, 'destinacao', placa + ' · ' + mes);
  });
  atuais.forEach(function (r) { if (!usados[r.id]) atualizar_('LocacaoMensal', r.id, { ativo: false }, u, 'destinacao', { registroNome: String(r.placa) + ' · ' + mes }); });
  return { ok: true };
}
function salvarDestinador_() {
  return { ok: false, erro: 'dados_invalidos', mensagem: 'Destinadores, resíduos e preços são cadastrados no Mapa Operacional. Edite o cadastro por lá.' };
}
