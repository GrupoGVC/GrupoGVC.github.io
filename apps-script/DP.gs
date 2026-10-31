/* =====================================================================
 * DP — adiantamentos de pernoite (analista de DP, atende as duas unidades).
 * O adiantamento nasce sozinho quando a viagem própria é programada:
 *   noites previstas × valor do pernoite (congelado na viagem), para cada pessoa PRÓPRIA da equipe
 *   (terceirizado não recebe). A analista marca como pago.
 * Ao concluir a viagem, o acerto compara as noites realizadas com as pagas:
 *   A complementar (faltou pagar) · A devolver (pagou a mais) · Sem diferença. Depois marca "Acertado".
 * Viagem cancelada: o que estava a pagar é cancelado; o que já foi pago vira "A devolver".
 * Cada adiantamento novo gera um e-mail para quem tem acesso de editor/admin ao DP.
 * ===================================================================== */

const ADI_STATUS = ['A pagar', 'Pago', 'Cancelado'];
const ACERTO_STATUS = ['A complementar', 'A devolver', 'Sem diferença', 'Acertado'];
const URL_DP = 'https://grupogvc.github.io/dp/';

function migrarFase4_() {
  aba_('Adiantamentos');
  ler_('Usuarios').forEach(function (us) {
    if (!simNao_(us.adminPortal)) return;
    if (!onde_('UsuarioModulos', 'usuarioId', us.id).some(function (m) { return m.modulo === 'dp'; })) inserir_('UsuarioModulos', { usuarioId: us.id, modulo: 'dp', nivel: 'admin' }, null, null);
  });
  // viagens já programadas pelo portal ganham os adiantamentos (as importadas da planilha não: já foram pagas fora)
  ler_('Viagens').filter(function (v) { return v.origem !== 'planilha' && v.status !== 'Cancelada'; })
    .forEach(function (v) { sincronizarAdiantamentos_(v.id, null, true); });
  HIST_BUF_.push([new Date(), '', 'sistema', 'dp', '', '', '', 'migrou', '', '', '', 'Fase 4: tabela de adiantamentos de pernoite criada.']);
}

function rotuloAdi_(a, v) {
  const c = porId_('Colaboradores', a.colaboradorId);
  return (c ? rotuloColab_(c) : 'Pessoa') + ' · ' + (v ? rotuloViagem_(v) : 'viagem');
}
/** Mantém os adiantamentos da viagem coerentes com a equipe, as noites e o status dela. */
function sincronizarAdiantamentos_(viagemId, u, semEmail) {
  const v = porId_('Viagens', viagemId); if (!v || v.origem === 'planilha') return [];
  const valorNoite = num_(v.valorNoite) || num_(parametro_('valorPernoite', dataTexto_(v.dataSaida)));
  const existentes = onde_('Adiantamentos', 'viagemId', viagemId).filter(function (a) { return a.status !== 'Cancelado'; });
  const pessoas = v.execucao === 'Terceirizada' || v.status === 'Cancelada' ? [] :
    [String(v.motoristaId)].concat(onde_('ViagemEquipe', 'viagemId', viagemId).map(function (e) { return String(e.colaboradorId); }))
      .filter(function (id, i, l) { const c = porId_('Colaboradores', id); return id && l.indexOf(id) === i && c && c.vinculo !== 'Terceirizado'; });
  const concluida = v.status === 'Concluída';
  const noites = Math.max(0, Math.round(num_(concluida ? v.pernoitesRealizados : v.pernoitesPrevistos)));
  const novos = [];
  const upd = function (a, campos) { atualizar_('Adiantamentos', a.id, campos, u, 'dp', { registroNome: rotuloAdi_(a, v) }); };
  const devolverTudo = function (a, motivo) {
    if (a.status === 'A pagar') upd(a, { status: 'Cancelado', obs: motivo });
    else if (a.status === 'Pago' && a.acertoStatus !== 'Acertado') upd(a, { acertoNoites: 0, acertoValor: -num_(a.valor), acertoStatus: num_(a.valor) ? 'A devolver' : 'Sem diferença', obs: motivo });
  };
  existentes.forEach(function (a) {
    if (pessoas.indexOf(String(a.colaboradorId)) < 0) devolverTudo(a, v.status === 'Cancelada' ? 'Viagem cancelada.' : 'Saiu da viagem.');
  });
  pessoas.forEach(function (pid) {
    const a = existentes.filter(function (x) { return String(x.colaboradorId) === pid; })[0];
    if (!a) {
      if (!noites) return;
      novos.push(inserir_('Adiantamentos', { viagemId: viagemId, unidadeId: String(v.unidadeId || ''), colaboradorId: pid, noites: noites, valorNoite: valorNoite,
        valor: arred2_(noites * valorNoite), status: 'A pagar', pagoEm: '', pagoPor: '', acertoNoites: '', acertoValor: '', acertoStatus: '', acertoEm: '',
        obs: concluida ? 'Pernoite não previsto: lançado na conclusão da viagem.' : '', ativo: true }, u, 'dp', rotuloAdi_({ colaboradorId: pid }, v)));
      return;
    }
    if (a.status === 'A pagar') {
      if (!noites) upd(a, { status: 'Cancelado', obs: 'Viagem sem pernoite.' });
      else upd(a, { noites: noites, valor: arred2_(noites * num_(a.valorNoite)) });
      return;
    }
    // já pago: só o acerto muda
    if (a.acertoStatus === 'Acertado') return;
    if (concluida) {
      const dif = arred2_((noites - num_(a.noites)) * num_(a.valorNoite));
      upd(a, { acertoNoites: noites, acertoValor: dif, acertoStatus: dif > 0 ? 'A complementar' : dif < 0 ? 'A devolver' : 'Sem diferença' });
    } else if (a.acertoStatus || a.acertoNoites !== '') {
      upd(a, { acertoNoites: '', acertoValor: '', acertoStatus: '' });
    }
  });
  if (novos.length && !semEmail) avisarDp_(v, novos);
  return novos;
}
function avisarDp_(v, novos) {
  const dest = ler_('Usuarios').filter(function (us) {
    if (!us.ativo) return false;
    const m = onde_('UsuarioModulos', 'usuarioId', us.id).filter(function (x) { return x.modulo === 'dp'; })[0];
    return m && (m.nivel === 'editor' || m.nivel === 'admin') && !simNao_(us.adminPortal); // a analista de DP (admin do portal não recebe)
  }).map(function (us) { return String(us.email); }).filter(String);
  if (!dest.length) return;
  const uni = porId_('Unidades', v.unidadeId);
  const linhas = novos.map(function (a) {
    const c = porId_('Colaboradores', a.colaboradorId);
    return '• ' + (c ? c.nome : '') + ': ' + a.noites + ' noite(s) × R$ ' + Number(a.valorNoite).toFixed(2).replace('.', ',') + ' = R$ ' + Number(a.valor).toFixed(2).replace('.', ',');
  });
  const total = novos.reduce(function (t, a) { return t + num_(a.valor); }, 0);
  const data = dataTexto_(v.dataSaida).split('-').reverse().join('/');
  try {
    MailApp.sendEmail({ to: dest.join(','), subject: 'Pernoite a pagar · viagem de ' + data + (v.placa ? ' · ' + v.placa : ''),
      body: 'Olá.\n\nA Programação' + (uni ? ' (' + uni.nome + ')' : '') + ' lançou uma viagem com pernoite. Adiantamentos a pagar:\n\n' + linhas.join('\n') +
            '\n\nTotal: R$ ' + total.toFixed(2).replace('.', ',') + '\nSaída: ' + data + (dataTexto_(v.dataRetornoPrevisto) ? ' · retorno previsto ' + dataTexto_(v.dataRetornoPrevisto).split('-').reverse().join('/') : '') +
            '\n\nVeja e marque como pago no portal: ' + URL_DP + '\n\n(Mensagem automática do Portal Grupo GVC.)' });
  } catch (e) { /* sem cota de e-mail: o adiantamento continua na tela do DP */ }
}

/* ---------------- leitura ---------------- */
function adiPublico_(a) {
  const o = publico_('Adiantamentos', a);
  ['pagoEm', 'acertoEm'].forEach(function (c) { o[c] = dataTexto_(a[c]); });
  ['noites', 'valorNoite', 'valor'].forEach(function (c) { o[c] = num_(a[c]); });
  ['acertoNoites', 'acertoValor'].forEach(function (c) { o[c] = a[c] === '' ? '' : num_(a[c]); });
  return o;
}
function dpDados_(u) {
  const adis = ler_('Adiantamentos').filter(function (a) { return veUnidade_(u, a.unidadeId); });
  const vIds = {}, cIds = {}; adis.forEach(function (a) { vIds[a.viagemId] = 1; cIds[a.colaboradorId] = 1; });
  return { ok: true,
    unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(),
    adiantamentos: adis.map(adiPublico_),
    viagens: ler_('Viagens').filter(function (v) { return vIds[v.id]; }).map(function (v) {
      return { id: v.id, unidadeId: String(v.unidadeId || ''), dataSaida: dataTexto_(v.dataSaida), dataRetornoPrevisto: dataTexto_(v.dataRetornoPrevisto), dataRetorno: dataTexto_(v.dataRetorno),
               placa: String(v.placa || ''), status: String(v.status), pernoitesPrevistos: num_(v.pernoitesPrevistos), pernoitesRealizados: v.pernoitesRealizados === '' ? '' : num_(v.pernoitesRealizados) }; }),
    colaboradores: ler_('Colaboradores').filter(function (c) { return cIds[c.id]; }).map(function (c) {
      return { id: c.id, nome: String(c.nome), apelido: String(c.apelido || ''), funcao: String(c.funcao), cpf: cpfFormatado_(c.cpf), telefone: String(c.telefone || '') }; }) };
}

/* ---------------- ações da analista ---------------- */
/** tipo: 'pagar' {ids, pagoEm} | 'acertar' {ids, acertoEm} | 'desfazer' {id} | 'obs' {id, obs} */
function dpAcao_(tipo, x, u) {
  x = x || {};
  const ids = (x.ids || (x.id ? [x.id] : [])).map(String);
  if (!ids.length) return erroDados_('Escolha pelo menos um adiantamento.');
  const adis = ids.map(function (id) { return porId_('Adiantamentos', id); });
  if (adis.some(function (a) { return !a; })) return erroDados_('Adiantamento não encontrado. Atualize a página.');
  if (adis.some(function (a) { return !veUnidade_(u, a.unidadeId); })) return semPermissao_('Você não tem acesso a esta unidade.');
  const rot = function (a) { return rotuloAdi_(a, porId_('Viagens', a.viagemId)); };
  if (tipo === 'pagar') {
    const d = dataTexto_(x.pagoEm); if (!d) return erroDados_('Informe a data do pagamento.');
    if (adis.some(function (a) { return a.status !== 'A pagar'; })) return erroDados_('Só adiantamentos "A pagar" podem ser marcados como pagos.');
    adis.forEach(function (a) { atualizar_('Adiantamentos', a.id, { status: 'Pago', pagoEm: d, pagoPor: u.email }, u, 'dp', { registroNome: rot(a) }); });
    // viagem já concluída: o acerto sai na hora
    adis.forEach(function (a) { const v = porId_('Viagens', a.viagemId); if (v && v.status === 'Concluída') sincronizarAdiantamentos_(v.id, u, true); });
    return { ok: true };
  }
  if (tipo === 'acertar') {
    const d = dataTexto_(x.acertoEm); if (!d) return erroDados_('Informe a data do acerto.');
    if (adis.some(function (a) { return a.acertoStatus !== 'A complementar' && a.acertoStatus !== 'A devolver'; })) return erroDados_('Só acertos "A complementar" ou "A devolver" podem ser marcados como acertados.');
    adis.forEach(function (a) { atualizar_('Adiantamentos', a.id, { acertoStatus: 'Acertado', acertoEm: d }, u, 'dp', { registroNome: rot(a) }); });
    return { ok: true };
  }
  if (tipo === 'desfazer') {
    const a = adis[0];
    if (a.acertoStatus === 'Acertado') { atualizar_('Adiantamentos', a.id, { acertoStatus: num_(a.acertoValor) > 0 ? 'A complementar' : 'A devolver', acertoEm: '' }, u, 'dp', { registroNome: rot(a) }); return { ok: true }; }
    if (a.status === 'Pago') {
      if (a.acertoStatus) return erroDados_('Este adiantamento já tem acerto. Desfaça o acerto antes.');
      atualizar_('Adiantamentos', a.id, { status: 'A pagar', pagoEm: '', pagoPor: '' }, u, 'dp', { registroNome: rot(a) }); return { ok: true };
    }
    return erroDados_('Nada para desfazer.');
  }
  if (tipo === 'obs') {
    atualizar_('Adiantamentos', adis[0].id, { obs: String(x.obs || '').trim() }, u, 'dp', { registroNome: rot(adis[0]) });
    return { ok: true };
  }
  return erroDados_('Ação inválida.');
}
