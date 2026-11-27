# Viesigners — site web multi-pages (FR/EN)

Site statique généré par un script Node sans dépendance. Chaque page existe en un fichier HTML complet par langue (SEO/GEO : tout le contenu est dans le HTML, aucune exécution de JS requise).

```bash
node build.mjs            # génère dist/
node build.mjs --serve    # génère, sert sur http://localhost:4173 et regénère à chaque modification
```

Déployer le dossier `dist/` à la racine du domaine (Netlify, Cloudflare Pages, Vercel, Apache, Nginx…). `dist/_headers` contient le cache long des assets (Netlify/Cloudflare).

## Où modifier quoi
| Quoi | Où |
|---|---|
| Textes d'une page (FR/EN) | `src/content/{fr,en}/<page>.json` |
| Navigation, pied de page, libellés communs | `src/content/{fr,en}/_site.json` |
| Articles du blogue | `src/content/{fr,en}/posts/*.json` (même `key` = version traduite de l'autre langue) |
| Téléphone, réseaux sociaux, URL du domaine, formulaire | `src/config.json` |
| Slugs / URL de chaque page | `ROUTES` dans `build.mjs` |
| Design (couleurs, typo, composants) | `src/assets/css/site.css` (jetons en haut du fichier) |
| Images et logos | `src/assets/img/` |

Syntaxe dans les textes : `*mot*` = accent (italique serif violet), `**mot**` = gras, `[texte](@cle-de-page)` = lien interne localisé.

## Structure d'URL
`/fr/…` · `/en/…`. La racine `/` n'affiche aucune page de choix : elle redirige vers la langue du navigateur (anglais par défaut).
- Côté serveur (recommandé, meilleur pour le SEO) : `dist/_redirects` (Netlify) et `dist/.htaccess` (Apache) lisent l'en-tête `Accept-Language`. Nginx : `map $http_accept_language $vz_lang { default en; ~*^fr fr; } location = / { add_header Vary Accept-Language; return 302 /$vz_lang/; }`. Cloudflare Pages/Vercel : utiliser une règle/fonction équivalente.
- Repli sans règle serveur : la page `/` redirige en JavaScript (langue mémorisée → langue du navigateur → anglais).
- Les slugs sont traduits Les slugs sont traduits (ex. `/fr/sites-web/` ↔ `/en/websites/`).

## SEO / GEO automatisés à chaque build
- `<html lang>`, canonical, `hreflang` réciproques + `x-default`, Open Graph, Twitter.
- Graphe JSON-LD par page : Organization/ProfessionalService, WebSite, WebPage (+ Contact/About/Collection), BreadcrumbList, Service (pages de services), Person (fondateurs), BlogPosting (articles), ItemList (réalisations), **FAQPage** (chaque page).
- Bloc « En bref » en tête des pages de services, FAQ visible sur chaque page, date de mise à jour visible, auteurs identifiés.
- `sitemap.xml` avec alternates de langue, `robots.txt` (robots IA autorisés explicitement), `llms.txt`, `llms-full.txt`, et une version Markdown de chaque page (`index.md`, annoncée via `<link rel="alternate" type="text/markdown">`).
- Polices auto-hébergées, images avec dimensions, `loading="lazy"`, respect de `prefers-reduced-motion`, navigation clavier, lien d'évitement, FAQ en `<details>` natif.

## À compléter avant la mise en ligne
Voir `CONTENT-TODO.md`.

## Publier sur GitHub Pages
Le dépôt contient `.github/workflows/pages.yml` : à chaque `git push` sur `main`, GitHub construit le site (`node build.mjs`) et le publie.

1. Dépôt GitHub → **Settings → Pages → Build and deployment → Source : GitHub Actions** (une seule fois).
2. `git push` → onglet **Actions** pour suivre le déploiement. Adresse du site de test : `https://viesigners.github.io/website-02/`.
3. Cette version « de test » est **non indexable** (`SITE_NOINDEX=1` : balise noindex + robots.txt qui bloque tout).

Variables de build (voir le workflow) : `SITE_BASE` (sous-dossier, ex. `/website-02`), `SITE_ORIGIN` (domaine), `SITE_NOINDEX`.

### Mise en ligne sur viesigners.com (plus tard)
Dans le workflow : retirer `SITE_NOINDEX`, mettre `SITE_BASE: ""` et `SITE_ORIGIN: https://viesigners.com`, ajouter un fichier `src/assets/CNAME` contenant `viesigners.com`, puis configurer le domaine dans Settings → Pages et chez le registraire (DNS). Attention : GitHub Pages ne lit pas `_redirects`/`.htaccess` ; la redirection de `/` vers la langue du navigateur se fait alors par le JavaScript de repli.

## Production (viesigners.com) — état actuel
- Le workflow construit pour la racine du domaine (`SITE_BASE: ""`, `SITE_ORIGIN: https://viesigners.com`), indexable.
- Pages masquées (voir `hidden` dans `src/config.json`) : construites mais `noindex`, hors sitemap et `llms.txt`.
- Formulaire de contact : envoie à `freres.bg@viesigners.com` via FormSubmit (`formEndpoint` dans `src/config.json`). **À la toute première soumission, FormSubmit envoie un courriel d'activation à cette adresse : cliquer sur le lien de confirmation.** En cas d'échec, le formulaire ouvre le courriel de l'utilisateur (repli mailto).
- Aperçu privé non indexable sous `/website-02/` : voir les lignes commentées dans le workflow.

## Outils internes (`/tools/`)
Déposer un fichier HTML autonome dans `src/tools/` (ou un dossier `src/tools/<nom>/index.html`), puis `git push` : il est publié à `viesigners.com/tools/…`. Chaque page reçoit automatiquement une balise `noindex` ; la section n'est liée nulle part sur le site, ni dans le sitemap, ni dans `llms.txt`, ni nommée dans `robots.txt`. `/tools/` liste les outils (titre = `<title>`, sous-titre = `<meta name="description">`).
**Attention :** non indexé ≠ privé. Le dépôt GitHub est public et n'importe qui ayant le lien peut ouvrir la page. Ne rien y mettre de confidentiel.

### Réglages partagés des outils (`workers/tools-api/`)
Les réglages globaux des outils (ex. forfaits ImpaX) sont partagés par toute l'équipe grâce à un petit Cloudflare Worker + KV, servi sur `viesigners.com/tools-api/`. Lecture publique ; modification protégée par un mot de passe (secret Cloudflare `EDIT_PASSWORD`, jamais dans le dépôt), saisi une fois par appareil dans la fenêtre « Réglages globaux ». Si le service est inaccessible, l'outil utilise la copie de l'appareil, puis les valeurs par défaut intégrées.
Installation (une seule fois, dans `workers/tools-api/`) : `npx wrangler@3 login` → `npx wrangler@3 kv namespace create TOOLS_KV` (coller l'id dans `wrangler.toml`) → `npx wrangler@3 deploy` → `npx wrangler@3 secret put EDIT_PASSWORD`.
Test local : `.dev.vars` avec `EDIT_PASSWORD=...`, `npx wrangler@3 dev --local`, puis ouvrir l'outil avec `?api=http://127.0.0.1:8787/tools-api`.
