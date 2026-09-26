// Serveur de synchronisation pour l'outil "Suivi Assiduité Enseignants"
// - Stocke les données dans MongoDB (persistant, accessible de partout)
// - Sert la page web (dossier public/)
// - Fusionne les données envoyées par chaque appareil (CAE/CPE) avec ce qui est déjà stocké

const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const ACCESS_CODE = process.env.ACCESS_CODE || ''; // laisser vide = pas de code demandé

if (!MONGODB_URI) {
  console.error('ERREUR: la variable d\'environnement MONGODB_URI est manquante.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let collection;

async function demarrerMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('suivi_assiduite');
  collection = db.collection('documents');
  console.log('Connecté à MongoDB.');
}

/* ---------- Structure de données par défaut ---------- */
function donneesVides() {
  return {
    meta: { titre: 'Suivi Assiduité Enseignants', etablissement: '', seuilAlerte: 3, updatedAt: new Date().toISOString() },
    classes: [], enseignants: [], emploiDuTemps: [], caes: [], cpes: [], affectations: [], releves: []
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
function verifierCode(req, res, next) {
  if (!ACCESS_CODE) return next();
  const code = req.get('x-access-code') || '';
  if (code !== ACCESS_CODE) return res.status(401).json({ erreur: 'Code d\'accès invalide.' });
  next();
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
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

app.post('/api/sync', verifierCode, async (req, res) => {
  try {
    const envoye = req.body && req.body.data;
    if (!envoye) return res.status(400).json({ erreur: 'Données manquantes.' });
    let doc = await collection.findOne({ _id: 'suivi' });
    const stocke = doc ? (({ _id, ...d }) => d)(doc) : donneesVides();
    const fusionne = fusionnerDonnees(stocke, envoye);
    fusionne.meta.updatedAt = new Date().toISOString();
    await collection.updateOne({ _id: 'suivi' }, { $set: fusionne }, { upsert: true });
    res.json(fusionne);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// Toute autre route renvoie la page principale (utile si on ajoute des routes côté client plus tard)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

demarrerMongo().then(() => {
  app.listen(PORT, () => console.log('Serveur démarré sur le port ' + PORT));
}).catch(e => {
  console.error('Impossible de se connecter à MongoDB:', e);
  process.exit(1);
});
