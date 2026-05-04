AGENDA INTELIGENTE RICARDO — VERSÃO 100%

ARQUIVOS:
- index.html
- style.css
- app.js
- firebase.js
- manifest.json
- sw.js
- logo.svg

O QUE ESTÁ INCLUSO:
- Firebase integrado ao projeto agenda-exclusiva-ricardo
- Cadastro de clientes dentro do app
- Organização de agenda por cidade
- Detecção de agenda incompleta por cidade
- Pergunta: continuar, reiniciar, começar por cliente específico ou visitar somente cliente específico
- Lista minimizada com Mostrar mais / menos
- Progresso salvo: 5/30, incompleta, concluída
- Comando de voz:
  - organizar agenda de amanhã para Pato Branco
  - visitar primeiro cliente
  - próximo cliente
  - pular cliente
  - abrir GPS
  - escolher cliente João Silva
  - visitar somente cliente João Silva
- GPS abre no Google Maps
- Proteção contra clique duplo nos botões principais
- PWA para adicionar à tela inicial do iPhone

FIREBASE — COLEÇÕES USADAS:
- clientes
- agendas
- agenda_atual/ricardo

REGRAS TEMPORÁRIAS PARA TESTE:
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}

IMPORTANTE:
Essas regras abertas são somente para teste. Para produção com login fixo, o ideal é travar por Firebase Auth ou por senha administrativa validada com regras. Não deixe aberto se for colocar dados sensíveis.
