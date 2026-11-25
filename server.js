// Serveur de synchronisation pour l'outil "Suivi Assiduité Enseignants"
// - Stocke les données dans MongoDB (persistant, accessible de partout)
// - Sert la page web (dossier public/)
// - Fusionne les données envoyées par chaque appareil (CAE/CPE) avec ce qui est déjà stocké

const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const ACCESS_CODE = process.env.ACCESS_CODE || ''; // laisser vide = pas de code demandé

if (!MONGODB_URI) {
  console.error('ERREUR: la variable d\'environnement MONGODB_URI est manquante.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // derrière le proxy de l'hébergeur : vraie adresse IP du client
app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.path);
  next();
});
// La page et le service worker ne doivent jamais rester figés dans le cache du navigateur
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fichier) => {
    if (/(service-worker\.js|index\.html|manifest\.json)$/.test(fichier)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

let collection;
let baseDonnees;

async function demarrerMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('suivi_assiduite');
  baseDonnees = db;
  collection = db.collection('documents');
  console.log('Connecté à MongoDB.');
}

/* ---------- Structure de données par défaut ---------- */
function donneesVides() {
  return {
    meta: { titre: 'Suivi Assiduité Enseignants', etablissement: '', seuilAlerte: 3, updatedAt: new Date().toISOString() },
    cycles: [], classes: [], enseignants: [], emploiDuTemps: [], caes: [], cpes: [], affectations: [], releves: []
  };
}

/* ---------- Fusion (identique à la logique côté client) ---------- */
function fusionnerCollection(a, b) {
  const map = new Map();
  (a || []).forEach(x => map.set(x.id, x));
  (b || []).forEach(x => {
    const existant = map.get(x.id);
    if (!existant || (x.updatedAt || '') > (existant.updatedAt || '')) map.set(x.id, x);
  });
  return Array.from(map.values());
}
function fusionnerDonnees(local, distant) {
  if (!distant) return local;
  const meta = (distant.meta && distant.meta.updatedAt > local.meta.updatedAt) ? distant.meta : local.meta;
  return {
    meta,
    cycles: fusionnerCollection(local.cycles, distant.cycles),
    classes: fusionnerCollection(local.classes, distant.classes),
    enseignants: fusionnerCollection(local.enseignants, distant.enseignants),
    emploiDuTemps: fusionnerCollection(local.emploiDuTemps, distant.emploiDuTemps),
    caes: fusionnerCollection(local.caes, distant.caes),
    cpes: fusionnerCollection(local.cpes, distant.cpes),
    affectations: fusionnerCollection(local.affectations, distant.affectations),
    releves: fusionnerCollection(local.releves, distant.releves)
  };
}

/* ---------- Vérification du code d'accès ---------- */
function egalSecurise(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
/* Limite les essais de mot de passe CPE : 8 échecs / 10 min par adresse IP et profil */
const ECHECS_CONNEXION = new Map();
function connexionBloquee(cle) {
  const e = ECHECS_CONNEXION.get(cle);
  if (!e) return false;
  if (Date.now() - e.debut > 10 * 60 * 1000) { ECHECS_CONNEXION.delete(cle); return false; }
  return e.nb >= 8;
}
function noterEchec(cle) {
  const e = ECHECS_CONNEXION.get(cle);
  if (!e || Date.now() - e.debut > 10 * 60 * 1000) ECHECS_CONNEXION.set(cle, { nb: 1, debut: Date.now() });
  else e.nb++;
}
function verifierCode(req, res, next) {
  if (!ACCESS_CODE) return next();
  const code = req.get('x-access-code') || '';
  if (!egalSecurise(code, ACCESS_CODE)) {
    console.warn('Code d\'accès refusé pour', req.path); // le code saisi n'est plus écrit dans les journaux
    return res.status(401).json({ erreur: 'Code d\'accès invalide.' });
  }
  next();
}

/* ---------- Mots de passe CPE ---------- */
// Ne jamais envoyer le hash au client : on le retire et on ajoute juste un indicateur booléen.
function masquerMotsDePasse(data) {
  const clone = JSON.parse(JSON.stringify(data));
  clone.cpes = (clone.cpes || []).map(c => {
    const { motDePasseHash, ...reste } = c;
    return { ...reste, aMotDePasse: !!motDePasseHash };
  });
  return clone;
}
// Après une fusion, si le résultat n'a plus de hash pour un CPE qui en avait un stocké,
// on le restaure (le client n'a jamais le hash, donc il ne doit jamais l'effacer).
function preserverHashs(fusionne, stocke) {
  fusionne.cpes = (fusionne.cpes || []).map(c => {
    if (!c.motDePasseHash) {
      const ancien = (stocke.cpes || []).find(x => x.id === c.id);
      if (ancien && ancien.motDePasseHash) return { ...c, motDePasseHash: ancien.motDePasseHash };
    }
    return c;
  });
  return fusionne;
}

/* ---------- Routes ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/data', verifierCode, async (req, res) => {
  try {
    let doc = await collection.findOne({ _id: 'suivi' });
    if (!doc) {
      doc = { _id: 'suivi', ...donneesVides() };
      await collection.insertOne(doc);
    }
    const { _id, ...data } = doc;
    res.json(masquerMotsDePasse(data));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/* ---------- Synchronisation sans perte ----------
   Problème d'origine : deux enregistrements simultanés lisaient le même état, puis le dernier
   à écrire écrasait les collections entières de l'autre (emplois du temps effacés).
   Solution : verrou optimiste (champ "version"). Si quelqu'un a écrit entre-temps, on relit,
   on refusionne et on réessaie, donc aucune modification n'est perdue. */
let derniereSauvegardeHistorique = 0;
// Copie de sécurité : au plus toutes les 6 heures, on garde seulement les 3 dernières
// (avant : toutes les 10 minutes, 50 copies complètes -> c'est ce qui remplissait la base).
const HISTORIQUE_INTERVALLE_MS = 6 * 60 * 60 * 1000;
const HISTORIQUE_A_GARDER = 3;
async function archiverSiBesoin(doc) {
  if (!doc || Date.now() - derniereSauvegardeHistorique < HISTORIQUE_INTERVALLE_MS) return;
  derniereSauvegardeHistorique = Date.now();
  try {
    const { _id, ...contenu } = doc;
    const histo = baseDonnees.collection('historique');
    await histo.insertOne({ date: new Date(), contenu });
    const anciens = await histo.find({}, { projection: { _id: 1 } }).sort({ date: -1 }).skip(HISTORIQUE_A_GARDER).toArray();
    if (anciens.length) await histo.deleteMany({ _id: { $in: anciens.map(x => x._id) } });
  } catch (e) { console.warn('Archivage impossible', e.message); }
}

async function synchroniser(envoye) {
  for (let essai = 0; essai < 10; essai++) {
    const doc = await collection.findOne({ _id: 'suivi' });
    const stocke = doc ? (({ _id, version, ...d }) => d)(doc) : donneesVides();
    let fusionne = fusionnerDonnees(stocke, envoye);
    fusionne = preserverHashs(fusionne, stocke);
    fusionne.meta.updatedAt = new Date().toISOString();

    if (!doc) {
      try {
        await collection.insertOne({ _id: 'suivi', ...fusionne, version: 1 });
        return fusionne;
      } catch (e) {
        if (e.code === 11000) continue; // quelqu'un l'a créé juste avant : on recommence
        throw e;
      }
    }
    await archiverSiBesoin(doc);
    const filtre = doc.version === undefined
      ? { _id: 'suivi', version: { $exists: false } }
      : { _id: 'suivi', version: doc.version };
    const r = await collection.updateOne(filtre, { $set: { ...fusionne, version: (doc.version || 0) + 1 } });
    if (r.matchedCount === 1) return fusionne;
    // sinon : conflit, on relit et on refusionne
  }
  throw new Error('Trop de conflits simultanés');
}

app.post('/api/sync', verifierCode, async (req, res) => {
  try {
    const envoye = req.body && req.body.data;
    if (!envoye) return res.status(400).json({ erreur: 'Données manquantes.' });
    const fusionne = await synchroniser(envoye);
    res.json(masquerMotsDePasse(fusionne));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

app.post('/api/cpe/mot-de-passe', verifierCode, async (req, res) => {
  try {
    const { cpeId, motDePasse } = req.body || {};
    if (!cpeId || !motDePasse || motDePasse.length < 4) {
      return res.status(400).json({ erreur: 'Mot de passe invalide (4 caractères minimum).' });
    }
    const hash = bcrypt.hashSync(motDePasse, 10);
    const maintenant = new Date().toISOString();
    const r = await collection.updateOne(
      { _id: 'suivi', 'cpes.id': cpeId },
      { $set: { 'cpes.$.motDePasseHash': hash, 'cpes.$.updatedAt': maintenant, 'meta.updatedAt': maintenant }, $inc: { version: 1 } }
    );
    if (r.matchedCount === 0) return res.status(404).json({ erreur: 'CPE introuvable.' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

app.post('/api/cpe/connexion', verifierCode, async (req, res) => {
  try {
    const { cpeId, motDePasse } = req.body || {};
    const cleEssai = req.ip + '|' + cpeId;
    if (connexionBloquee(cleEssai)) {
      return res.status(429).json({ erreur: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    let doc = await collection.findOne({ _id: 'suivi' });
    const cpe = doc && (doc.cpes || []).find(c => c.id === cpeId);
    if (!cpe) return res.status(404).json({ erreur: 'Profil introuvable.' });
    if (!cpe.motDePasseHash) {
      return res.status(403).json({ erreur: "Aucun mot de passe défini pour ce profil. Demandez à un CPE de le définir dans Configuration → CAE & CPE." });
    }
    const ok = bcrypt.compareSync(motDePasse || '', cpe.motDePasseHash);
    if (!ok) { noterEchec(cleEssai); return res.status(403).json({ erreur: 'Mot de passe incorrect.' }); }
    ECHECS_CONNEXION.delete(cleEssai);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// Toute autre route renvoie la page principale (utile si on ajoute des routes côté client plus tard)
// (compatible Express 4 et 5 : la syntaxe app.get('*') n'existe plus en Express 5 et empêchait le serveur de démarrer)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

demarrerMongo().then(() => {
  app.listen(PORT, () => console.log('Serveur démarré sur le port ' + PORT));
}).catch(e => {
  console.error('Impossible de se connecter à MongoDB:', e);
  process.exit(1);
});
