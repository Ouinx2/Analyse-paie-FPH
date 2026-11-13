# Analyse paie FPH — mode d'emploi

## Installation
- **Hébergement** : déposer les 8 fichiers (dont les icônes) sur un hébergement statique HTTPS gratuit (GitHub Pages, Netlify…). Seul le code y est publié, jamais les données.
- **iPhone/iPad** : ouvrir l'adresse dans Safari → bouton **Partager** → **Sur l'écran d'accueil**. Utiliser ensuite uniquement l'icône installée.
- **Ordinateur** : ouvrir l'adresse dans le navigateur (option « Installer » possible sous Chrome/Edge).
- Le stockage de Safari et celui de l'app installée sont séparés : saisir ou importer le JSON dans l'app installée.

## Limites
- Aide au contrôle, aucun conseil fiscal, social ou juridique ; aucune règle indemnitaire n'est codée : toute absence d'indemnité = « à vérifier ».
- Pas de lecture automatique des PDF/images (OCR) : saisie manuelle. Les fichiers ajoutés ne sont ni stockés ni analysés.
- Fériés : France métropolitaine hors Alsace-Moselle. Pas de gestion du changement d'heure.
- Dimanche/férié forcé « oui » sur une vacation à cheval : tous ses jours rattachés sont comptés.
- Import JSON = remplacement complet. Données perdues si le stockage est vidé : exporter régulièrement.
- Écrans non inclus : graphiques d'évolution, rappel d'export automatique.

## À anonymiser avant transmission à Claude
Nom/prénom, adresse, NIR, matricule, RIB, date de naissance, coordonnées employeur, infos familiales, motifs d'absence/arrêt maladie, logo, nom et adresse de l'établissement, SIRET, URSSAF, APE, UF, nom du service, nom du responsable, signature/cachet.

## Anomalies détectables
Vacation non rattachée à un bulletin · nuit sans majoration · dimanche sans indemnité · férié sans indemnité · cumul depuis janvier erroné · heures saisies ≠ heures payées · PAS incohérent avec le profil · doublon/chevauchement · vacation de nuit à cheval sur deux jours (découpe 19 h–7 h : 2 h jour, 9 h nuit, 1 h jour).
