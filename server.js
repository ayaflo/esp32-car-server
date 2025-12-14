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
    // ESP32-CAM gửi "type:cam" (text) để đăng ký
    if (!isBinary) {
      const text = data.toString();
      console.log('WS /cam text:', text);

      if (text === 'type:cam') {
        camSocket = ws;
        console.log('Registered cam client');
      }
      return;
    }

    // Nếu là binary -> giả sử là frame JPEG từ cam, broadcast cho viewers
    // (viewers là các browser)
    for (const client of viewers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: true });
      }
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

  // Tạm thời: nếu không phải cam đã đăng ký, coi là viewer
  // (ESP32‑CAM sẽ gửi "type:cam" ngay sau khi connect)
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
