# Claude Offgrid Cloud

Claude Code, mais en web. Un conteneur Docker unique qui héberge un dashboard depuis lequel
tu lances l'agent sur tes dépôts GitHub : il clone, travaille, committe et pousse sur une
branche dédiée. Tout se configure depuis le navigateur — aucun fichier de config à éditer.

```
┌──────────────┐   HTTPS    ┌──────────────────────────────────────┐   git+HTTPS   ┌────────┐
│  Navigateur  │ ─────────► │            Conteneur Docker          │ ────────────► │ GitHub │
│  (dashboard) │ ◄───SSE─── │  Next.js  ·  SQLite  ·  CLI claude   │ ◄──App token─ │        │
└──────────────┘            └──────────────────────────────────────┘               └────────┘
       ▲                                    ▲
       │                                    │  POST /api/hooks/run
   toi, un mot                              │  Authorization: Bearer …
   de passe                              n8n / cron / n'importe quel client HTTP
```

## Ce que ça fait

- **Dashboard web** — écris une consigne, choisis un dépôt, clique. L'agent démarre.
- **Flux temps réel** — chaque outil appelé, chaque fichier édité, chaque commande shell
  s'affiche en direct (SSE). Reconnexion sans perte : le flux est rejoué depuis la base.
- **Conversationnel** — une tâche se relance avec un message de suivi. La session Claude
  reprend avec tout son contexte et le même dossier de travail.
- **Push direct sur branche** — l'agent committe et pousse sur `claude/<slug>`. Un lien
  « ouvrir une PR » est proposé, mais rien n'est ouvert ni fusionné sans toi.
- **Déclenchable par webhook** — un endpoint HTTP protégé par token Bearer, pensé pour n8n.
- **Setup en trois écrans** — mot de passe, token Claude, GitHub App (créable en un clic).

## Démarrage

Prérequis : Docker, et une machine où Claude Code est installé et connecté (pour générer
le token une seule fois).

```bash
git clone https://github.com/maringouin10/claudeoffgrid-cloud.git
cd claudeoffgrid-cloud

cp .env.example .env
# Renseigne APP_SECRET (obligatoire) et PUBLIC_URL :
#   openssl rand -hex 32

docker compose up -d --build
```

Ouvre `http://localhost:3006` (ou ton `PUBLIC_URL`) et suis l'assistant.

### Étape 1 — Mot de passe

Le dashboard est mono-utilisateur. Le mot de passe est stocké haché (scrypt) et protège
tout le reste.

### Étape 2 — Token d'abonnement Claude

Sur une machine où Claude Code est installé et connecté à ton compte :

```bash
claude setup-token
```

Colle le token dans l'assistant. Il est chiffré en AES-256-GCM avant d'être stocké et
n'est jamais réaffiché. Il est injecté dans l'agent via `CLAUDE_CODE_OAUTH_TOKEN`.

> Ce token expire. Quand l'agent commence à échouer à l'authentification, régénère-le et
> remplace-le dans **Réglages ▸ Identifiants**.

### Étape 3 — GitHub App

Deux chemins :

**Création en un clic** (recommandé) — le bouton envoie à GitHub un *manifest* pré-rempli
avec les permissions minimales (`contents:write`, `metadata:read`, `pull_requests:write`,
`issues:write`, `workflows:write`). Tu valides, GitHub renvoie l'App ID et la clé privée,
puis te propose de choisir les dépôts. Nécessite un `PUBLIC_URL` que GitHub peut joindre.

**App existante** — colle l'App ID et la clé privée PEM.

L'App produit des tokens d'installation à durée de vie courte, renouvelés automatiquement
et jamais écrits en clair dans les logs.

### Étape 4 — Connecter des dépôts

Dans **Dépôts**, la liste de tout ce que l'App peut atteindre s'affiche. Connecte ce que
l'agent a le droit de toucher. Pour élargir ou restreindre, passe par « Gérer l'accès sur
GitHub ».

## Lancer une tâche

Depuis le dashboard : dépôt, modèle, consigne. Les options avancées permettent de forcer
le nom de branche, la branche de base, ou de désactiver le push.

Le cycle d'un tour :

1. clone de la branche de base dans `/data/workspaces/<task_id>` ;
2. `checkout -B <branche>` (ou reprise de la branche distante si elle existe) ;
3. `claude -p "<consigne>" --output-format stream-json --dangerously-skip-permissions` ;
4. `git add -A && git commit && git push -u origin HEAD:refs/heads/<branche>`.

Un message de suivi rejoue les étapes 1→4 avec `--resume <session_id>` : même contexte,
même dossier, la branche continue de s'empiler.

## Déclencher depuis n8n

Génère un token dans **Réglages ▸ Webhooks**, puis :

```bash
curl -X POST https://ton-instance/api/hooks/run \
  -H "Authorization: Bearer cog_…" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/name",
    "prompt": "Corrige le lint et pousse.",
    "branch": "claude/fix-lint"
  }'
```

Réponse immédiate (`202`) :

```json
{ "taskId": "task_…", "status": "queued", "branch": "claude/fix-lint", "compareUrl": "https://github.com/…" }
```

Puis en polling :

```bash
curl "https://ton-instance/api/hooks/run?taskId=task_…" -H "Authorization: Bearer cog_…"
# → { "status": "success", "done": true, "pushedSha": "…", "summary": "…" }
```

Un workflow prêt à importer est fourni : **`n8n/claude-offgrid-lancer-tache.json`**
(déclencheur → lancement → attente → polling jusqu'à `done`). Il attend une credential
n8n de type *Header Auth* : `Authorization` = `Bearer <ton token>`.

### API

| Méthode | Route | Auth | Rôle |
|---|---|---|---|
| `POST` | `/api/hooks/run` | Bearer ou session | Lancer une tâche |
| `GET` | `/api/hooks/run?taskId=` | Bearer ou session | État d'une tâche |
| `POST` | `/api/tasks/{id}/messages` | Bearer ou session | Message de suivi |
| `GET` | `/api/tasks/{id}/stream` | Session | Flux SSE |
| `POST` | `/api/tasks/{id}/cancel` | Session | Annuler |
| `GET` | `/api/health` | — | Sonde de vie |

## Configuration

Variables d'environnement (dans `.env`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `APP_SECRET` | *(généré)* | Clé de chiffrement des secrets et de signature des sessions. **Définis-la** : sans elle, une clé est écrite dans le volume et perdre le volume rend les secrets illisibles. |
| `PUBLIC_URL` | déduit des en-têtes | Origine publique. Requise pour la création en un clic de la GitHub App derrière un proxy. |
| `PORT` | `3006` | Port exposé sur l'hôte. |
| `COOKIE_SECURE` | `false` | `true` en HTTPS, pour un cookie de session `Secure`. |
| `DATA_DIR` | `/data` | Racine des données (base, workspaces, état du CLI). |
| `CLAUDE_BIN` | `claude` | Chemin du binaire Claude Code. |

Le reste — modèle par défaut, tâches simultanées, délai maximum, auteur des commits — se
règle dans **Réglages**.

## Données et persistance

Tout vit dans le volume `/data` :

```
/data
├── app.db          SQLite : réglages, dépôts, tâches, événements, tokens
├── master.key      clé de secours si APP_SECRET n'est pas défini
├── claude-home/    HOME du CLI claude (sessions, cache)
└── workspaces/     un clone git par tâche
```

Sauvegarder l'instance = sauvegarder ce volume **et** `APP_SECRET`.

## Sécurité

Ce que le projet fait :

- secrets (token Claude, clé privée GitHub, tokens webhook) chiffrés au repos en
  AES-256-GCM ; les tokens webhook ne sont stockés qu'en SHA-256 et affichés une seule fois ;
- mot de passe haché en scrypt, session signée en HMAC ; changer le mot de passe invalide
  toutes les sessions ;
- tout token d'installation GitHub est expurgé (`***`) de la sortie git avant d'atteindre
  la base ou le dashboard ;
- comparaisons de secrets en temps constant.

Ce dont tu dois avoir conscience :

- **l'agent tourne avec `--dangerously-skip-permissions`.** C'est délibéré : sans lui, un
  agent headless se bloque au premier prompt de permission. Il peut donc exécuter des
  commandes arbitraires dans son conteneur. Ne l'expose pas sur Internet sans HTTPS et un
  mot de passe solide, et donne à la GitHub App le minimum de dépôts ;
- **une seule couche d'isolation.** Toutes les tâches partagent le conteneur ; seuls leurs
  dossiers de travail sont séparés. C'est le compromis choisi pour rester sur un `docker
  compose up` sans monter le socket Docker ;
- **l'agent pousse sans revue.** Il ne fusionne jamais et n'ouvre pas de PR tout seul, mais
  la branche part sur GitHub dès qu'un tour réussit. Protège tes branches importantes.

## Développement

```bash
npm install
npm run dev        # http://localhost:3006
npm run typecheck
npm run build
```

En local, `DATA_DIR` vaut `./data`. Le CLI `claude` doit être dans le `PATH` — sinon, pointe
`CLAUDE_BIN` vers son emplacement.

## Stack

Next.js 16 (App Router, standalone) · React 19 · SQLite via better-sqlite3 · SSE pour le
temps réel · aucune dépendance runtime hors de ces quatre briques : la GitHub App est
signée à la main avec `node:crypto`, et le chiffrement aussi.
