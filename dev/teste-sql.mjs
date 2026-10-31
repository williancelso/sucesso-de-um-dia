// Testa as funções do banco num Postgres em memória (PGlite).  Rodar: npm test
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const raiz = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec('create role anon; create role authenticated;');
await db.exec(await readFile(raiz + '/supabase/01-estrutura.sql', 'utf8'));
await db.exec(await readFile(raiz + '/supabase/01-estrutura.sql', 'utf8')); // rodar de novo não pode quebrar
await db.exec(await readFile(raiz + '/supabase/02-importar-willian.sql', 'utf8'));
const call = async (fn, args) => {
  const n = Object.keys(args);
  const r = await db.query(`select public.${fn}(${n.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, n.map(k => args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return r.rows[0].r;
};
let falhou = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'ok   ' : 'FALHA') + ' ' + msg + (cond || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!cond) falhou++; };

let r = await call('cadastrar', { p_nome: 'Ana Letícia', p_pin: '1234', p_codigo: 'errado' });
ok(r.erro === 'codigo_invalido', 'código do time errado é recusado', r);
r = await call('cadastrar', { p_nome: 'Ana Letícia', p_pin: '12a4', p_codigo: 'autentica74' });
ok(r.erro === 'pin_invalido', 'PIN com letra é recusado', r);
r = await call('cadastrar', { p_nome: 'Ana Letícia', p_pin: '1234', p_codigo: ' AUTENTICA74 ' });
ok(r.ok && r.token && r.importado === false, 'cadastro com código em maiúsculas e espaços', r);
const tokAna = r.token;
r = await call('cadastrar', { p_nome: 'ana leticia', p_pin: '9999', p_codigo: 'autentica74' });
ok(r.erro === 'nome_em_uso', 'mesmo nome sem acento conta como repetido', r);

r = await call('cadastrar', { p_nome: '  Willian   Celso ', p_pin: '4321', p_codigo: 'autentica74' });
ok(r.ok && r.importado === true, 'Willian se cadastra e o progresso antigo entra', r);
const tokW = r.token;
r = await call('meus_dados', { p_token: tokW });
ok(r.ok && r.pessoa.nome === 'Willian Celso' && r.pessoa.admin === true, 'Willian vira administrador com nome limpo', r.pessoa);
ok(Object.keys(r.dias).length === 25 && r.dias['2026-10-29'].length === 4 && r.dias['2026-10-06'].length === 5, '25 dias importados, dia 29 com 4 itens', Object.keys(r.dias).length);
ok(r.config.codigo === 'autentica74' && r.config.inicio === '2026-10-06' && r.config.dias === 74, 'admin vê config com o código', r.config);
const dAna = await call('meus_dados', { p_token: tokAna });
ok(dAna.config.codigo === null && dAna.pessoa.admin === false, 'quem não é admin não vê o código', dAna.config);

// Meu desafio: treinos por semana, descansos e dieta
r = await call('meus_dados', { p_token: tokW });
ok(r.pessoa.treinos_semana === 6 && r.pessoa.dieta === null, 'padrão: 6 treinos por semana e dieta em branco', r.pessoa);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-19', p_itens: ['dieta', 'descanso', 'estudo', 'trabalho', 'oracao'] });
ok(r.ok, 'descanso vale no lugar do treino', r);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-21', p_itens: ['descanso'] });
ok(r.erro === 'limite_descanso', 'com 6 treinos só cabe 1 descanso na semana', r);
r = await call('definir_desafio', { p_token: tokW, p_treinos: 4, p_dieta: 'x' });
ok(r.erro === 'treinos_invalido', '4 treinos é recusado (só 5 ou 6)', r);
r = await call('definir_desafio', { p_token: tokW, p_treinos: 7, p_dieta: 'x' });
ok(r.erro === 'treinos_invalido', '7 treinos é recusado (só 5 ou 6)', r);
r = await call('definir_desafio', { p_token: tokW, p_treinos: 5, p_dieta: 'x'.repeat(141) });
ok(r.erro === 'dieta_longa', 'dieta com mais de 140 letras é recusada', r);
r = await call('definir_desafio', { p_token: tokW, p_treinos: 5, p_dieta: '  Sem açúcar e sem fritura  ' });
ok(r.ok, 'definir 5 treinos e a dieta', r);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-21', p_itens: ['dieta', 'descanso'] });
ok(r.ok, 'com 5 treinos cabem 2 descansos na semana', r);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-22', p_itens: ['descanso'] });
ok(r.erro === 'limite_descanso', 'o terceiro descanso da semana é recusado', r);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-22', p_itens: ['treino', 'descanso', 'dieta'] });
r = await call('meus_dados', { p_token: tokW });
ok(JSON.stringify(r.dias['2026-10-22']) === '["dieta","treino"]', 'treino e descanso juntos: fica o treino', r.dias['2026-10-22']);
ok(r.pessoa.treinos_semana === 5 && r.pessoa.dieta === 'Sem açúcar e sem fritura', 'dieta gravada sem espaços sobrando', r.pessoa);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-26', p_itens: ['descanso'] });
ok(r.ok, 'semana nova libera os descansos de novo', r);
r = await call('placar', { p_token: tokW });
ok(r.pessoas[0].d['2026-10-19'] === 5, 'no placar o dia com descanso conta 5 de 5', r.pessoas[0].d['2026-10-19']);
ok(r.pessoas[0].d['2026-10-10'] === 4, 'no placar o trabalho do sábado não conta (importado com os 5)', r.pessoas[0].d['2026-10-10']);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-24', p_itens: ['trabalho', 'dieta', 'oracao'] });
ok(r.ok, 'sábado com trabalho marcado é aceito', r);
r = await call('salvar_dia', { p_token: tokW, p_dia: '2026-10-25', p_itens: ['trabalho'] });
r = await call('meus_dados', { p_token: tokW });
ok(JSON.stringify(r.dias['2026-10-24']) === '["dieta","oracao"]', 'no sábado o trabalho não é gravado', r.dias['2026-10-24']);
ok(r.dias['2026-10-25'] === undefined, 'domingo só com trabalho fica vazio', r.dias['2026-10-25']);
ok(JSON.stringify(r.dias['2026-10-23']) !== undefined && r.dias['2026-10-23'].includes('trabalho'), 'na sexta o trabalho continua', r.dias['2026-10-23']);

r = await call('entrar', { p_nome: 'WILLIAN CELSO', p_pin: '4321' });
ok(r.ok && r.token, 'entrar com nome em maiúsculas', r);
r = await call('entrar', { p_nome: 'Fulano', p_pin: '4321' });
ok(r.erro === 'nao_encontrado', 'nome inexistente', r);
for (let i = 0; i < 4; i++) { r = await call('entrar', { p_nome: 'Ana Letícia', p_pin: '0000' }); }
ok(r.erro === 'pin_errado', '4 PINs errados ainda não bloqueiam', r);
r = await call('entrar', { p_nome: 'Ana Letícia', p_pin: '0000' });
r = await call('entrar', { p_nome: 'Ana Letícia', p_pin: '1234' });
ok(r.erro === 'bloqueado' && r.minutos >= 14, 'no 5º erro bloqueia por 15 min, até com o PIN certo', r);

r = await call('salvar_dia', { p_token: tokAna, p_dia: '2026-10-20', p_itens: ['dieta', 'treino', 'treino', 'hacker'] });
ok(r.ok, 'salvar dia filtra itens inválidos', r);
r = await call('salvar_dia', { p_token: tokAna, p_dia: '2026-09-01', p_itens: ['dieta'] });
ok(r.erro === 'dia_invalido', 'dia fora do desafio é recusado', r);
r = await call('salvar_dia', { p_token: tokAna, p_dia: '2026-12-15', p_itens: ['dieta'] });
ok(r.erro === 'dia_invalido', 'dia no futuro é recusado', r);
r = await call('salvar_dia', { p_token: 'token-falso', p_dia: '2026-10-20', p_itens: ['dieta'] });
ok(r.erro === 'sessao', 'sessão falsa é recusada', r);
r = await call('meus_dados', { p_token: tokAna });
ok(JSON.stringify(r.dias['2026-10-20']) === '["dieta","treino"]', 'itens gravados sem repetição', r.dias);
await call('salvar_dia', { p_token: tokAna, p_dia: '2026-10-20', p_itens: [] });
r = await call('meus_dados', { p_token: tokAna });
ok(!r.dias['2026-10-20'], 'desmarcar tudo apaga o dia', r.dias);
await call('salvar_dia', { p_token: tokAna, p_dia: '2026-10-21', p_itens: ['oracao'] });

r = await call('anotar_espelho', { p_token: tokAna, p_dia: '2026-10-21', p_txt: 'Rolei o feed', p_min: 30 });
ok(r.ok && r.id, 'anotar no espelho', r);
const idEsp = r.id;
r = await call('anotar_espelho', { p_token: tokAna, p_dia: '2026-10-21', p_txt: '   ', p_min: 30 });
ok(r.erro === 'anotacao_invalida', 'anotação vazia é recusada', r);
r = await call('apagar_espelho', { p_token: tokW, p_id: idEsp });
r = await call('meus_dados', { p_token: tokAna });
ok(r.espelho.length === 1, 'outra pessoa não consegue apagar o Espelho da Ana', r.espelho);
r = await call('meus_dados', { p_token: tokW });
ok(r.espelho.length === 0, 'Willian não vê o Espelho da Ana', r.espelho);

// Diário autobiográfico
await db.exec(await readFile(raiz + '/supabase/01-estrutura.sql', 'utf8')); // rodar de novo leva o Espelho antigo para o diário
r = await call('ler_diario', { p_token: tokAna, p_dia: '2026-10-21' });
ok(r.ok && r.texto === '• Rolei o feed' && r.min === 30, 'anotação antiga do Espelho virou página do diário', r);
r = await call('salvar_diario', { p_token: tokAna, p_dia: '2026-10-28', p_texto: 'Confesso que adiei o treino.\nPercebi que foi preguiça.', p_min: 15 });
ok(r.ok, 'salvar uma página do diário', r);
r = await call('ler_diario', { p_token: tokAna, p_dia: '2026-10-28' });
ok(r.texto === 'Confesso que adiei o treino.\nPercebi que foi preguiça.' && r.min === 15, 'ler a página guarda o texto e as quebras de linha', r);
r = await call('meus_dados', { p_token: tokAna });
ok(r.diario.length === 2 && r.diario[0].dia === '2026-10-28' && r.diario[0].resumo === 'Confesso que adiei o treino. Percebi que foi preguiça.', 'índice do diário com resumo, mais recente primeiro', r.diario);
r = await call('ler_diario', { p_token: tokW, p_dia: '2026-10-28' });
ok(r.ok && r.texto === '' && r.min === null, 'Willian não lê o diário da Ana', r);
r = await call('salvar_diario', { p_token: tokAna, p_dia: '2026-12-20', p_texto: 'futuro', p_min: null });
ok(r.erro === 'dia_invalido', 'não escreve em dia que ainda não chegou', r);
r = await call('salvar_diario', { p_token: tokAna, p_dia: '2026-10-28', p_texto: 'x'.repeat(20001), p_min: null });
ok(r.erro === 'texto_longo', 'página acima de 20 mil letras é recusada', r);
r = await call('salvar_diario', { p_token: tokAna, p_dia: '2026-10-28', p_texto: '   ', p_min: 0 });
r = await call('meus_dados', { p_token: tokAna });
ok(r.diario.length === 1, 'apagar o texto e os minutos apaga a página', r.diario.map(d => d.dia));

r = await call('placar', { p_token: tokAna });
const nomes = r.pessoas.map(p => p.nome);
ok(r.ok && nomes.includes('Willian Celso') && nomes.includes('Ana Letícia'), 'placar mostra quem marcou algum dia', nomes);
const w = r.pessoas.find(p => p.nome === 'Willian Celso');
ok(w.d['2026-10-06'] === 5 && w.d['2026-10-30'] === 4 && !Array.isArray(w.d['2026-10-06']), 'placar só tem contagens', w.d['2026-10-30']);
await call('definir_placar', { p_token: tokAna, p_on: false });
r = await call('placar', { p_token: tokW });
ok(!r.pessoas.some(p => p.nome === 'Ana Letícia'), 'quem sai do placar some dele', r.pessoas.map(p => p.nome));

r = await call('ajustar_desafio', { p_token: tokAna, p_inicio: '2026-10-06', p_dias: 80, p_codigo: 'novo' });
ok(r.erro === 'sem_permissao', 'quem não é admin não ajusta o desafio', r);
r = await call('equipe', { p_token: tokAna });
ok(r.erro === 'sem_permissao', 'quem não é admin não vê a equipe', r);
r = await call('equipe', { p_token: tokW });
const ana = r.pessoas.find(p => p.nome === 'Ana Letícia');
ok(r.ok && ana && ana.bloqueado === true, 'admin vê a equipe e quem está bloqueado', r.pessoas);
r = await call('zerar_pin', { p_token: tokW, p_pessoa: ana.id, p_novo: '5555' });
ok(r.ok, 'admin zera o PIN da Ana', r);
r = await call('meus_dados', { p_token: tokAna });
ok(r.erro === 'sessao', 'zerar PIN derruba as sessões antigas da Ana', r);
r = await call('entrar', { p_nome: 'ana letícia', p_pin: '5555' });
ok(r.ok, 'Ana entra com o PIN novo e o bloqueio some', r);
const tokAna2 = r.token;
r = await call('trocar_pin', { p_token: tokAna2, p_atual: '1111', p_novo: '2222' });
ok(r.erro === 'pin_errado', 'trocar PIN exige o PIN atual', r);
r = await call('trocar_pin', { p_token: tokAna2, p_atual: '5555', p_novo: '2222' });
ok(r.ok, 'Ana troca o próprio PIN', r);
r = await call('ajustar_desafio', { p_token: tokW, p_inicio: '2026-10-06', p_dias: 74, p_codigo: 'Autentica2026' });
ok(r.ok, 'admin troca o código do time', r);
r = await call('cadastrar', { p_nome: 'Luan', p_pin: '1111', p_codigo: 'autentica74' });
ok(r.erro === 'codigo_invalido', 'código antigo deixa de valer', r);
r = await call('remover_pessoa', { p_token: tokW, p_pessoa: (await call('equipe', { p_token: tokW })).pessoas.find(p => p.eu).id });
ok(r.erro === 'nao_pode_remover_a_si', 'admin não remove a si mesmo', r);
r = await call('remover_pessoa', { p_token: tokW, p_pessoa: ana.id });
r = await call('equipe', { p_token: tokW });
ok(r.pessoas.length === 1, 'admin remove a Ana (e os dados dela vão junto)', r.pessoas.map(p => p.nome));
r = await call('sair', { p_token: tokW });
r = await call('meus_dados', { p_token: tokW });
ok(r.erro === 'sessao', 'sair encerra a sessão', r);

// Tabelas fechadas para o papel anônimo do app
await db.exec('set role anon');
let bloqueado = false;
try { await db.query('select * from public.pessoas'); } catch (e) { bloqueado = /permission denied/.test(e.message); }
ok(bloqueado, 'o app não lê as tabelas direto (só pelas funções)');
let internaFechada = false;
try { await db.query("select public._dados('00000000-0000-0000-0000-000000000000')"); } catch (e) { internaFechada = /permission denied/.test(e.message); }
ok(internaFechada, 'funções internas fechadas para o app');
r = (await db.query("select public.entrar(p_nome => 'Willian Celso', p_pin => '4321') as r")).rows[0].r;
ok(r.ok, 'o papel anônimo consegue entrar pela função pública', r);
await db.exec('reset role');

// Importação rodando depois do cadastro
const db2 = await PGlite.create({ extensions: { pgcrypto } });
await db2.exec('create role anon; create role authenticated;');
await db2.exec(await readFile(raiz + '/supabase/01-estrutura.sql', 'utf8'));
const t2 = (await db2.query("select public.cadastrar(p_nome => 'Willian Celso', p_pin => '1234', p_codigo => 'autentica74') as r")).rows[0].r;
await db2.exec(await readFile(raiz + '/supabase/02-importar-willian.sql', 'utf8'));
const d2 = (await db2.query('select public.meus_dados(p_token => $1) as r', [t2.token])).rows[0].r;
ok(t2.importado === false && Object.keys(d2.dias).length === 25 && d2.pessoa.admin === true, 'importar depois do cadastro também funciona', { n: Object.keys(d2.dias).length, admin: d2.pessoa.admin });

console.log(falhou ? `\n${falhou} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(falhou ? 1 : 0);
