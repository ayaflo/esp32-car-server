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

const wss = new WebSocket.Server({ server, path: '/car' });

let carSocket = null;
const controllers = new Set();

wss.on('connection', (ws) => {
  console.log('WS client connected to /car');

  ws.on('message', (msg) => {
    const text = msg.toString();
    console.log('WS message:', text);

    if (text === 'type:car') {
      carSocket = ws;
      console.log('Registered car client');
      return;
    }

    if (ws !== carSocket) {
      if (carSocket && carSocket.readyState === WebSocket.OPEN) {
        carSocket.send(text);
      }
    }
  });

  ws.on('close', () => {
    console.log('WS client disconnected');
    if (ws === carSocket) {
      carSocket = null;
      console.log('Car disconnected');
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`HTTP+WS server listening on port ${PORT}`);
});
