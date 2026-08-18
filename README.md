# CaseCellShop - Backend Sênior API

## Resumo
Solução desenvolvida em Node.js com TypeScript simulando o cenário de hipercrescimento da CaseCellShop. Foram priorizadas técnicas de cache, processamento assíncrono e prevenção de overselling.

As respostas das 5 perguntas conceituais (Parte 1.A) estão em [RESPOSTAS.md](RESPOSTAS.md). O registro de prompts de IA usados e a revisão humana de cada sugestão estão em [PROMPTS.md](PROMPTS.md).

## Requisitos considerados
O enunciado do desafio ([desafio-original.pdf](desafio-original.pdf)) descreve o cenário (hipercrescimento, vitrine lenta, overselling, checkout instável) mas não lista requisitos funcionais/não funcionais explícitos. Os requisitos abaixo foram **inferidos a partir do cenário** para orientar as decisões de implementação.

**Requisitos funcionais**
- RF01 — Listar catálogo de produtos com preço e estoque disponível.
- RF02 — Iniciar um pedido (checkout) para um produto.
- RF03 — Impedir a confirmação de um pedido sem estoque disponível (não permitir overselling).
- RF04 — Impedir a criação de pedidos duplicados quando o cliente reenvia a mesma requisição (idempotência).
- RF05 — Permitir consultar o status de um pedido.
- RF06 — Permitir que o suporte reprocesse manualmente um pedido que falhou.
- RF07 — Expor métricas operacionais do sistema.

**Requisitos não funcionais**
- RNF01 — Performance/escalabilidade: a vitrine deve suportar alto volume de acessos sem sobrecarregar o ERP.
- RNF02 — Resiliência: o checkout não pode depender de forma síncrona de um ERP lento/instável.
- RNF03 — Consistência: o decremento de estoque deve ser seguro sob concorrência (sem condição de corrida).
- RNF04 — Observabilidade: logs estruturados, métricas e traces correlacionáveis por requisição.
- RNF05 — Testabilidade: os fluxos críticos (cache, idempotência, concorrência, DLQ/retry) devem ter cobertura automatizada.
- RNF06 — Manutenibilidade: separação clara de camadas (rotas, domínio, cache, fila, observabilidade).

## Como executar (Simulado em memória)
1. `npm install`
2. `npm run dev` (Inicia o servidor na porta 3000 e o Worker assíncrono)
3. `npm test` (Roda os testes automatizados — cache, idempotência, overselling e ciclo de DLQ/retry)

## Endpoints
- `GET /products` — catálogo com cache (TTL 30s).
- `POST /checkout` — inicia checkout assíncrono. Requer header `x-idempotency-key`. Body opcional `simulateFailure: true` força falha simulada no worker, útil para exercitar o fluxo de retry/DLQ.
- `GET /orders/:orderId/status` — consulta status do pedido (`PENDING` | `COMPLETED` | `FAILED`).
- `POST /orders/:orderId/retry` — runbook de suporte: reprocessa manualmente um pedido em `FAILED`.
- `GET /metrics` — snapshot de counters, gauges e histograms (ver seção Observabilidade).

Contrato completo em [swagger.yaml](swagger.yaml).

## Estrutura de pastas
```
src/
  app.ts                    # monta o Express app (middlewares + rotas) — usado pelos testes
  server.ts                 # entrypoint: sobe o app na porta 3000
  routes/                   # 1 arquivo por recurso HTTP
    products.routes.ts
    checkout.routes.ts
    orders.routes.ts
    metrics.routes.ts
  domain/                   # estado e regras de negócio (estoque, pedidos, idempotência)
    inventory.ts
    orders.ts
    idempotency.ts
  cache/
    cache.ts                # cache genérico em memória com TTL
  queue/
    queue.ts                # fila simulada (EventEmitter)
    worker.ts                # consumidor: processa pedido, aplica retry/DLQ
  observability/
    metrics.ts               # counters/gauges/histograms
    tracing.ts                # stub de spans via logs correlacionados
  middleware/
    correlationId.ts
tests/
  checkout.test.ts          # testes de ponta a ponta via supertest, sobre src/app.ts
```

## Decisões Arquiteturais e Trade-offs
- **Stack:** Node.js + Express + TypeScript.
- **Cache (Vitrine):** Implementado em memória (simulando Redis) com TTL para o endpoint `GET /products`. Reduz a carga no "ERP".
- **Checkout Assíncrono:** `POST /checkout` retorna `202 Accepted`. A gravação ocorre no banco local (State: PENDING) e é enviada para um EventEmitter (simulando RabbitMQ/SQS) **depois** de o pedido já estar gravado — evita mensagem fantasma. Ver [RESPOSTAS.md, Pergunta 5](RESPOSTAS.md#pergunta-5--mensageria-resiliência-contrato-e-ia).
- **Concorrência (Estoque):** Simulada via atualização atômica no banco de dados em memória para garantir que não ocorra overselling.
- **Idempotência:** O header `x-idempotency-key` previne pedidos duplicados.

## Schema de Dados

### Modelo atual (em memória, mini-tarefa)
Não há banco real nesta entrega (ver Simplificações) — as "tabelas" são estruturas em memória dentro de `src/domain/`:

**products** — array hardcoded em [products.routes.ts](src/routes/products.routes.ts), combinado com `inventoryDB` a cada request:
| campo | tipo | descrição |
|---|---|---|
| id | string (PK) | ex.: `case-01` |
| name | string | |
| price | number | |
| stock | number | lido de `inventoryDB[id]` |

**inventoryDB** — `Record<string, number>` em [inventory.ts](src/domain/inventory.ts):
| campo | tipo | descrição |
|---|---|---|
| productId | string (PK) | chave do record |
| stock | number | decrementado via `decrementStock`, checado via `hasStock` |

**ordersDB** — `Map<orderId, Order>` em [orders.ts](src/domain/orders.ts):
| campo | tipo | descrição |
|---|---|---|
| orderId | string (PK) | `uuid v4` |
| status | `'PENDING'\|'COMPLETED'\|'FAILED'` | |
| productId | string (FK → inventoryDB) | |
| attempts | number | tentativas de envio ao ERP simulado (worker) |
| simulateFailure | boolean | flag de teste, ver Simplificações |

**idempotencyStore** — `Map<idempotencyKey, orderId>` em [idempotency.ts](src/domain/idempotency.ts):
| campo | tipo | descrição |
|---|---|---|
| idempotencyKey | string (PK) | valor do header `x-idempotency-key` |
| orderId | string (FK → ordersDB) | |

### Schema-alvo (banco próprio da loja, produção)
A arquitetura de 30–90 dias descrita em [RESPOSTAS.md, Pergunta 1](RESPOSTAS.md#pergunta-1--diagnóstico-trade-offs-e-arquitetura-alvo) prevê um banco próprio da loja (read model sincronizado do ERP) e o padrão Outbox descrito em [RESPOSTAS.md, Pergunta 5](RESPOSTAS.md#pergunta-5--mensageria-resiliência-contrato-e-ia) para eliminar mensagem fantasma. Estrutura de dados equivalente (relacional, tipo de banco em aberto — Postgres/MySQL):

**products** — read model sincronizado do ERP (CDC/polling), fonte de leitura da vitrine:
| campo | tipo | descrição |
|---|---|---|
| id | string (PK) | |
| name | string | |
| price | decimal | |
| stock | integer | |
| synced_at | timestamp | última sincronização com o ERP |
| erp_version | integer | detecta sync desatualizado/stale |

**orders**:
| campo | tipo | descrição |
|---|---|---|
| id | uuid (PK) | |
| product_id | string (FK → products) | |
| status | enum (`PENDING`\|`COMPLETED`\|`FAILED`) | |
| attempts | integer | tentativas de envio ao ERP |
| idempotency_key | string (único) | |
| correlation_id | string | |
| created_at / updated_at | timestamp | |

Índice por `status` para suportar o runbook de DLQ e a reconciliação com o ERP.

**outbox_events** — padrão Outbox: grava pedido + evento na mesma transação, evitando mensagem fantasma (publish falho) e pedido fantasma (publish sem gravação):
| campo | tipo | descrição |
|---|---|---|
| id | serial (PK) | |
| order_id | uuid (FK → orders) | |
| event_type | string | ex.: `order_created` |
| payload | json | |
| published_at | timestamp (nullable) | `NULL` = ainda não publicado na fila |
| created_at | timestamp | |

Este schema é conceitual (não foi implementado): não há banco real nesta entrega, e as tabelas acima só existem em memória (seção anterior). Um banco real, quando existir, seria criado/versionado via ferramenta de migration (ex.: Prisma, Knex, Flyway) rodando em um container descartável (`docker-compose` local ou serviço gerenciado em staging/produção via CI/CD, ver seção abaixo) — nunca com scripts SQL aplicados manualmente.

## Observabilidade (Datadog Reference)
- **Logs:** Implementados via `console.log` formatados em JSON (simulando Pino/Winston) com `correlationId` e `orderId`.
- **Traces (stub):** cada operação relevante (`get_products`, `checkout_handler`, `worker_process_order`) emite um par de logs `span_start`/`span_end` com o mesmo `correlationId` e a duração calculada — simula um tracer tipo OpenTelemetry/Datadog APM sem depender de conta real.
- **Métricas:** expostas em `GET /metrics` — counters (`cache_hits_total`, `checkout_accepted_total`, `orders_failed_total`, etc.), gauges (estoque, pedidos em memória) e um histograma simples (p50/p95/p99) da duração do handler de checkout.
- **Runbook DLQ:** se um pedido falhar 3x no envio ao ERP (via `simulateFailure`), o status muda para `FAILED` (simulando DLQ). O suporte aciona `POST /orders/:orderId/retry` para reprocessar.

### Exemplo de monitor/dashboard Datadog (equivalente)
```yaml
# monitor: DLQ com pedidos parados
name: "CaseCellShop - Pedidos em DLQ"
query: "sum(last_15m):sum:orders_failed_total{service:casecellshop} > 0"
message: |
  Há pedidos em FAILED (DLQ) nos últimos 15 minutos.
  Runbook: verificar saúde do ERP -> se ok, POST /orders/{orderId}/retry -> se ERP fora, escalar para infra.

# monitor: queda no cache hit ratio (risco de sobrecarregar o ERP)
name: "CaseCellShop - Cache hit ratio baixo"
query: "avg(last_5m):cache_hits_total / (cache_hits_total + cache_misses_total) < 0.8"

# dashboard: widgets sugeridos
- cache hit vs miss (timeseries)
- p50/p95/p99 de checkout_duration_ms
- orders por status (PENDING/COMPLETED/FAILED)
- inventory_case_01 / inventory_case_02 (gauge)
```

## Testes
`npm test` executa (via `node --test` + `supertest`):
- cache hit/miss em `GET /products`;
- exigência do header de idempotência;
- idempotência (mesma key não decrementa estoque duas vezes);
- prevenção de overselling sob 20 requisições concorrentes;
- 404 para pedido inexistente;
- ciclo completo falha → 3 tentativas → `FAILED` (DLQ) → retry manual → `COMPLETED`.

## CI/CD (GitHub Actions)
Estrutura de pipeline com três workflows em [.github/workflows/](.github/workflows/):

- **[ci.yml](.github/workflows/ci.yml)** — roda em todo push e pull request: `npm ci` → `npm run build` → `npm test`. É o gate de qualidade antes de qualquer deploy.
- **[deploy-staging.yml](.github/workflows/deploy-staging.yml)** — dispara automaticamente a cada push em `main`: repete build/test, builda a imagem Docker ([Dockerfile](Dockerfile)) e publica no registry, depois faz o deploy no ambiente `staging`.
- **[deploy-production.yml](.github/workflows/deploy-production.yml)** — dispara na publicação de uma release (ou manualmente via `workflow_dispatch`): mesmo pipeline de build/test/imagem, mas usa o ambiente `production`, com **approval manual** — configurado como *required reviewers* no ambiente do GitHub (Settings → Environments), não no YAML.

**Fluxo:** PR → `ci.yml` valida → merge em `main` → `deploy-staging.yml` publica automaticamente → validação manual em staging → criação de uma release → `deploy-production.yml` aguarda aprovação do reviewer e publica em produção.

**Assumido/simplificado** (não há infraestrutura de deploy real neste desafio):
- Os passos de build/push de imagem usam `secrets.REGISTRY*` (registry de imagens a definir — ex.: Docker Hub, ECR, GCR/Artifact Registry).
- O passo final de deploy em cada workflow é um placeholder (`echo`) no lugar do comando real do provedor (ex.: `aws ecs update-service`, `gcloud run deploy`, `kubectl set image`), já que a mini-tarefa não define onde a aplicação seria hospedada.
- A separação staging/produção usa [GitHub Environments](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment), que também é onde ficam os secrets por ambiente e a regra de aprovação obrigatória em produção.

## Simplificações assumidas
- Estoque, pedidos, cache, idempotência e fila vivem em memória (sem persistência real) — reinicia ao subir o processo.
- `WORKER_DELAY_MS` foi reduzido para 60ms (em vez de simular segundos de latência real do ERP) para manter os testes rápidos.
- A falha do worker é determinística e opt-in (`simulateFailure` no body do checkout), não randômica, para tornar o teste do fluxo de DLQ/retry reprodutível.
- Reconciliação automática com o ERP não foi implementada no código (fora do escopo da mini-tarefa); a estratégia está descrita em [RESPOSTAS.md, Pergunta 1](RESPOSTAS.md#pergunta-1--diagnóstico-trade-offs-e-arquitetura-alvo).
