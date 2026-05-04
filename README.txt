AGENDA INTELIGENTE RICARDO — LOGIN SEGURO

LOGIN NO APP:
Usuário: ricardo
Senha: 223687

ANTES DE USAR:
Firebase > Authentication > Users > Add user
Email: ricardo@agenda.local
Senha: 223687

REGRAS DEFINITIVAS DO FIRESTORE:
Cole em Firestore Database > Regras > Publicar

rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isRicardo() {
      return request.auth != null
        && request.auth.token.email == "ricardo@agenda.local";
    }

    match /clientes/{docId} {
      allow read, write: if isRicardo();
    }

    match /agendas/{docId} {
      allow read, write: if isRicardo();
    }

    match /agenda_atual/{docId} {
      allow read, write: if isRicardo();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}

INCLUSO:
- Login real Firebase Authentication
- Sessão persistente: depois que entra uma vez, abre automático logado
- Logout
- Cadastro de clientes
- Agenda por cidade
- Agenda incompleta com continuar/reiniciar/escolher cliente/visitar somente
- Lista minimizada com Mostrar mais / menos
- Comandos de voz
- GPS no Google Maps
- Proteção contra clique duplo
- PWA para iPhone

SEGURANÇA:
A chave do Firebase no frontend pode aparecer. O que protege os dados é Authentication + Firestore Rules.
Não use allow read, write: if true em produção.
