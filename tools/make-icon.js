// Genera assets/icon.png y assets/icon.ico a partir de assets/icon.svg.
// Uso: arrancar la app con  electron.exe . --remote-debugging-port=9333  y luego  node tools/make-icon.js
const fs = require('fs');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const PORT = 9333;

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const t = targets.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const page = path.join(assets, '_render.html');
  async function render(size) {
    fs.writeFileSync(page, `<html><body style="margin:0;background:transparent;overflow:hidden"><img style="width:${size}px;height:${size}px;display:block" src="icon.svg"></body></html>`);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') });
    await sleep(900);
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    if (!r.result) throw new Error('captura fallida: ' + JSON.stringify(r.error));
    return Buffer.from(r.result.data, 'base64');
  }

  const pngs = [];
  for (const s of SIZES) pngs.push({ size: s, data: await render(s) });
  fs.writeFileSync(path.join(assets, 'icon.png'), await render(512));
  fs.unlinkSync(page);

  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = [], blobs = [];
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0); e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8); e.writeUInt32LE(offset, 12);
    offset += p.data.length; entries.push(e); blobs.push(p.data);
  }
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, ...entries, ...blobs]));
  console.log('ok');
  ws.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
