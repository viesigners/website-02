# À valider / compléter

1. **(Fait : freres.bg@viesigners.com via FormSubmit — activer à la 1re soumission, voir README)** ~~Courriel et formulaire~~ — `src/config.json` : `email` (repli mailto) et `formEndpoint` (Formspree, Netlify Forms, etc.). Sans ça, le formulaire ouvre un courriel pré-rempli seulement si `email` est défini, sinon affiche une erreur.
2. **Logos de la bande de l'accueil** — le visuel de référence montrait Meccano, Monopoly, St-Hubert, Wizards, D&D, Bombardier, Transformers, Nerf. Le site actuel ne publie que Warner, Marvel, Salesforce, Disney, HP, Dell, Ubisoft. Ajouter les fichiers dans `src/assets/img/` (`logo-xxx.png`, blanc sur transparent) puis les ajouter à `logos` dans `home.json`.
3. **Chiffres incohérents** — l'image de référence dit « 32+ années », le site actuel « 30 années »; « 600+ » vs « près de 500 » entreprises. Uniformiser.
4. **Pages des fondateurs** — seuls les faits publics du site sont utilisés (aucune biographie inventée). Fournir : rôle précis de chacun, parcours, photo individuelle (la photo double est utilisée).
5. **Textes nouveaux à relire** (rédigés selon les bonnes pratiques, aucune statistique inventée) : pages Publicité numérique, Médias sociaux, SEO/GEO; sections « Ce que votre site inclut », processus, comparatifs et FAQ des pages de services; plan d'action gratuit (page Contact); 3 articles de blogue par langue.
6. **Coaching d'affaires** — présent sur l'accueil (carte vers Contact) mais sans page dédiée, car absent de la liste de pages demandée.
7. **Témoignages** — l'ancien site chargeait un widget (Senja). L'accueil affiche pour l'instant l'invitation « Insérez votre histoire à succès ici! ».
8. **Typos corrigées vs le site actuel** : « que nous n'aurez jamais », « Résultats garanties », « aidé », « internationnale », « top 3% »…
9. **Garanties** — le texte « garanti » vient du site actuel; les détails sont à préciser dans les FAQ.
10. **Consentement aux témoins** — le site actuel utilise CookieYes; aucun suivi n'est installé ici. Ajouter analytics/pixels + bannière de consentement au besoin.
