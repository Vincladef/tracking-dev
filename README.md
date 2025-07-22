📘 Cahier des Charges – Système de Suivi d’Habitudes avec Interface Web Interactive et Back-End Google Sheets
📌 Présentation du projet
Ce projet vise à créer une expérience de suivi d’habitudes personnalisée, automatique et motivante, pour chaque utilisateur.
Chaque jour :

L’utilisateur reçoit une notification (email ou Telegram) avec un lien vers un formulaire web personnalisé

Il accède à un site web interactif, organisé en catégories d’habitudes à suivre

Il suit les consignes du jour (questions dynamiques, adaptées à ses objectifs)

Il saisit ses réponses, voit son historique récent, et avance catégorie par catégorie

À la fin, il soumet le formulaire → ses réponses sont enregistrées dans son Google Sheets personnel

L’interface se met à jour automatiquement, selon sa progression, pour les prochains jours

Le système fonctionne sans intervention manuelle, s’adapte à ses réponses dans le temps, et favorise la motivation et la constance grâce à un historique visuel et intelligent.

🎯 Objectif
Créer un système de suivi quotidien :

basé sur un fichier Google Sheets individuel par utilisateur

avec une interface web interactive et structurée par catégories

intégrant des questions conditionnelles et une logique de fréquence adaptative

affichant un historique personnel de réponses sous chaque question

et envoyant chaque jour une notification automatique avec un lien vers le formulaire

Le tout doit être simple à utiliser, visuellement engageant et automatisé après configuration.

🗂️ Structure du système
🧾 Google Sheets – Fichier par utilisateur
Nom : [Nom] - tracking (ex : Alice - tracking, Léo - tracking)

Ce fichier contient toutes les données de configuration et de suivi pour un utilisateur :

Questions

Fréquences

Catégories

Réponses journalières

📊 Feuille de données (Tracking)
Colonne	Description
A – Condition	(optionnelle) Texte exact d’une question déclencheuse
B – Catégorie	Groupe de questions (ex. : “Santé”, “Travail”)
C – Type de question	Oui/Non, Texte court, Texte long, Menu déroulant
D – Fréquence	quotidien, lundi, mardi, …, répétition espacée, ne pas demander
E – Question	Libellé exact à afficher dans le formulaire
F → ∞ – Dates	Une colonne par jour dd/MM/yyyy, contenant les réponses

Les colonnes de dates sont classées du plus récent (à gauche) au plus ancien (à droite)

📆 Logique quotidienne
Chaque jour :

Le système lit la date du jour

Il sélectionne les questions actives, en fonction :

de la fréquence

de la logique de répétition espacée (voir plus bas)

des conditions (questions conditionnelles)

Il récupère l’historique récent (5 à 7 derniers jours) pour chaque question

Il génère une interface web personnalisée, découpée par catégorie

Il envoie un lien unique par :

📧 Email

📲 Telegram

L’utilisateur suit les consignes, remplit le formulaire, et clique sur "Envoyer"

Les réponses sont :

enregistrées dans le tableau

utilisées pour adapter les prochaines questions

🔁 Gestion des fréquences
🔹 Fréquences standards
Valeur	Effet
quotidien	posée tous les jours
lundi, mardi, etc.	posée ce jour uniquement
ne pas demander	jamais posée

🔸 Répétition espacée (logique adaptative)
Chaque réponse modifie un score de progression :

Réponse	Score
Oui	+1.0
Plutôt oui	+0.75
Moyen	+0.25
Plutôt non	0
Non	-1.0
Pas de réponse	0 (ne change rien)

Le score est compris entre 0 et 6 (flottant), et définit un délai avant réapparition basé sur la suite de Fibonacci :

Score arrondi	Délai (jours)
0	0
1	1
2	2
3	3
4	5
5	8
6	13

Chaque question a son propre score, mis à jour après chaque réponse.

📝 Types de questions supportées
Type	Affichage attendu
Oui/Non	Sélecteur binaire
Menu déroulant (Likert)	Oui, Plutôt oui, Moyen, Plutôt non, Non, Pas de réponse
Texte court	Champ texte simple
Texte plus long	Zone texte multiline

🧩 Interface utilisateur (front-end)
L’interface web :

Est accessible via un lien unique chaque jour

Est structurée par catégories :

Une catégorie = une page

Navigation fluide via "Précédent / Suivant"

Intègre :

des questions conditionnelles (affichées dynamiquement si déclenchées)

l’historique de réponse sous chaque question

Se termine par un bouton "Envoyer" pour soumettre l’ensemble des réponses

🔄 Questions conditionnelles
Une question est conditionnelle si la colonne A contient le texte exact d’une autre question.

Elle ne s’affiche que si la réponse à la question déclencheuse est "Oui"

Cette logique est gérée en direct dans l’interface

🔎 Historique de réponses (dopamine boost)
Sous chaque question, l'utilisateur voit ses réponses des jours précédents :

Type	Affichage
Oui/Non, Likert	Pastilles colorées par jour
Texte court/long	Liste déroulante ou bloc avec réponses datées

L’historique est extrait directement depuis les colonnes de dates dans la feuille de calcul.

📧 Notification quotidienne
Chaque jour, l’utilisateur reçoit un message contenant :

Un lien vers son formulaire

Un objet/titre du style :
📝 Formulaire du jour – [Nom] – [JJ/MM/AAAA]

Message envoyé via :

Email

Telegram (via API)

💾 Enregistrement des réponses
À la soumission :

Le système vérifie ou crée la colonne de la date du jour

Enregistre chaque réponse à la bonne ligne

Met à jour :

Le score (si répétition espacée)

La date de prochaine apparition

Trie les colonnes du plus récent au plus ancien

Applique la mise en forme visuelle

🎨 Mise en forme automatique
Réponse	Couleur de fond
Oui	Vert vif
Plutôt oui	Vert doux
Moyen	Jaune pâle
Plutôt non	Rouge clair
Non	Rouge vif
Pas de réponse / vide	Blanc

Les colonnes de dates ont un fond gris clair pour les distinguer.

🧾 Journalisation
Le système garde un journal d’exécution :

Heure, date, nom de l’utilisateur

Liste des questions posées

Données enregistrées

Erreurs éventuelles

Envoi des notifications

Stocké dans une feuille Logs ou dans un fichier central.

✅ Synthèse fonctionnelle
Fonctionnalité	Intégré
Notification quotidienne par email/Telegram	✅
Interface Web interactive (multi-catégorie)	✅
Questions conditionnelles dynamiques	✅
Répétition espacée (Fibonacci)	✅
Historique de réponse intégré	✅
Enregistrement structuré dans Google Sheets	✅
Mise en forme visuelle automatique	✅
Automatisation complète après configuration	✅