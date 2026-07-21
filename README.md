# 📬 Webmail

Webmail **multi-tenant**, semplice e moderna. Ogni utente ha un proprio account
(username + password), configura il suo server **IMAP** per leggere la posta e
invia dallo **stesso indirizzo** tramite **Resend** (API HTTPS). Interfaccia
pulita e tondeggiante, tema chiaro/scuro.

![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)

## Perché Resend per l'invio

Molti host cloud/VPS (e Coolify) **bloccano le porte SMTP in uscita**
(25/465/587) per anti-spam. Resend invia via **API HTTPS sulla porta 443**, che
non viene mai bloccata — così la ricezione resta su IMAP e l'invio funziona
comunque.

## Caratteristiche

- 🔐 Account applicativi con username + password (hash scrypt)
- 👥 Multi-tenant: ogni utente ha le sue impostazioni email, isolate e cifrate
- 📥 Lettura IMAP: cartelle, messaggi, ricerca, allegati
- 📖 Rendering sicuro dell'HTML in un `iframe` sandbox
- ✍️ Composizione, risposta e invio via Resend dallo stesso indirizzo
- 🔑 Chiave Resend globale (server) **oppure** una per ogni utente
- 🗄️ Persistenza SQLite (built-in `node:sqlite`, nessuna dipendenza nativa)
- 🔒 Segreti (password IMAP, chiavi Resend) cifrati con AES-256-GCM
- 🌗 Tema chiaro/scuro automatico, layout responsive

## Come funziona

```
Browser ──HTTP/JSON──► Server Express ──IMAP──► server di posta (lettura)
                                      └─HTTPS─► Resend API (invio)
Utenti + config email  ──►  SQLite (cifrato)  in DATA_DIR
```

## Avvio locale

```bash
npm install
npm start           # http://localhost:3000
```

Primo accesso: **Registrati**, poi configura email + IMAP. L'invio richiede una
chiave Resend (globale via `RESEND_API_KEY`, o personale nelle impostazioni).

## Variabili d'ambiente

| Variabile          | Default       | Descrizione                                                        |
| ------------------ | ------------- | ------------------------------------------------------------------ |
| `PORT`             | `3000`        | Porta del server HTTP                                              |
| `HOST`             | `0.0.0.0`     | Indirizzo di bind                                                  |
| `NODE_ENV`         | `development` | Con `production` i cookie diventano `secure` (HTTPS)              |
| `DATA_DIR`         | `./data`      | Cartella con database SQLite e chiave di cifratura                 |
| `ENCRYPTION_KEY`   | *(auto)*      | Chiave AES per i segreti. Genera con `openssl rand -base64 32`     |
| `RESEND_API_KEY`   | —             | Chiave Resend globale (default per tutti gli utenti)              |
| `REGISTRATION_OPEN`| `true`        | Metti `false` per chiudere le registrazioni                       |

## Deploy su Coolify

1. **New Resource → Application**, collega questo repository.
2. **Build Pack: Dockerfile** (rilevato automaticamente).
3. **Port**: `3000` · **Health Check Path**: `/health`.
4. **Storage**: monta un volume persistente su **`/app/data`** (contiene il
   database e la chiave di cifratura — senza volume, i dati si perdono a ogni
   deploy).
5. **Environment variables**:
   - `NODE_ENV=production`
   - `ENCRYPTION_KEY=` → genera con `openssl rand -base64 32` (impostala, non
     lasciarla auto-generare, così sopravvive alla ricreazione del container)
   - `RESEND_API_KEY=` → la tua chiave Resend (facoltativa se ogni utente usa la propria)
6. Assegna un dominio (HTTPS via Traefik). L'app ha `trust proxy` attivo.
7. **Deploy**.

## Configurare Resend (invio)

1. Crea un account su [resend.com](https://resend.com).
2. **Domains → Add Domain** → il tuo dominio (es. `danceartsfaculty.com`) e
   aggiungi i record DNS (SPF/DKIM) indicati. Attendi lo stato *Verified*.
3. **API Keys → Create** → copia la chiave `re_...`.
4. Impostala come `RESEND_API_KEY` sul server, **oppure** ogni utente la
   inserisce nelle proprie impostazioni.
5. Il mittente è l'indirizzo email dell'utente: **il suo dominio deve essere
   verificato** nell'account Resend usato.

## Risoluzione problemi

| Sintomo                                | Causa / Soluzione                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Login IMAP: *timeout*                  | Host blocca la porta IMAP in uscita, o host/porta errati. Usa «Verifica connessione IMAP» nelle impostazioni |
| Login IMAP: *autenticazione fallita*   | Password errata; con 2FA usa una **App Password**                                 |
| Invio: *dominio non verificato*        | Verifica il dominio del mittente su resend.com/domains                            |
| Invio: *API key non valida*            | Controlla `RESEND_API_KEY` o la chiave inserita dall'utente                       |
| Dati persi dopo il deploy              | Manca il volume su `/app/data`                                                     |

> L'app forza la risoluzione **IPv4-first**: molti host di posta pubblicano
> record IPv6 (AAAA) ma i container spesso non hanno routing IPv6, causando
> timeout di connessione.

## Struttura

```
server.js          # Express: auth, impostazioni, rotte mail, invio
lib/
  db.js            # SQLite (utenti + account email cifrati)
  auth.js          # registrazione/login, hash scrypt
  crypto.js        # cifratura AES-256-GCM dei segreti
  sessions.js      # sessioni in memoria (cookie httpOnly)
  imap.js          # lettura IMAP (imapflow + mailparser)
  resend.js        # invio via API Resend (HTTPS)
  diag.js          # diagnostica raggiungibilità TCP
public/
  index.html       # login app · impostazioni · casella
  style.css        # stile moderno tondeggiante
  app.js           # logica front-end
```

## Sicurezza

- Password degli account: hash **scrypt** con salt per-utente.
- Segreti email: cifrati **AES-256-GCM**, mai in chiaro nel database.
- Email HTML isolate in `iframe` con `sandbox`.
- In produzione servi dietro HTTPS con `NODE_ENV=production`.
