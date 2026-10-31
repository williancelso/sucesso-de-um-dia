// Servidor de teste local: serve o app e imita a API do Supabase (/rest/v1/rpc/<função>)
// com um Postgres de verdade rodando em memória (PGlite), carregado com os mesmos SQLs
// da pasta supabase/. Nada sai do computador e tudo some ao fechar.
//
//   npm install   (uma vez)
//   npm run local  ->  http://localhost:8741
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const porta = Number(process.env.PORT) || 8741;

const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec('create role anon; create role authenticated;');
const sqls = (await readdir(join(raiz, 'supabase'))).filter(f => f.endsWith('.sql')).sort();
for (const f of sqls) {
  await db.exec(await readFile(join(raiz, 'supabase', f), 'utf8'));
  console.log('SQL aplicado:', f);
}

const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function rpc(fn, args) {
  const nomes = Object.keys(args);
  if (!nomes.every(n => /^p_[a-z_]+$/.test(n))) throw new Error('parâmetro inválido');
  const sql = `select public.${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  const valores = nomes.map(n => (args[n] !== null && typeof args[n] === 'object') ? JSON.stringify(args[n]) : args[n]);
  const res = await db.query(sql, valores);
  return res.rows[0].r;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z][a-z_]*)$/);
    if (m && req.method === 'POST') {
      let corpo = '';
      for await (const parte of req) corpo += parte;
      const r = await rpc(m[1], corpo ? JSON.parse(corpo) : {});
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const arq = normalize(join(raiz, p));
    if (!arq.startsWith(raiz) || arq.includes('node_modules') || arq.includes(`${'/'}supabase${'/'}`)) throw Object.assign(new Error('proibido'), { status: 404 });
    const dados = await readFile(arq);
    res.writeHead(200, { 'content-type': tipos[extname(arq)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(dados);
  } catch (e) {
    const status = e.status || (e.code === 'ENOENT' ? 404 : 400);
    if (status !== 404) console.error(e.message);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: e.message }));
  }
}).listen(porta, '127.0.0.1', () => console.log(`Sucesso de um Dia (teste local) em http://localhost:${porta}`));
