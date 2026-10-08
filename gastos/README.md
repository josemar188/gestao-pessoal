# Gastos

App pessoal para registar despesas. Os pagamentos com Apple Pay entram sozinhos (via app Atalhos do iPhone) e podes adicionar, editar e eliminar registos à mão. Inclui categorias, resumo mensal com gráficos e orçamentos por categoria.

- **App**: HTML/CSS/JS sem dependências de build, alojada no GitHub Pages e instalável no iPhone (PWA).
- **Dados**: Supabase (Postgres), com login e acesso restrito à tua conta (RLS).

## 1. Publicar no GitHub Pages

1. Cria um repositório no GitHub (tem de ser **público** no plano gratuito para usar o Pages) e envia estes ficheiros:
   ```bash
   git remote add origin https://github.com/O-TEU-UTILIZADOR/gastos.git
   git push -u origin main
   ```
2. No repositório: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. A app fica em `https://O-TEU-UTILIZADOR.github.io/gastos/`.

Nenhuma chave fica no repositório: o URL e a chave do Supabase são introduzidos na própria app e guardados só no dispositivo.

## 2. Criar a base de dados no Supabase

1. Cria um projeto gratuito em [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: cola o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e carrega em **Run**.
3. **Authentication → URL Configuration → Site URL**: põe o endereço da app (o do passo 1), para o link de confirmação de email abrir no sítio certo.
4. **Project Settings → API**: copia o **Project URL** e a chave pública (**anon** ou **publishable**). Nunca uses a chave `service_role` / `secret`.
5. Abre a app, cola o URL e a chave, e cria a tua conta (email + palavra-passe).

## 3. Instalar no iPhone

Abre o endereço da app no Safari → **Partilhar → Adicionar ao ecrã principal**.

## 4. Registar pagamentos Apple Pay automaticamente

O iOS não deixa nenhuma app ler as notificações da Carteira. O que existe é o gatilho **Transação** da app Atalhos (iOS 17 ou superior), que corre sempre que pagas com um cartão da Carteira.

Na app, vai a **Definições → Apple Pay automático** e carrega em **Mostrar o meu token**: ficam lá o URL, a `apikey` e o token prontos a copiar. Depois, no iPhone:

1. **Atalhos → Automação → +** → escolhe **Transação**.
2. Seleciona os cartões, deixa todas as categorias marcadas e escolhe **Executar imediatamente** → **Seguinte**.
3. **Nova automação em branco** → adiciona a ação **Obter conteúdo do URL**.
4. Preenche a ação:
   - **URL**: `https://O-TEU-PROJETO.supabase.co/rest/v1/rpc/ingest_expense`
   - **Método**: `POST`
   - **Cabeçalhos**: `apikey` = a tua chave pública
   - **Corpo do pedido**: `JSON`, com estes campos de texto:

     | Chave | Valor |
     |---|---|
     | `p_token` | o teu token (copiado da app) |
     | `p_amount` | variável **Entrada do atalho** → **Montante** |
     | `p_merchant` | variável **Entrada do atalho** → **Comerciante** |
     | `p_card` | variável **Entrada do atalho** → **Cartão ou passe** |

5. **OK**. Faz um pagamento de teste: o gasto aparece na app com data, hora, comerciante e cartão.

Os nomes das opções podem variar ligeiramente com a versão do iOS. A data e hora são as do momento em que a automação corre (logo a seguir ao pagamento).

**Categoria automática**: cada pagamento fica na categoria do último gasto no mesmo comerciante; se for um comerciante novo, usa as palavras-chave definidas em cada categoria (Definições → Categorias).

Se o token for exposto, gera um novo em Definições e atualiza o Atalho.

## Estrutura

```
index.html, styles.css, app.js   a app
sw.js, manifest.webmanifest      instalação e arranque offline
icons/                           ícones
supabase/schema.sql              tabelas, permissões e função que recebe os pagamentos
```

A biblioteca `supabase-js` é carregada do CDN jsDelivr (versão fixa). Sem rede, a app abre mas não mostra dados.
