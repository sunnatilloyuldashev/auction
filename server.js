/**
 * «АУКЦИОН» — Жергілікті Сауда Сервері (Local Game Server)
 * Ешқандай сыртқы npm бумаларын талап етпейді (нөлдік тәуелділік).
 * Телефондар мен негізгі экран арасындағы тікелей синхронизацияны қамтамасыз етеді.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;

// Жергілікті Wi-Fi IPv4 адресін анықтау
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Ішкі (127.0.0.1) емес және тек IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIpAddress();

// MIME типтері
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// SSE қосылымдары (EventSource клиенттері)
let sseClients = [];

// Ағымдағы ойын күйінің көшірмесі
let latestGameState = {
  currentLot: null,
  currentBid: 100,
  leadingTeamId: null,
  leadingTeamName: null,
  leadingTeamColor: null,
  teams: []
};

// SSE хабарламасын барлық қосылған құрылғыларға тарату
function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {
      // Байланыс үзілген клиенттерді өшіру
    }
  });
}

const server = http.createServer((req, res) => {
  // CORS рұқсаттары
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. Сервердің Wi-Fi желісіндегі IP адресін қайтару
  if (pathname === '/api/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ip: LOCAL_IP,
      port: PORT,
      url: `http://${LOCAL_IP}:${PORT}`,
      bidderUrl: `http://${LOCAL_IP}:${PORT}/bidder.html`
    }));
    return;
  }

  // 2. Server-Sent Events (SSE) тікелей байланыс арнасы
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.push(res);

    // Қосылған бойда ағымдағы күйді жіберу
    res.write(`event: state_sync\ndata: ${JSON.stringify(latestGameState)}\n\n`);

    req.on('close', () => {
      sseClients = sseClients.filter((c) => c !== res);
    });
    return;
  }

  // 3. Телефоннан ставка қабылдау (POST /api/bid)
  if (pathname === '/api/bid' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const bidData = JSON.parse(body);
        // Негізгі экранға және барлық телефондарға ставканы жіберу
        broadcastSSE('incoming_bid', bidData);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'Ставка қабылданды' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 4. Негізгі экраннан ағымдағы күйді жаңарту (POST /api/state)
  if (pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const stateData = JSON.parse(body);
        latestGameState = { ...latestGameState, ...stateData };
        // Телефондарға жаңарған күйді тарату
        broadcastSSE('state_sync', latestGameState);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 5. Статикалық файлдарды тарату (HTML, CSS, JS, JSON)
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404: Файл табылмады');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500: Сервер қатесі');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('======================================================');
  console.log('       «АУКЦИОН» — ИНТЕРАКТИВТІ САУДА СЕРВЕРІ        ');
  console.log('======================================================');
  console.log(`🖥️  Негізгі экран (компьютер):  http://localhost:${PORT}`);
  console.log(`📱  Телефондар үшін (Wi-Fi):     http://${LOCAL_IP}:${PORT}/bidder.html`);
  console.log('======================================================');
});
