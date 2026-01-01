const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

// ===== WS /car: điều khiển xe =====
const wssCar = new WebSocket.Server({ noServer: true });
let carSocket = null;

wssCar.on('connection', (ws) => {
  console.log('WS client connected to /car');

  ws.on('message', (msg) => {
    const text = msg.toString();
    console.log('WS /car message:', text);

    if (text === 'type:car') {
      carSocket = ws;
      console.log('Registered car client');
      return;
    }

    // client điều khiển -> forward cho car
    if (ws !== carSocket) {
      if (carSocket && carSocket.readyState === WebSocket.OPEN) {
        carSocket.send(text);
      }
    }
  });

  ws.on('close', () => {
    console.log('WS /car client disconnected');
    if (ws === carSocket) {
      carSocket = null;
      console.log('Car disconnected');
    }
  });

  ws.on('error', (err) => {
    console.error('WS /car error:', err);
  });
});

// ===== WS /cam: stream video từ ESP32-CAM =====
const wssCam = new WebSocket.Server({ noServer: true });

let camSocket = null;          // ESP32‑CAM
const viewers = new Set();     // các browser xem video

wssCam.on('connection', (ws, request) => {
  console.log('WS client connected to /cam');

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      // ESP32-CAM gửi "type:cam" để đăng ký
      const text = data.toString();
      console.log('WS /cam text:', text);
      if (text === 'type:cam') {
        camSocket = ws;
        console.log('Registered cam client');
      }
      return;
    }

    // Binary: giả sử là JPEG frame -> broadcast tới viewers
    for (const client of viewers) {
      if (client.readyState !== WebSocket.OPEN) continue;

      // Bảo vệ realtime: nếu client backlog lớn, bỏ frame này để tránh tích lũy độ trễ [web:86]
      if (client.bufferedAmount > 512 * 1024) continue;

      client.send(data, { binary: true });
    }
  });

  ws.on('close', () => {
    console.log('WS /cam client disconnected');
    if (ws === camSocket) {
      camSocket = null;
      console.log('Camera disconnected');
    }
    viewers.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WS /cam error:', err);
  });

  // Mặc định: nếu chưa gửi "type:cam", coi ws này là viewer
  viewers.add(ws);
});

// ===== Upgrade routing cho 2 path khác nhau =====
server.on('upgrade', (request, socket, head) => {
  const { url } = request;

  if (url === '/car') {
    wssCar.handleUpgrade(request, socket, head, (ws) => {
      wssCar.emit('connection', ws, request);
    });
  } else if (url === '/cam') {
    wssCam.handleUpgrade(request, socket, head, (ws) => {
      wssCam.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`HTTP+WS server listening on port ${PORT}`);
});



// ... giữ nguyên các require và PORT

const MUSIC_DIR = path.join(__dirname, 'music');

function contentTypeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.aac') return 'audio/aac';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  // 1) Trang web như cũ
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // 2) Endpoint phát nhạc: /music/<tenfile>
  if (req.url.startsWith('/music/')) {
    const safeName = path.basename(req.url);           // chặn ../
    const filePath = path.join(MUSIC_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Music not found');
      return;
    }

    const stat = fs.statSync(filePath);
    const range = req.headers.range; // ví dụ "bytes=0-"

    const ct = contentTypeByExt(filePath);

    if (!range) {
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Range support
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (!m) {
      res.writeHead(416);
      res.end();
      return;
    }

    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : (stat.size - 1);
    if (start >= stat.size || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    const chunkSize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Type': ct,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  // 404 như cũ
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
