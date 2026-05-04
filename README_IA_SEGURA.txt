AGENDA INTELIGENTE RICARDO - VERSÃO COM IA + IMPORTAÇÃO SEGURA

IMPORTANTE:
- NÃO cole sua chave da Anthropic no index.html, app.js, firebase.js ou GitHub.
- A chave deve ficar somente no Firebase Functions Secret: ANTHROPIC_API_KEY.
- O site continua funcionando mesmo antes de conectar a IA. Sem a URL da Function, ele usa os comandos internos antigos.
- Para importar imagem/PDF com IA, a Firebase Function precisa estar publicada e a URL precisa estar no app.js.

MODELO ECONÔMICO:
- A Function está configurada para usar Haiku pelo nome CLAUDE_MODEL.
- Padrão atual no código: claude-3-5-haiku-20241022.
- Se a Anthropic mudar o nome recomendado, basta trocar uma linha em functions/index.js:
  const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-20241022";

O QUE FOI ADICIONADO:
1) Botão "Falar uma vez".
2) Botão "Modo voz contínuo" para comandos seguidos.
3) Resposta falada pelo navegador.
4) Área de conversa com a IA.
5) Integração preparada com Anthropic via Firebase Functions, sem expor a chave.
6) Aba "Importar clientes com IA".
7) Upload de imagem/print, PDF, CSV/TXT ou lista colada.
8) Prévia antes de salvar clientes.
9) Bloqueio de duplicados simples por nome + cidade.
10) Limites de economia: 1 arquivo por vez, 4 MB por arquivo, até 80 clientes por importação.
11) Fallback barato: CSV/TXT e lista colada são tentados primeiro direto no navegador, sem gastar IA quando a lista já está bem separada.

COMO A IMPORTAÇÃO FUNCIONA:
- O usuário abre "Importar clientes com IA".
- Envia print/foto/PDF/CSV/TXT ou cola uma lista.
- Clica "Analisar lista".
- O sistema mostra uma tabela de prévia.
- O usuário confirma.
- Só então os clientes são salvos no Firestore.

PASSO A PASSO PARA CONECTAR A IA:
1) Instale o Firebase CLI no computador se ainda não tiver:
   npm install -g firebase-tools

2) Entre na sua conta Firebase:
   firebase login

3) Na pasta do projeto, selecione o projeto certo:
   firebase use agenda-exclusiva-ricardo

4) Grave a chave da Anthropic como segredo seguro:
   firebase functions:secrets:set ANTHROPIC_API_KEY
   Cole a chave apenas quando o terminal pedir. Não cole no código.

5) Publique a Function:
   firebase deploy --only functions

6) O terminal vai mostrar uma URL parecida com:
   https://us-central1-agenda-exclusiva-ricardo.cloudfunctions.net/agendaAi

7) Abra app.js e cole essa URL na linha:
   const AI_FUNCTION_URL = "";
   Ficando assim:
   const AI_FUNCTION_URL = "https://us-central1-agenda-exclusiva-ricardo.cloudfunctions.net/agendaAi";

8) Suba para o GitHub Pages somente os arquivos do site:
   index.html
   style.css
   app.js
   firebase.js
   manifest.json
   sw.js
   logo.svg

9) A pasta functions e firebase.json são para publicar no Firebase Functions, não precisam ir no GitHub Pages.

SEGURANÇA:
- A Function confere o login Firebase e só aceita o usuário ricardo@agenda.local.
- A chave da Anthropic fica escondida como secret do Firebase.
- Não envie a chave em print, chat, GitHub ou arquivo público.
- A importação não salva automaticamente: sempre passa por prévia e confirmação.
- Arquivos grandes são bloqueados para evitar gasto alto.
