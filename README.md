# pi-wall-image

Application web Node.js/Express permettant d'afficher un mur de 4 zones en configuration 2×2 en plein écran. Chaque zone est entièrement configurable : URL statique, diaporama d'images ou écran distant.

Permet de transformer un Raspberry PI en "mur d'images" DIY

---

## Fonctionnalités

- **4 zones d'affichage** configurables indépendamment (top-left, top-right, bottom-left, bottom-right)
- **3 modes par zone** :
  - `static-url` — affiche une URL fixe via iframe
  - `slideshow` — diaporama d'images uploadées avec intervalle personnalisable
  - `remote-screen` — placeholder pour écran distant (à venir)
- **Upload d'images** par zone via l'interface d'administration
- **Hot-reload en temps réel** via WebSocket : toute modification de config ou d'images recharge automatiquement la zone concernée
- **Interface d'administration** pour configurer les modes, URLs, intervalles et uploader des images

---

## Architecture

```
.
├── src
│   ├── server.js          # Point d'entrée Express + WebSocket
│   ├── config.json        # Configuration des 4 zones (par position)
│   ├── package.json
│   ├── public/
│   │   ├── display.html   # Page d'affichage 2×2 plein écran
│   │   ├── admin.html     # Interface d'administration
│   │   └── style.css      # CSS partagé (optionnel)
│   ├── uploads/           # Images uploadées par zone
│   │   ├── top-left/
│   │   ├── top-right/
│   │   ├── bottom-left/
│   │   └── bottom-right/
└── README.md
```

---

## Installation

```bash
# Cloner le dépôt
git clone <repository-url>
cd pi-wall-image

# Installer les dépendances
npm install

# Démarrer le serveur (port par défaut : 3000)
node server.js

# Ou via npm
npm start
```

Ouvrir :
- **Affichage mural** → `http://localhost:3000`
- **Administration** → `http://localhost:3000/admin.html`

---

## Configuration — `config.json`

Chaque zone contient un `mode` actif et un objet `modes` contenant la configuration propre à chaque mode.

```json
{
  "top-left": {
    "mode": "slideshow",
    "modes": {
      "static-url": {
        "url": "https://example.com"
      },
      "slideshow": {
        "interval": 5000,
        "imageOrder": []
      },
      "remote-screen": {}
    }
  },
  "top-right": {
    "mode": "static-url",
    "modes": {
      "static-url": {
        "url": "https://news.example.com"
      },
      "slideshow": {
        "interval": 8000,
        "imageOrder": []
      },
      "remote-screen": {}
    }
  },
  "bottom-left": {
    "mode": "slideshow",
    "modes": {
      "static-url": {
        "url": "https://weather.example.com"
      },
      "slideshow": {
        "interval": 3000,
        "imageOrder": ["photo1.jpg", "photo2.jpg"]
      },
      "remote-screen": {}
    }
  },
  "bottom-right": {
    "mode": "remote-screen",
    "modes": {
      "static-url": {
        "url": ""
      },
      "slideshow": {
        "interval": 5000,
        "imageOrder": []
      },
      "remote-screen": {}
    }
  }
}
```

### Champs par mode

| Mode | Champ | Type | Description |
|------|-------|------|-------------|
| `static-url` | `url` | string | URL complète à afficher en iframe |
| `slideshow` | `interval` | integer | Délai entre images en millisecondes (défaut : 5000) |
| `slideshow` | `imageOrder` | string[] | Ordre de défilement personnalisé (fichiers dans `uploads/<position>/`) |

---

## Routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/config` | Retourne la configuration complète des 4 zones |
| `GET` | `/api/config/:position` | Retourne la configuration d'une zone (`top-left`, `top-right`, `bottom-left`, `bottom-right`) |
| `PUT` | `/api/config/:position` | Met à jour la configuration d'une zone (mode, url, intervalle, etc.) |
| `POST` | `/api/upload/:position` | Upload une image dans une zone (`multipart/form-data`, champ `image`) |

### Exemple de mise à jour de configuration

```bash
curl -X PUT http://localhost:3000/api/config/top-left \
  -H "Content-Type: application/json" \
  -d '{"mode":"slideshow","modes":{"slideshow":{"interval":3000}}}'
```

---

## Routes de rendu

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/` | Affiche `display.html` (mur 2×2 plein écran) |
| `GET` | `/admin` | Affiche la page d'administration |
| `GET` | `/frame/:position` | Affiche la zone selon son mode actif |
| `GET` | `/slideshow/:position` | Génère la page diaporama d'une zone |
| `GET` | `/uploads/:position/:filename` | Sert les images uploadées |

---

## WebSocket

Le serveur maintient un serveur WebSocket sur le même port. Les clients se connectent à `ws://<hôte>:3000/`.

### Messages envoyés par le serveur

| Type | Payload | Trigger |
|------|---------|---------|
| `config-updated` | `{ "type": "config-updated", "position": "top-left" }` | La configuration d'une zone a changé |
| `images-updated` | `{ "type": "images-updated", "position": "top-left" }` | De nouvelles images ont été uploadées |

### Messages attendus par le serveur

| Type | Payload | Action |
|------|---------|--------|
| `ping` | `{ "type": "ping" }` | Ping keep-alive (pong retourné) |

### Consommation côté client

```js
const ws = new WebSocket('ws://' + location.host);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'config-updated') {
    const iframe = document.getElementById(data.position);
    if (iframe) {
      // Recharge l'iframe avec un cache-buster
      iframe.src = '/frame/' + data.position + '?t=' + Date.now();
    }
  }

  if (data.type === 'images-updated') {
    // Recharge le diaporama si la zone est en mode slideshow
    const iframe = document.getElementById(data.position);
    if (iframe) {
      iframe.contentWindow.location.reload();
    }
  }
};
```

---

## Roadmap / TODO

- [ ] **remote-screen** — Implémenter le support des écrans distants (noVNC ou équivalent)
- [ ] Interface d'administration : support du drag & drop pour l'ordre des images
- [ ] Prévisualisation en temps réel des changements de mode dans l'admin
- [ ] Authentication de l'interface d'administration
- [ ] Support des formats vidéo en complément des images dans le mode slideshow
- [ ] Configuration de la transition entre images (fondu, slide, etc.)

---

## Licence

MIT