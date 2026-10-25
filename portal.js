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

  const espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Uma chamada à API. O Google às vezes redireciona o POST e o corpo se perde no caminho
  // (acontece com mais de uma conta Google no navegador): o servidor responde "sem_corpo"
  // ou, em versões antigas, "nao_autenticado" sem ter recebido o token.
  async function chamar(acao, dados) {
    let r;
    try {
      r = await fetch(apiUrl(), { method: 'POST', redirect: 'follow', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ acao: acao, token: ler().token || '' }, dados || {})) });
    } catch (e) { return { ok: false, erro: 'rede', mensagem: 'Sem conexão com o servidor. Verifique a internet.' }; }
    try { return await r.json(); }
    catch (e) { return { ok: false, erro: 'resposta', mensagem: 'O servidor respondeu algo inesperado. Tente de novo.' }; }
  }

  // Corpo perdido: nada foi executado no servidor, então é seguro repetir. Resposta estranha também
  // se repete, menos no login/código (as ações gravadas do portal são todas idempotentes).
  async function chamarComRetry(acao, dados) {
    let j = await chamar(acao, dados);
    const repete = function (x) { return !x.ok && (x.erro === 'sem_corpo' || (x.erro === 'resposta' && SEM_LOGIN.indexOf(acao) < 0)); };
    for (let i = 1; i <= 3 && repete(j); i++) {
      await espera(400 * i);
      j = await chamar(acao, dados);
    }
    return j;
  }

  async function api(acao, dados) {
    if (!apiUrl()) throw { erro: 'config', mensagem: 'O endereço da API não está configurado (config.js).' };
    let j = await chamarComRetry(acao, dados);
    // "Sessão terminou" só vale se o servidor confirmar duas vezes: um aviso falso não pode derrubar o login.
    if (!j.ok && j.erro === 'nao_autenticado' && SEM_LOGIN.indexOf(acao) < 0 && ler().token) {
      let negativas = 0;
      for (let i = 1; i <= 3; i++) {
        await espera(500 * i);
        const eu = await chamarComRetry('eu', {});
        if (eu.ok) { j = await chamarComRetry(acao, dados); break; }
        if (eu.erro === 'nao_autenticado' && ++negativas >= 2) break; // confirmado
      }
    }
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
