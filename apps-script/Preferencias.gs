/* =====================================================================
 * Portal GVC — preferências de cada usuário nas telas (colunas visíveis, ordem e ordenação das tabelas).
 * Ficam no servidor para valer em qualquer computador ou celular. Sem histórico (é só arrumação de tela).
 * ===================================================================== */
const PREF_CHAVE = /^tab:[A-Za-z0-9_-]{1,60}$/;
function prefDados_(u) {
  const out = {};
  ler_('Preferencias').forEach(function (p) { if (String(p.usuarioId) === String(u.id)) out[String(p.chave)] = String(p.valor || ''); });
  return { ok: true, prefs: out };
}
/** valor = objeto (vira JSON) ou null para apagar (volta ao padrão). */
function prefSalvar_(chave, valor, u) {
  if (!PREF_CHAVE.test(chave)) return erroDados_('Preferência inválida.');
  const atual = ler_('Preferencias').filter(function (p) { return String(p.usuarioId) === String(u.id) && String(p.chave) === chave; })[0];
  if (valor == null) {
    if (atual) { aba_('Preferencias').deleteRow(atual._linha); limparCache_('Preferencias'); }
    return { ok: true };
  }
  const txt = JSON.stringify(valor);
  if (txt.length > 4000) return erroDados_('Preferência grande demais.');
  if (atual) {
    if (String(atual.valor) !== txt) { aba_('Preferencias').getRange(atual._linha, colunas_('Preferencias').indexOf('valor') + 1).setNumberFormat('@').setValue(txt); limparCache_('Preferencias'); }
  } else inserir_('Preferencias', { usuarioId: u.id, chave: chave, valor: txt }, u, null);
  return { ok: true };
}
