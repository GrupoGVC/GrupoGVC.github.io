# Portal Grupo GVC

**Acesse:** https://grupogvc.github.io/

Portal único com login para os sistemas do Grupo GVC. Cada sistema é um módulo:

| Módulo | Endereço | O que faz |
|---|---|---|
| Controle de Destinação | `/destinacao/` | Destinações (custo), vendas de recicláveis (receita), locação de veículos e conferência dos MTRs do mês |
| Mapa Operacional | `/mapa/` | Clientes, unidades, parceiros, fornecedores, destinadores, transportadores e recicladores no mapa, com resíduos, preços e equipamentos |

Os endereços antigos (`/controle-destinacao/` e `/mapa-operacional/`) redirecionam para cá.

## Como funciona

- **Tela:** arquivos estáticos publicados no GitHub Pages (este repositório). Nenhum dado fica aqui.
- **API:** um único Google Apps Script ("Portal GVC — API", conta comprasgrupogvc@gmail.com), publicado como App da Web. O endereço `/exec` fica em `config.js`. Código-fonte em `apps-script/Codigo.gs`.
- **Dados:**
  - Planilha do Controle de Destinação: abas `Lancamentos`, `Destinadores`, `Precos`, `Locacao`, além de `Usuarios` e `Log` do portal. O script fica vinculado a ela.
  - Planilha do Mapa Operacional ("GVC Mapa Operacional — Banco de Dados"): abas `Pontos`, `ResiduosCadastro`, `Residuos`, `Equipamentos`. O script abre pelo ID (`MAPA_PLANILHA_ID`).

## Acesso

Cada pessoa entra com o **e-mail** e uma **senha própria**. No primeiro acesso (ou se esquecer a senha) ela clica em *Primeiro acesso ou esqueci a senha*, recebe um código de 6 dígitos por e-mail e cria a senha. A sessão vale para todos os módulos por 30 dias.

Em cada módulo a pessoa tem um nível:

| Nível | O que pode fazer |
|---|---|
| Sem acesso | Não vê o módulo |
| Leitor | Só consulta e exporta |
| Editor | Consulta, cadastra, altera e apaga |
| Administrador | Igual ao editor (reservado para configurações do módulo) |

**Admin do portal** é quem cadastra pessoas e define os níveis, na tela **Usuários** do portal. Também dá para editar direto a aba `Usuarios` da planilha do Controle: `email`, `nome`, `destinacao`, `ativo` (SIM/NÃO), `mapa`, `adminPortal` (SIM/NÃO). Deixe as colunas de senha em branco.

- Desativar alguém (ativo = NÃO) corta o acesso na hora, mesmo com o portal aberto.
- 5 senhas erradas seguidas bloqueiam o login por 15 minutos.
- Toda alteração dos dois módulos fica registrada na aba `Log`.

## Estrutura

```
index.html              portal: login, módulos e usuários
portal.js               sessão compartilhada pelos módulos (Portal.api, Portal.exigir, Portal.sair)
config.js               endereço da API
img/                    logos
destinacao/index.html   módulo Controle de Destinação
mapa/index.html         módulo Mapa Operacional
apps-script/            API (colar no Apps Script ou publicar pelo GitHub Actions)
```

## Publicar mudanças

- **Telas:** basta enviar os arquivos para o branch `main`. O GitHub Pages publica em 1 a 2 minutos.
- **API:** no Apps Script vinculado à planilha do Controle, substitua o código por `apps-script/Codigo.gs`, salve e vá em **Implantar › Gerenciar implantações › ✏️ › Versão: Nova versão › Implantar**. O endereço `/exec` não muda.
- **Publicação automática da API (opcional):** o workflow `.github/workflows/publicar-apps-script.yml` publica sozinho quando `apps-script/` muda. Ele precisa de três segredos em *Settings › Secrets and variables › Actions*: `CLASPRC_JSON` (conteúdo do `.clasprc.json` gerado por `npx @google/clasp@2.4.2 login` com a conta comprasgrupogvc), `APPS_SCRIPT_ID` (ID do script, em Configurações do projeto) e `APPS_SCRIPT_DEPLOYMENT_ID` (o trecho entre `/s/` e `/exec` do endereço da API). Sem os segredos ele só avisa e não publica nada.

## Novo módulo

1. Crie a pasta (ex.: `compras/`) com o `index.html` do módulo e carregue `../config.js` e `../portal.js`.
2. No início do módulo, chame `const usuario = await Portal.exigir('compras')` e use `Portal.api('acao', {...})` para falar com a API.
3. Cadastre o módulo em `MODULOS` no `portal.js` e no `Codigo.gs` (constante `MODULOS`, coluna nova na aba `Usuarios` e as ações no `doPost`).
