# Suivi Assiduité Enseignants — déploiement en ligne

Ce dossier contient un petit serveur (Node.js) + une base de données (MongoDB)
qui permettent à tous les CAE et CPE d'utiliser le même outil depuis
n'importe où (WiFi du collège ou données mobiles), sans être sur le même réseau.

Fichiers :
- `server.js` — le serveur
- `package.json` — la liste des dépendances
- `public/index.html` — la page utilisée par les CAE et les CPE
- `.gitignore`

## Étape 1 — Créer la base de données (MongoDB Atlas, gratuit)

1. Aller sur https://www.mongodb.com/cloud/atlas/register et créer un compte gratuit.
2. Créer un nouveau projet, puis un cluster **gratuit** (choisir l'option "M0 / Free").
3. Dans "Database Access", créer un utilisateur de base de données (nom + mot de passe — notez-les).
4. Dans "Network Access", cliquer "Add IP Address" puis "Allow access from anywhere" (0.0.0.0/0).
5. Cliquer "Connect" sur le cluster → "Drivers" → copier la **chaîne de connexion**
   (elle ressemble à `mongodb+srv://utilisateur:<password>@cluster0.xxxxx.mongodb.net/`).
   Remplacer `<password>` par le mot de passe créé à l'étape 3. Gardez cette chaîne de côté.

## Étape 2 — Mettre le code sur GitHub

1. Créer un compte gratuit sur https://github.com si vous n'en avez pas.
2. Cliquer "New repository", lui donner un nom (ex: `suivi-assiduite`), le laisser "Private", créer.
3. Sur la page du dépôt, utiliser "Add file" → "Upload files", et glisser-déposer les 4 fichiers/dossiers
   de ce dossier (`server.js`, `package.json`, `public/index.html`, `.gitignore`) — pour `public/index.html`,
   créez d'abord le dossier en le nommant `public/index.html` au moment de l'upload.
4. Valider ("Commit changes").

## Étape 3 — Héberger le serveur (Render, gratuit)

1. Aller sur https://render.com et créer un compte gratuit (vous pouvez vous inscrire avec GitHub).
2. Cliquer "New +" → "Web Service".
3. Choisir le dépôt GitHub créé à l'étape 2.
4. Renseigner :
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Plan : **Free**
5. Dans "Environment Variables", ajouter :
   - `MONGODB_URI` = la chaîne de connexion copiée à l'étape 1
   - `ACCESS_CODE` = un code simple que vous communiquerez aux CAE/CPE (ex: `college2026`)
6. Cliquer "Create Web Service". Render installe et démarre le serveur (quelques minutes).
7. Une fois prêt, Render affiche une URL du type `https://suivi-assiduite.onrender.com` — c'est le lien à
   partager à tous les CAE et CPE.

## Étape 4 — Utilisation au quotidien

- Chaque CAE/CPE ouvre le lien Render dans son navigateur (téléphone ou ordinateur), saisit le code d'accès
  une fois (mémorisé ensuite sur son appareil), puis choisit son profil (CAE ou CPE) sur l'onglet Accueil.
- Les données se synchronisent automatiquement toutes les 7 secondes entre tous les appareils connectés.
- Le plan gratuit de Render "s'endort" après 15 minutes sans visite : le premier chargement de la journée
  peut prendre 30 à 60 secondes, c'est normal, l'application se réveille toute seule.

## Pour changer le code d'accès plus tard

Dans Render → votre service → "Environment" → modifier `ACCESS_CODE` → "Save Changes" (le service redémarre
automatiquement). Pensez à prévenir tous les CAE/CPE du nouveau code.

## Étape 5 (optionnelle) — Une icône d'application sur le téléphone des CAE

L'application est maintenant une "PWA" (elle a un `manifest.json` et un `service-worker.js`), ce qui permet
deux façons de l'avoir comme une vraie application sur un téléphone Android, **une fois qu'elle est en ligne
sur Render** :

### A. La solution la plus simple (aucune installation de fichier)
1. Sur le téléphone du CAE, ouvrir Chrome et aller sur l'URL Render.
2. Menu ⋮ (trois points) → "Installer l'application" (ou "Ajouter à l'écran d'accueil").
3. Une icône apparaît sur l'écran d'accueil ; en cliquant dessus, l'application s'ouvre en plein écran,
   sans barre de navigateur, exactement comme une app installée.

### B. Un vrai fichier .apk à installer
Je ne peux pas compiler moi-même un fichier .apk dans cet environnement (les outils de compilation Android
ne sont pas disponibles ici), mais comme le site est déjà une PWA, un outil gratuit peut le faire à votre
place en quelques clics :
1. Aller sur https://www.pwabuilder.com
2. Coller l'URL Render de votre application, cliquer "Start".
3. Dans l'onglet "Android", cliquer "Generate Package" (choisir le package "Google Play" ou simplement le
   .apk de test, selon ce qui vous est proposé).
4. Télécharger le fichier .apk généré, l'envoyer aux CAE (par exemple via un lien de téléchargement ou une
   clé USB), qui devront autoriser "Installer des applications de sources inconnues" la première fois.

La solution A (installation directe depuis Chrome) est recommandée : plus simple, se met à jour toute seule,
et ne demande aucune autorisation particulière sur le téléphone.
