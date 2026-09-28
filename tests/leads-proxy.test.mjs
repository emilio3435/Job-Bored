import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough, Readable } from 'node:stream';
import { it } from 'node:test';
import { createDevServer } from '../dev-server.mjs';

function request(server, method, path, origin, body = '') {
  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = method;
    req.url = path;
    req.headers = { host: '127.0.0.1:49123', ...(origin ? { origin } : {}), 'content-type': 'application/json' };
    req.socket = { remoteAddress: '127.0.0.1', localPort: 49123, encrypted: false };
    const res = new PassThrough();
    let text = '';
    res.statusCode = 200;
    res.headers = {};
    res.writeHead = function (status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
      return this;
    };
    res.on('data', (chunk) => { text += chunk; });
    res.on('finish', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    server.emit('request', req, res);
    req.end(body);
  });
}

it('Leads Chat forwards an authorized POST through the profile proxy and shares its guards', async () => {
  const forwarded = [];
  const realRequest = http.request;
  http.request = (options, onResponse) => {
    const upstream = new PassThrough();
    let body = '';
    upstream.on('data', (chunk) => { body += chunk; });
    upstream.on('finish', () => {
      forwarded.push({ options, body });
      const reply = Readable.from([JSON.stringify({ ok: true, reply: 'Proposal ready.', changes: [] })]);
      reply.statusCode = 200;
      reply.headers = { 'content-type': 'application/json' };
      onResponse(reply);
    });
    return upstream;
  };
  syncBuiltinESMExports();
  const server = createDevServer({ port: 49123, logger: { log() {}, error() {} } });
  try {
    const origin = 'http://127.0.0.1:49123';
    const preflight = await request(server, 'OPTIONS', '/api/leads/chat', origin);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], origin);

    const payload = JSON.stringify({ message: 'Show remote leads' });
    const accepted = await request(server, 'POST', '/api/leads/chat', origin, payload);
    assert.equal(accepted.status, 200);
    assert.equal(JSON.parse(accepted.body).reply, 'Proposal ready.');
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].options.path, '/api/leads/chat');
    assert.equal(forwarded[0].options.method, 'POST');
    assert.equal(forwarded[0].options.headers.origin, undefined);
    assert.equal(forwarded[0].body, payload);

    const refused = await request(server, 'POST', '/api/leads/chat', 'https://evil.example', payload);
    assert.equal(refused.status, 403);
    assert.equal(forwarded.length, 1, 'cross-site text never reaches the provider route');
    const wrongMethod = await request(server, 'PATCH', '/api/leads/chat', origin);
    assert.equal(wrongMethod.status, 405);
    const nearMiss = await request(server, 'OPTIONS', '/api/leads/chat/other', origin);
    assert.notEqual(nearMiss.status, 204);
  } finally {
    http.request = realRequest;
    syncBuiltinESMExports();
    server.close();
  }
});
