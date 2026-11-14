/* =====================================================================
 * Portal GVC — limpeza única do movimento (pedido do Milton em 13/11/2026), para começar sem dados.
 * Apaga: solicitações (com resíduos, documentos e itens previstos), lançamentos do Controle de
 * Destinação, CDFs, viagens (paradas e equipes), adiantamentos de pernoite, BMs/NFs (com itens)
 * e cobranças de viagem frustrada.
 * Mantém: tudo do Mapa (cadastros, locais, contratos, itens), Frota (veículos, caixas, tipos),
 * locação mensal, pessoas, usuários, listas, parâmetros e o histórico. A numeração continua.
 * As caixas que estavam no cliente por uma entrega da Programação voltam para a base.
 * Ação temporária, só para administrador: 'admin.limparMovimento' {confirmar: 'LIMPAR'} —
 * sem a confirmação só mostra o que seria apagado.
 * ===================================================================== */

const LIMPEZA_TABELAS = ['SolicitacaoItens', 'SolicitacaoDocumentos', 'SolicitacaoPrecos', 'Solicitacoes', 'Lancamentos', 'Cdfs',
  'ViagemEquipe', 'Paradas', 'Viagens', 'Adiantamentos', 'FaturamentoItens', 'Faturamentos', 'CobrancasFrustracao'];

/** Caixas "Em cliente" por uma entrega registrada numa parada que vai ser apagada. */
function caixasParaBase_() {
  const entregues = {}; ler_('Paradas').forEach(function (p) { if (p.caixaEntregueId) entregues[String(p.caixaEntregueId)] = 1; });
  return ler_('Caixas').filter(function (c) { return entregues[c.id] && c.situacao === 'Em cliente'; });
}
function limparMovimento_(body, u) {
  if (!u || !u.adminPortal) return semPermissao_('Só administradores do portal podem fazer isso.');
  const contagem = {}; LIMPEZA_TABELAS.forEach(function (t) { contagem[t] = ler_(t).length; });
  const caixas = caixasParaBase_().map(function (c) { return nomeCaixa_(c.numero); });
  if (String((body || {}).confirmar || '') !== 'LIMPAR') return { ok: true, simulacao: true, apagaria: contagem, caixasParaBase: caixas };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    // 1. cópia de segurança que não sai na rotação do backup semanal (nome com MANTER)
    const p = PropertiesService.getScriptProperties();
    const nomeBk = 'Portal GVC — Base — MANTER — antes da limpeza ' + Utilities.formatDate(new Date(), 'America/Bahia', 'yyyy-MM-dd HH.mm');
    DriveApp.getFileById(p.getProperty('BASE_ID')).makeCopy(nomeBk, DriveApp.getFolderById(p.getProperty('BACKUP_ID')));
    // 2. a numeração continua de onde parou (sem a propriedade, o próximo código seria contado do zero)
    LIMPEZA_TABELAS.forEach(function (t) {
      const pre = TABELAS[t].prefixo; let n = Number(p.getProperty('SEQ_' + pre) || 0);
      ler_(t).forEach(function (o) { const m = String(o.id).match(/-(\d+)$/); if (m) n = Math.max(n, Number(m[1])); });
      if (n) p.setProperty('SEQ_' + pre, String(n));
    });
    // 3. caixas de volta para a base (antes de apagar as paradas)
    caixasParaBase_().forEach(function (c) {
      atualizar_('Caixas', c.id, { situacao: 'Na base', cadastroAtualId: '', dataEntrega: '' }, u, 'frota', { registroNome: nomeCaixa_(c.numero), prefixoCampo: 'Limpeza do movimento · ' });
    });
    // 4. abas vazias, com o cabeçalho
    LIMPEZA_TABELAS.forEach(function (t) {
      const sh = aba_(t); const ult = sh.getLastRow();
      if (ult > 1) { if (ult >= sh.getMaxRows()) sh.insertRowsAfter(ult, 1); sh.deleteRows(2, ult - 1); } // a planilha não deixa apagar todas as linhas não congeladas
      limparCache_(t);
    });
    HIST_BUF_.push([new Date(), quemEmail_(u), String(u.nome || ''), 'portal', '', '', '', 'limpou', '', '', '',
      'Limpeza do movimento para começar sem dados (cópia: ' + nomeBk + '): ' + JSON.stringify(contagem) + (caixas.length ? ' · caixas de volta à base: ' + caixas.join(', ') : '')]);
    return { ok: true, apagou: contagem, caixasParaBase: caixas, backup: nomeBk };
  } finally { lock.releaseLock(); }
}
