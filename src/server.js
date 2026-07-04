require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_MODES = {
  'static-url': { url: '' },
  'slideshow': { interval: 5000 },
  'mirror': { sourceId: '' }
};

// ==================== SETUP DOSSIERS ====================
POSITIONS.forEach(pos => {
  const dir = path.join(UPLOADS_ROOT, pos);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ==================== CONFIG PAR DÉFAUT ====================
function getDefaultConfig() {
  const defaultZone = { mode: 'static-url', config: { url: 'about:blank' } };
  return {
    'top-left': { ...defaultZone },
    'top-right': { ...defaultZone },
    'bottom-left': { ...defaultZone },
    'bottom-right': { ...defaultZone }
  };
}

if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(getDefaultConfig(), null, 2));
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(fullConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
}

function updateConfig(position, newZoneConfig) {
  const fullConfig = loadConfig();
  const { mode, config } = newZoneConfig;

  // Initialisation si la zone n'a pas encore la structure "modes"
  if (!fullConfig[position].modes) {
    fullConfig[position] = {
      mode: fullConfig[position].mode,
      modes: JSON.parse(JSON.stringify(DEFAULT_MODES))
    };
  }

  // Met à jour le mode actif
  fullConfig[position].mode = mode;

  // Fusionne uniquement la sous-config du mode concerné
  fullConfig[position].modes[mode] = {
    ...fullConfig[position].modes[mode],
    ...config
  };

  saveConfig(fullConfig);
  return fullConfig;
}

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: false,
    sameSite: 'lax'
  }
}));

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  res.redirect('/admin/login.html');
}

// Fichiers statiques publics (display, login)
app.use(express.static(path.join(__dirname, 'public')));

// Images uploadées, accessibles par position
POSITIONS.forEach(pos => {
  app.use(`/uploads/${pos}`, express.static(path.join(UPLOADS_ROOT, pos)));
});

// ==================== AUTH ====================
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  try {
    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (valid) {
      req.session.authenticated = true;
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: 'Mot de passe incorrect' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// Protéger le dashboard admin (avant express.static ne suffit pas, donc on le sert manuellement)
app.get('/admin/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/dashboard.html'));
});

// ==================== CONFIG API ====================
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

app.get('/api/config/:position', (req, res) => {
  const { position } = req.params;
  if (!POSITIONS.includes(position)) {
    return res.status(400).json({ error: 'Position invalide' });
  }
  res.json(loadConfig()[position]);
});

app.post('/api/config/:position', requireAuth, (req, res) => {
  const { position } = req.params;
  if (!POSITIONS.includes(position)) {
    return res.status(400).json({ error: 'Position invalide' });
  }

  const { mode } = req.body;
  const fullConfig = updateConfig(position, req.body);
  const zoneConfig = fullConfig[position];

  broadcast({
    type: 'config-updated',
    position,
    mode: zoneConfig.mode,
    config: zoneConfig.modes[zoneConfig.mode]
  });

  res.json({
    success: true,
    mode: zoneConfig.mode,
    config: zoneConfig.modes[zoneConfig.mode]
  });
});

// ==================== UPLOAD IMAGES ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const position = req.params.position;
    if (!POSITIONS.includes(position)) {
      return cb(new Error('Position invalide'));
    }
    cb(null, path.join(UPLOADS_ROOT, position));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Format non supporté'), ok);
  }
});

app.post('/api/upload/:position',
  requireAuth,
  upload.array('images', 20),
  (req, res) => {
    const { position } = req.params;
    broadcast({ type: 'images-updated', position });
    res.json({
      success: true,
      files: req.files.map(f => f.filename)
    });
  }
);

app.get('/api/images/:position', (req, res) => {
  const { position } = req.params;
  if (!POSITIONS.includes(position)) {
    return res.status(400).json({ error: 'Position invalide' });
  }

  const dir = path.join(UPLOADS_ROOT, position);
  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort();

  res.json({ position, images: files });
});

app.delete('/api/images/:position/:filename', requireAuth, (req, res) => {
  const { position, filename } = req.params;
  if (!POSITIONS.includes(position)) {
    return res.status(400).json({ error: 'Position invalide' });
  }

  const safeFilename = path.basename(filename);
  const filePath = path.join(UPLOADS_ROOT, position, safeFilename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    broadcast({ type: 'images-updated', position });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Fichier introuvable' });
  }
});

app.post('/api/images/:position/order', requireAuth, (req, res) => {
  const { position } = req.params;
  const { order } = req.body;

  const fullConfig = loadConfig();
  const zone = fullConfig[position];
  zone.config.imageOrder = order;
  saveConfig(fullConfig);

  broadcast({ type: 'images-updated', position });
  res.json({ success: true });
});

// ==================== SLIDESHOW RENDERING ====================
app.get('/slideshow/:position', (req, res) => {
  const { position } = req.params;
  if (!POSITIONS.includes(position)) {
    return res.status(400).send('Position invalide');
  }

  const fullConfig = loadConfig();
  const zone = fullConfig[position];
  const zoneConfig = (zone.modes && zone.modes.slideshow) || {};

  res.send(renderSlideshowHtml(position, zoneConfig));
});

function renderSlideshowHtml(position, config) {
  const dir = path.join(UPLOADS_ROOT, position);
  let images = fs.readdirSync(dir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f));

  if (config.imageOrder && Array.isArray(config.imageOrder)) {
    const ordered = config.imageOrder.filter(img => images.includes(img));
    const remaining = images.filter(img => !ordered.includes(img));
    images = [...ordered, ...remaining];
  }

  const imageUrls = images.map(img => `/uploads/${position}/${img}`);
  const interval = config.interval || 5000;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin:0; background:#000; overflow:hidden; width:100vw; height:100vh; }
  #container { position: relative; width:100%; height:100%; }
  img {
    width:100%; height:100%; object-fit: contain;
    position: absolute; top:0; left:0;
    opacity: 0; transition: opacity 1s ease-in-out;
  }
  img.active { opacity: 1; }
  .empty-msg {
    color:white; text-align:center; padding-top:45vh;
    font-family:sans-serif; font-size: 1.2em;
  }
</style>
</head>
<body>
  <div id="container"></div>
  <script>
    const images = ${JSON.stringify(imageUrls)};
    const interval = ${interval};
    let current = 0;
    const container = document.getElementById('container');

    function showImage(index) {
      const img = document.createElement('img');
      img.src = images[index];
      img.onload = () => {
        // Supprimer les anciennes images après transition
        const old = container.querySelectorAll('img');
        container.appendChild(img);
        requestAnimationFrame(() => img.classList.add('active'));
        setTimeout(() => old.forEach(o => o.remove()), 1000);
      };
    }

    if (images.length === 0) {
      container.innerHTML = '<p class="empty-msg">Aucune image configurée pour ${position}</p>';
    } else {
      showImage(0);
      if (images.length > 1) {
        setInterval(() => {
          current = (current + 1) % images.length;
          showImage(current);
        }, interval);
      }
    }

    // Auto-refresh si les images changent (WebSocket)
    const ws = new WebSocket('ws://' + location.host);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'images-updated' && data.position === '${position}') {
        location.reload();
      }
    };
  </script>
</body>
</html>
  `;
}

// ==================== FRAME ROUTER (selon le mode) ====================
app.get('/frame/:position', (req, res) => {
  const { position } = req.params;
  if (!POSITIONS.includes(position)) {
    return res.status(400).send('Position invalide');
  }

  const fullConfig = loadConfig();
  const zone = fullConfig[position];
  const activeConfig = zone.modes[zone.mode];

  switch (zone.mode) {
    case 'static-url':
      return res.redirect(activeConfig.url || 'about:blank');

    case 'slideshow':
      return res.redirect(`/slideshow/${position}`);

    case 'remote-screen':
      // À implémenter plus tard (noVNC, etc.)
      return res.send(`<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:40vh;">
        Écran distant non configuré pour ${position}
      </body></html>`);

    default:
      return res.send('<html><body style="background:#000;"></body></html>');
  }
});



// ==================== WEBSOCKET ====================
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Client WebSocket connecté');
  ws.on('close', () => console.log('Client WebSocket déconnecté'));
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ==================== START ====================
server.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📺 Affichage : http://localhost:${PORT}/display.html`);
  console.log(`🔧 Admin     : http://localhost:${PORT}/admin/login.html`);
});
