const WebSocket = require('ws');
const net = require('net');

const proxies = {}; // position -> { wss, server }

/**
 * Démarre un proxy WebSocket <-> TCP pour une position donnée
 */
function startVncProxy(position, { vncHost, vncPort, wsPort }) {
  stopVncProxy(position); // évite les doublons si reconfiguration

  const wss = new WebSocket.Server({ port: wsPort });

  wss.on('connection', (ws) => {
    console.log(`[vnc-proxy:${position}] Client noVNC connecté`);

    const tcpSocket = net.connect(vncPort, vncHost, () => {
      console.log(`[vnc-proxy:${position}] Connecté à ${vncHost}:${vncPort}`);
    });

    tcpSocket.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ws.on('message', (data) => {
      if (tcpSocket.writable) {
        tcpSocket.write(data);
      }
    });

    tcpSocket.on('close', () => {
      console.log(`[vnc-proxy:${position}] Connexion TCP fermée`);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    tcpSocket.on('error', (err) => {
      console.error(`[vnc-proxy:${position}] Erreur TCP:`, err.message);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    ws.on('close', () => {
      console.log(`[vnc-proxy:${position}] Client noVNC déconnecté`);
      tcpSocket.destroy();
    });

    ws.on('error', (err) => {
      console.error(`[vnc-proxy:${position}] Erreur WS:`, err.message);
      tcpSocket.destroy();
    });
  });

  wss.on('error', (err) => {
    console.error(`[vnc-proxy:${position}] Erreur serveur WS sur le port ${wsPort}:`, err.message);
  });

  proxies[position] = { wss };
  console.log(`[vnc-proxy:${position}] Démarré sur le port ${wsPort} -> ${vncHost}:${vncPort}`);
}

/**
 * Arrête le proxy d'une position donnée
 */
function stopVncProxy(position) {
  if (proxies[position]) {
    proxies[position].wss.close();
    delete proxies[position];
    console.log(`[vnc-proxy:${position}] Arrêté`);
  }
}

/**
 * Arrête tous les proxies (utile au shutdown)
 */
function stopAllProxies() {
  Object.keys(proxies).forEach(stopVncProxy);
}

module.exports = { startVncProxy, stopVncProxy, stopAllProxies };
