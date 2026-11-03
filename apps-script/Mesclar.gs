/* =====================================================================
 * Portal GVC — mesclar cadastros duplicados do Mapa (só administrador do portal).
 * Ação 'mapa.mesclar' {de, para, simular}: tudo o que aponta para `de` passa a apontar para `para`
 * (lançamentos, solicitações, frota, locação, faturamento, preços...). Resíduos, equipamentos e
 * documentos padrão de `de` que `para` ainda não tem passam para `para`; os locais só passam se
 * `para` não tiver nenhum. Campos vazios de `para` são preenchidos com os de `de` e os tipos somados.
 * Depois `de` é excluído (ou inativado, se ainda sobrar algum uso).
 * ===================================================================== */

/** Troca, numa coluna, os valores iguais a `de` por `para` (uma gravação só). Devolve quantas linhas mudaram. */
function trocarNaColuna_(tabela, col, de, para, filtro) {
  const linhas = ler_(tabela).filter(function (o) { return String(o[col]) === String(de) && (!filtro || filtro(o)); });
  if (!linhas.length) return 0;
  const sh = aba_(tabela), c = colunas_(tabela).indexOf(col) + 1;
  if (linhas.length <= 30) {
    linhas.forEach(function (o) { sh.getRange(o._linha, c).setNumberFormat('@').setValue(String(para)); });
  } else {
    const ult = sh.getLastRow(), muda = {};
    linhas.forEach(function (o) { muda[o._linha] = 1; });
    const atual = sh.getRange(2, c, ult - 1, 1).getValues();
    sh.getRange(2, c, ult - 1, 1).setNumberFormat('@').setValues(atual.map(function (r, i) { return [muda[i + 2] ? String(para) : r[0]]; }));
  }
  limparCache_(tabela);
  return linhas.length;
}

function mesclarCadastros_(deId, paraId, simular, u) {
  deId = String(deId || ''); paraId = String(paraId || '');
  const de = porId_('Cadastros', deId), para = porId_('Cadastros', paraId);
  if (!de || !para) return { ok: false, erro: 'nao_encontrado', mensagem: 'Cadastro não encontrado.' };
  if (deId === paraId) return { ok: false, erro: 'dados_invalidos', mensagem: 'Escolha dois cadastros diferentes.' };
  if (onde_('Unidades', 'cadastroId', deId).length) return { ok: false, erro: 'dados_invalidos', mensagem: '"' + de.nome + '" é uma unidade do grupo GVC e não pode ser mesclado.' };
  const nomeDe = String(de.nome || de.id), nomePara = String(para.nome || para.id);

  // 1) referências
  const refs = [];
  REFERENCIAS.Cadastros.forEach(function (r) {
    if (r[0] === 'Unidades') return;
    const filtro = r[0] === 'Cadastros' ? function (o) { return o.id !== paraId && o.id !== deId; } : null;
    const n = ler_(r[0]).filter(function (o) { return String(o[r[1]]) === deId && (!filtro || filtro(o)); }).length;
    if (n) refs.push({ tabela: r[0], col: r[1], rotulo: r[2], n: n, filtro: filtro });
  });
  // texto guardado com o nome da locadora na locação mensal
  const locTexto = ler_('LocacaoMensal').filter(function (o) { return String(o.locadoraId) === deId && String(o.fornecedor) !== nomePara; }).map(function (o) { return o.id; });
  const textoLoc = locTexto.length;

  // 2) filhas
  const filhas = [];
  [['CadastroResiduos', function (o) { return String(o.residuoId); }, 'resíduo(s)'],
   ['CadastroEquipamentos', function (o) { return String(o.equipamentoId); }, 'equipamento(s)'],
   ['DocumentosPadrao', function (o) { return o.tipoDocumentoId + '|' + o.servico; }, 'documento(s) padrão']].forEach(function (f) {
    const ja = {}; onde_(f[0], 'cadastroId', paraId).forEach(function (o) { ja[f[1](o)] = 1; });
    const mover = onde_(f[0], 'cadastroId', deId).filter(function (o) { return !ja[f[1](o)]; });
    if (mover.length) filhas.push({ tabela: f[0], rotulo: f[2], ids: mover.map(function (o) { return o.id; }) });
  });
  const locaisPara = onde_('CadastroLocais', 'cadastroId', paraId).length;
  const moverLocais = !locaisPara && onde_('CadastroLocais', 'cadastroId', deId).length > 0;

  // 3) campos vazios de `para` e tipos
  const campos = {};
  const tipos = separar_(para.tipos); separar_(de.tipos).forEach(function (t) { if (tipos.indexOf(t) < 0) tipos.push(t); });
  if (tipos.join(', ') !== separar_(para.tipos).join(', ')) campos.tipos = tipos.join(', ');
  ['codigoUplog', 'razaoSocial', 'categoria', 'cnpj', 'contatoNome', 'telefones', 'emails'].forEach(function (c) {
    if (String(para[c] || '').trim() === '' && String(de[c] || '').trim() !== '') campos[c] = de[c];
  });
  const nota = 'Mesclado com "' + nomeDe + '" (' + deId + ') em ' + dataTexto_(new Date()) + '.';
  campos.obs = [String(para.obs || '').trim(), String(de.obs || '').trim() ? 'Obs. de "' + nomeDe + '": ' + String(de.obs).trim() : '', nota].filter(String).join('\n');
  if (!para.ativo) campos.ativo = true;

  const resumo = {
    de: { id: deId, nome: nomeDe }, para: { id: paraId, nome: nomePara },
    referencias: refs.map(function (r) { return { tabela: r.tabela, rotulo: r.rotulo, n: r.n }; }),
    textoLocacao: textoLoc, filhas: filhas.map(function (f) { return { tabela: f.tabela, rotulo: f.rotulo, n: f.ids.length }; }),
    locais: moverLocais ? 'passam para ' + nomePara : (locaisPara ? 'ficam os de ' + nomePara : 'nenhum'),
    campos: Object.keys(campos).filter(function (c) { return c !== 'obs'; })
  };
  if (simular) return { ok: true, simulacao: true, resumo: resumo };

  // grava
  refs.forEach(function (r) { trocarNaColuna_(r.tabela, r.col, deId, paraId, r.filtro); });
  if (textoLoc) { // fornecedor guardado como texto nos meses de locação passa a ter o nome que fica
    const sh = aba_('LocacaoMensal'), c = colunas_('LocacaoMensal').indexOf('fornecedor') + 1;
    ler_('LocacaoMensal').filter(function (o) { return locTexto.indexOf(o.id) >= 0; }).forEach(function (o) { sh.getRange(o._linha, c).setValue(nomePara); });
    limparCache_('LocacaoMensal');
  }
  filhas.forEach(function (f) {
    const sh = aba_(f.tabela), c = colunas_(f.tabela).indexOf('cadastroId') + 1;
    ler_(f.tabela).filter(function (o) { return f.ids.indexOf(o.id) >= 0; }).forEach(function (o) { sh.getRange(o._linha, c).setValue(paraId); });
    limparCache_(f.tabela);
  });
  if (moverLocais) { trocarNaColuna_('CadastroLocais', 'cadastroId', deId, paraId); trocarNaColuna_('Locais', 'cadastroId', deId, paraId); }
  atualizar_('Cadastros', paraId, campos, u, 'mapa');
  hist_(u, 'mapa', 'Cadastros', paraId, nomePara, 'mesclou', '', deId, paraId,
    'Recebeu de "' + nomeDe + '" (' + deId + '): ' + (refs.map(function (r) { return r.n + ' ' + r.rotulo; }).concat(filhas.map(function (f) { return f.ids.length + ' ' + f.rotulo; })).join('; ') || 'nenhum uso') + '.');
  limparCache_('Cadastros');
  const sobra = usos_('Cadastros', deId).filter(function (x) { return x.tabela !== 'Unidades'; });
  let fim;
  if (sobra.length) { inativar_('Cadastros', deId, u, 'mapa'); fim = 'inativado'; }
  else { const r = excluir_('Cadastros', deId, u, 'mapa'); fim = r.ok ? 'excluido' : 'mantido'; if (!r.ok) inativar_('Cadastros', deId, u, 'mapa'); }
  sincronizarUnidades_(u);
  return { ok: true, resumo: resumo, de: fim };
}
