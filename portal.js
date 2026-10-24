/* Portal Grupo GVC — sessão e acesso compartilhados pelos módulos.
 * Cada módulo carrega ../config.js e ../portal.js e chama Portal.exigir('nomeDoModulo').
 * A sessão (token) fica no navegador, na chave "gvc-portal", e vale para todos os módulos.
 */
(function () {
  const CHAVE = 'gvc-portal';
  // Raiz do site = pasta onde este arquivo está (funciona no GitHub Pages e em testes locais).
  const RAIZ = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;
  const SEM_LOGIN = ['login', 'enviarCodigo', 'definirSenha', 'sair'];
  const MODULOS = {
    destinacao: { nome: 'Controle de Destinação', caminho: 'destinacao/',
      desc: 'Destinações de resíduos (custo), vendas de recicláveis (receita), locação de veículos e conferência dos MTRs do mês.' },
    mapa: { nome: 'Mapa Operacional', caminho: 'mapa/',
      desc: 'Clientes, unidades GVC, parceiros, fornecedores, destinadores, transportadores e recicladores no mapa, com resíduos, preços e equipamentos.' },
  };
  const NIVEIS = { leitor: 'Leitor', editor: 'Editor', admin: 'Administrador' };

  function ler() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) {}
    // Quem já estava conectado no Controle de Destinação antigo (mesma API, mesmo token) entra direto.
    if (!s.token) {
      try {
        const antiga = JSON.parse(localStorage.getItem('cd-auth') || '{}') || {};
        if (antiga.token) { s.token = antiga.token; localStorage.setItem(CHAVE, JSON.stringify(s)); localStorage.removeItem('cd-auth'); }
      } catch (e) {}
    }
    return s;
  }
  function gravar(s) { try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch (e) {} }
  function apiUrl() { return (window.CONFIG || {}).API_URL || ''; }

  function irParaLogin(motivo) {
    const s = ler(); delete s.token; gravar(s);
    const volta = location.href.startsWith(RAIZ) ? location.href.slice(RAIZ.length) : '';
    const q = new URLSearchParams();
    if (volta && volta !== 'index.html') q.set('voltar', volta);
    if (motivo) q.set('motivo', motivo);
    location.replace(RAIZ + (q.toString() ? '?' + q : ''));
  }

  async function api(acao, dados) {
    if (!apiUrl()) throw { erro: 'config', mensagem: 'O endereço da API não está configurado (config.js).' };
    let r;
    try {
      r = await fetch(apiUrl(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ acao: acao, token: ler().token || '' }, dados || {})) });
    } catch (e) { throw { erro: 'rede', mensagem: 'Sem conexão com o servidor. Verifique a internet.' }; }
    let j;
    try { j = await r.json(); } catch (e) { throw { erro: 'resposta', mensagem: 'O servidor respondeu algo inesperado. Tente de novo.' }; }
    if (!j.ok) {
      if (j.erro === 'nao_autenticado' && SEM_LOGIN.indexOf(acao) < 0 && Portal.aoExpirar) Portal.aoExpirar();
      throw j;
    }
    return j;
  }

  // Garante que há sessão e acesso ao módulo. Devolve o usuário { email, nome, adminPortal, modulos }.
  // Usa o último usuário conhecido na hora (abre rápido) e confirma com o servidor em seguida.
  function exigir(modulo) {
    const s = ler();
    if (!s.token) { irParaLogin(); return new Promise(function () {}); }
    const temAcesso = function (u) { return !modulo || !!(u && u.modulos && u.modulos[modulo]); };
    const confirmar = api('eu', {}).then(function (j) {
      const atual = ler(); atual.usuario = j.usuario; gravar(atual);
      if (!temAcesso(j.usuario)) location.replace(RAIZ + '?semAcesso=' + encodeURIComponent(modulo));
      Portal.usuario = j.usuario;
      if (Portal.aoAtualizarUsuario) Portal.aoAtualizarUsuario(j.usuario);
      return j.usuario;
    });
    if (s.usuario && temAcesso(s.usuario)) {
      confirmar.catch(function () {}); // sem internet: segue com o último usuário conhecido
      Portal.usuario = s.usuario;
      return Promise.resolve(s.usuario);
    }
    return confirmar.catch(function (e) {
      if (e && e.erro === 'nao_autenticado') return new Promise(function () {});
      throw e;
    });
  }

  async function sair() {
    try { await api('sair', {}); } catch (e) {}
    const s = ler(); delete s.token; delete s.usuario; gravar(s);
    location.replace(RAIZ);
  }

  function nivel(modulo, u) { u = u || Portal.usuario || ler().usuario; return (u && u.modulos && u.modulos[modulo]) || ''; }
  function podeEditar(modulo, u) { const n = nivel(modulo, u); return n === 'editor' || n === 'admin'; }

  window.Portal = {
    RAIZ: RAIZ, MODULOS: MODULOS, NIVEIS: NIVEIS,
    api: api, exigir: exigir, sair: sair, nivel: nivel, podeEditar: podeEditar,
    sessao: ler, gravarSessao: gravar, irParaLogin: irParaLogin,
    usuario: null,
    aoExpirar: function () { irParaLogin('expirada'); },
    aoAtualizarUsuario: null,
  };
})();
