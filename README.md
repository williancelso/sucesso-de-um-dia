# Sucesso de um Dia

App do desafio de 74 dias da Autentica. Cada pessoa entra com **nome e PIN de 4 números** e tem:

- **Hoje:** os hábitos do dia (oração, estudo, trabalho com eficiência, dieta e treino), o desenho do dia, que ganha um traço a cada hábito marcado, e a folha com os 74 dias. O trabalho vale só de segunda a sexta; no sábado e no domingo o dia se vence com 4 hábitos.
- **Diário:** uma página por dia para confessar, refletir e analisar o dia, e as horas que a pessoa reconhece ter desperdiçado. Ninguém do time vê.
- **Time:** o placar (só quantos hábitos cada um marcou por dia), a troca de PIN e, para administradores, os ajustes do desafio e a lista de pessoas.

O app é uma página só (`index.html`) que conversa com um banco no Supabase.

## Como colocar no ar

### 1. Banco de dados (Supabase)

1. Em [supabase.com](https://supabase.com), crie um projeto novo, por exemplo `sucesso-de-um-dia`, na região São Paulo.
2. Abra **SQL Editor → New query**.
3. Abra o arquivo `supabase/01-estrutura.sql`, troque o código do time na linha marcada com `<<<`, cole tudo e clique em **Run**.
4. Em outra query, cole o arquivo `supabase/02-importar-willian.sql` e clique em **Run**. Ele traz os 25 dias do Willian do app antigo e o deixa como administrador.
5. Em **Project Settings → API**, copie a **Project URL** e a chave pública (**anon** ou **publishable**).

> Já feito em 31/10/2026: projeto `sucesso-de-um-dia` (São Paulo, plano gratuito), com os dois SQLs rodados.

### 2. Ligar o app ao banco

No `index.html`, as duas linhas do começo do script apontam para o projeto:

```js
const SUPABASE_URL='https://zromhsngincjsaygrdkk.supabase.co';
const SUPABASE_KEY='sb_publishable_…';
```

As duas são públicas por natureza. Quem protege os dados são as funções do banco. Se um dia trocar de projeto, troque essas duas linhas.

### 3. Publicar

O app é um arquivo estático e roda em qualquer hospedagem. Pelo GitHub Pages:

1. Crie um repositório público `sucesso-de-um-dia` no GitHub.
2. Envie esta pasta para ele (o `.gitignore` já deixa de fora o arquivo com o progresso do Willian).
3. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
4. O endereço fica `https://williancelso.github.io/sucesso-de-um-dia/`.

### 4. Primeiro acesso

1. O Willian abre o link, toca em **Fazer meu cadastro** e usa o nome **Willian Celso**, exatamente assim. O progresso antigo aparece na hora.
2. Depois, mande para o time o link de convite (em **Time → Link de convite**). Quem abre por ele não precisa digitar o código do time.

## Dia a dia

- **Esqueceu o PIN:** um administrador abre **Time → Pessoas → Zerar PIN**, define um PIN novo e avisa a pessoa. Ela pode trocar depois em **Sua conta**.
- **5 PINs errados seguidos** bloqueiam a pessoa por 15 minutos.
- **Trocar o código do time, a data de início ou a duração:** **Time → Ajustes do desafio**.
- **Tornar outra pessoa administradora:** no SQL Editor do Supabase, rode
  `update public.pessoas set admin = true where nome = 'Nome da Pessoa';`
- O Supabase gratuito pausa projetos sem uso por 7 dias. Com o time usando todo dia, isso não acontece.

## Para quem mexe no código

```bash
npm install
```

```bash
npm test
```

```bash
npm run local
```

- `npm test` roda os testes do banco num Postgres em memória (PGlite).
- `npm run local` abre o app em `http://localhost:8741` com um banco temporário montado a partir da pasta `supabase/`. Nada sai do computador e tudo some ao fechar.
