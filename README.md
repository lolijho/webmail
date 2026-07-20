# 📬 Webmail

Una webmail semplice e moderna: legge la posta via **IMAP** e invia via **SMTP**.
Interfaccia pulita, tondeggiante, con supporto tema chiaro/scuro.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Caratteristiche

- 🔐 Login con qualsiasi account IMAP/SMTP (preset per Gmail, Outlook, Yahoo, iCloud)
- 📥 Lettura delle cartelle e dei messaggi via IMAP
- 📖 Rendering sicuro delle email HTML in un `iframe` in sandbox
- 📎 Download degli allegati
- ✍️ Composizione, risposta e invio via SMTP
- 🔍 Ricerca, paginazione, contrassegno (stella) ed eliminazione
- 🌗 Tema chiaro/scuro automatico, layout responsive

## Come funziona

```
Browser  ──HTTP/JSON──►  Server Express  ──IMAP──►  server di posta (lettura)
                                        └─SMTP──►  server di posta (invio)
```

Le credenziali vengono verificate al login e restano **solo in memoria** sul
server, associate a un ID di sessione conservato in un cookie `httpOnly`.
Nessuna password viene scritta su disco. Ogni richiesta apre una connessione
IMAP/SMTP di breve durata.

## Avvio

```bash
npm install
npm start
```

Poi apri <http://localhost:3000>.

Per lo sviluppo con ricarica automatica:

```bash
npm run dev
```

### Configurazione

Copia `.env.example` in `.env` per personalizzare la porta:

```bash
cp .env.example .env
```

| Variabile   | Default       | Descrizione                                     |
| ----------- | ------------- | ----------------------------------------------- |
| `PORT`      | `3000`        | Porta del server HTTP                           |
| `NODE_ENV`  | `development` | Con `production` i cookie diventano `secure`    |

## Note sui provider

Molti provider (es. Gmail) richiedono una **App Password** invece della
password normale quando è attiva la verifica in due passaggi. I preset nel
form di login compilano automaticamente host e porte corrette.

| Provider | IMAP                      | SMTP                     |
| -------- | ------------------------- | ------------------------ |
| Gmail    | imap.gmail.com:993        | smtp.gmail.com:465       |
| Outlook  | outlook.office365.com:993 | smtp.office365.com:587   |
| Yahoo    | imap.mail.yahoo.com:993   | smtp.mail.yahoo.com:465  |
| iCloud   | imap.mail.me.com:993      | smtp.mail.me.com:587     |

## Struttura

```
server.js          # server Express + rotte API
lib/
  sessions.js      # store di sessione in memoria
  imap.js          # lettura IMAP (imapflow + mailparser)
  smtp.js          # invio SMTP (nodemailer)
public/
  index.html       # markup dell'interfaccia
  style.css        # stile moderno tondeggiante
  app.js           # logica front-end
```

## Sicurezza

- Le email HTML sono isolate in un `iframe` con `sandbox` (niente script).
- Le credenziali non vengono mai persistite.
- In produzione servi l'app dietro HTTPS e imposta `NODE_ENV=production`.
