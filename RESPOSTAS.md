# Respostas Conceituais — Parte 1.A

## Pergunta 1 — Diagnóstico, trade-offs e arquitetura alvo

### 01 | Performance da vitrine
- **Causa raiz:** a loja consulta o ERP de forma síncrona a cada request; não existe camada de cache; o ERP não foi dimensionado para milhões de acessos.
- **Impacto:** cliente sofre latência/timeout; negócio perde conversão; operação corre risco de sobrecarregar o ERP (que também cuida de faturamento/financeiro).
- **Caminhos de solução:**
  - Cache em memória por instância — barato e simples, mas inconsistente entre múltiplas instâncias e não escala horizontalmente.
  - Cache distribuído (Redis) cache-aside com TTL curto — baixa latência, consistente entre instâncias; custo operacional de manter Redis. **Recomendado no curto prazo.**
  - Banco próprio da loja, replicado do ERP (CDC/sync assíncrono) — desacopla totalmente a leitura do ERP; maior complexidade de implementação e operação. **Recomendado no médio prazo.**

### 02 | Consistência de estoque
- **Causa raiz:** a checagem de estoque não é atômica — ler saldo e decrementar são passos separados, permitindo que duas requisições concorrentes leiam o mesmo saldo antes de qualquer decremento (race condition).
- **Impacto:** cliente recebe pedido que não pode ser cumprido; negócio tem prejuízo financeiro/reputacional; operação lida com estornos manuais e suporte sobrecarregado.
- **Caminhos de solução:**
  - Atomic update condicional (`UPDATE ... WHERE stock > 0`) — baixa latência, boa consistência; não reserva o item durante o checkout. **Recomendado como padrão.**
  - Reserva de estoque com expiração (hold temporário) — melhor UX (segura o item enquanto o cliente paga); mais complexo (precisa de job de expiração).
  - Lock pessimista / distributed lock (ex: Redlock) — garante serialização total; adiciona latência e vira ponto de contenção. Só compensa em cenários de altíssima disputa pelo mesmo item.

### 03 | Resiliência do checkout
- **Causa raiz:** o checkout depende de forma síncrona da resposta do ERP, que é lenta; o cliente espera, sofre timeout, e retries sem idempotência duplicam pedidos.
- **Impacto:** cliente vê erro mesmo quando o pedido foi aceito; negócio tem pedidos duplicados ou perdidos; operação precisa reconciliar manualmente.
- **Caminhos de solução:**
  - Manter síncrono com timeout curto + retry no cliente — simples, mas não ataca a causa raiz e mantém risco de duplicidade.
  - Checkout assíncrono (`202 Accepted`) + fila + worker + idempotência — desacopla a latência do ERP da experiência do cliente. **Recomendado**, é o que foi implementado na mini-tarefa.

### Arquitetura alvo (30–90 dias)
- **0–30 dias:** cache-aside (Redis) na vitrine; checkout assíncrono com fila + idempotency key; logs estruturados com `correlationId`.
- **30–60 dias:** banco próprio da loja (read model) sincronizado do ERP; workers com retry + DLQ; métricas e dashboards básicos (cache hit rate, latência de checkout, tamanho da DLQ).
- **60–90 dias:** job de reconciliação (compara pedidos locais `PENDING`/`FAILED` com o status real no ERP e corrige divergências); alertas de SLO; runbooks documentados.

---

## Pergunta 2 — Cache, invalidação e performance da vitrine

- **Camadas:** aplicação → cache (Redis) → fallback direto ao ERP somente em cache miss.
- **TTL:** curto (15–60s) para preço/estoque, que mudam com frequência; mais longo para dados estáveis (nome, descrição, imagens).
- **Invalidação:** cache-aside como padrão (lazy load + TTL); refresh-ahead (revalidação em background antes de expirar) para produtos de alto tráfego, evitando pico de miss simultâneo.
- **Fallback:** se o ERP cair, servir a última versão do cache mesmo expirada (stale-if-error), sinalizando que o dado pode estar desatualizado.
- **Cache stampede:** lock/mutex por chave (só uma requisição repovoa o cache, as demais aguardam ou recebem stale) ou jitter no TTL para não expirar tudo no mesmo instante.
- **Métricas para validar o ganho sem gerar dados obsoletos:**
  - `cache_hit_ratio` e `erp_requests_avoided` — comprovam ganho de performance/custo.
  - p50/p95/p99 de latência de `GET /products` com e sem cache.
  - `cache_staleness_seconds` (idade do dado servido), com alerta se ultrapassar o limite aceitável.
  - Taxa de divergência entre preço/estoque em cache e no ERP, amostrada periodicamente.

---

## Pergunta 3 — Observabilidade (Datadog ou equivalente)

- **Logs estruturados (JSON):** `timestamp`, `level`, `service`, `event`, `correlationId`, `orderId` (quando existir), `productId`, `status`, `durationMs`, `errorCode`. Obrigatórios: `correlationId`, `event`, `timestamp`.
- **Métricas:**
  - Counters: `cache_hits_total`, `cache_misses_total`, `checkout_accepted_total`, `checkout_rejected_total`, `orders_completed_total`, `orders_failed_total`.
  - Gauges: tamanho da fila, estoque disponível, pedidos em memória.
  - Histograms: latência de `GET /products`, latência de `POST /checkout`, duração da chamada ao ERP.
- **Traces distribuídos:**
  - `GET /products`: span do handler → span de lookup no cache → span de chamada ao ERP (só em miss).
  - `POST /checkout`: span do handler (validação/idempotência/decremento) → span de publish na fila → (assíncrono) span do worker → span da chamada ao ERP → span de persistência do status final — todos propagando o mesmo `correlationId`.
- **SLI/SLO, alertas, dashboard e runbook:**
  - SLI: disponibilidade de `/products`; p95 de latência de `/checkout`; taxa de sucesso do worker.
  - SLO exemplo: 99,9% das respostas de `/products` < 300ms; 99% dos pedidos concluídos em até 2 minutos.
  - Alertas: `cache_hit_ratio` < 80% por 5min; fila crescendo continuamente (backlog); `orders_failed_total` (DLQ) > 0 nos últimos 15min.
  - Dashboard: cache hit/miss, latência por endpoint, tamanho da fila, pedidos por status, erro do ERP.
  - Runbook (implementado como exemplo no projeto): DLQ > 0 → verificar saúde do ERP → se ok, acionar `POST /orders/{orderId}/retry` → se ERP indisponível, escalar para infra e pausar novos consumos da fila.

---

## Pergunta 4 — Concorrência, estoque e idempotência

- **Por que a checagem simples é insuficiente:** ler o saldo e depois decrementar são duas operações separadas; entre elas, outra requisição concorrente pode ler o mesmo saldo (race condition/TOCTOU), permitindo overselling mesmo com apenas 1 unidade em estoque e 2 requisições simultâneas.
- **Comparação:**
  - **Atomic update condicional** (`UPDATE stock = stock - 1 WHERE stock > 0`): baixa latência, sem lock explícito, ótimo sob alta concorrência; não reserva o item durante o pagamento. **Usado na mini-tarefa** (decremento síncrono e imediato, sem passo intermediário de leitura).
  - **Pessimistic lock** (`SELECT ... FOR UPDATE`): simples de raciocinar, garante serialização; reduz throughput sob alta concorrência.
  - **Reserva de estoque** (hold com TTL): melhor UX, mas exige job de expiração/confirmação.
  - **Distributed lock** (ex: Redlock): útil quando o recurso não está em um único banco transacional; adiciona latência de rede e risco de lock mal liberado — só se atomic update não for viável.
- **Idempotência:** o cliente gera um `x-idempotency-key` único por tentativa de compra; o servidor guarda `key → orderId`. Em retry, duplo clique ou reprocessamento, a mesma key retorna o mesmo `orderId` sem decrementar estoque novamente nem criar um novo pedido.
- **Como testar:** disparar N requisições concorrentes (`Promise.all`) contra um estoque conhecido e validar que o total de pedidos aceitos nunca excede o estoque inicial — implementado em [tests/checkout.test.ts](tests/checkout.test.ts).

---

## Pergunta 5 — Mensageria, resiliência, contrato e IA

- **Ordem publish vs. gravação:** publicar na fila **depois** de gravar o pedido localmente (status `PENDING`), nunca antes.
  - Se publicasse antes: uma falha ao persistir gera **mensagem fantasma** (a fila processa um pedido que não existe no banco).
  - Gravando antes e publicando depois: uma falha no publish pode gerar **pedido fantasma** (preso em `PENDING` para sempre). Mitigação: padrão **Outbox** — gravar pedido e evento na mesma transação/tabela outbox, com um processo separado garantindo publicação at-least-once a partir do outbox.
  - Mensagem fantasma residual é evitada porque o worker sempre valida se o pedido existe antes de processar, e é idempotente por `orderId`.
- **Retry e DLQ:** o worker tenta reprocessar automaticamente (3 tentativas); ao esgotar as tentativas, o pedido vai para `FAILED` (equivalente à DLQ). Um endpoint de retry manual (`POST /orders/{orderId}/retry`) permite ao suporte reprocessar depois que a causa raiz for corrigida — ambos implementados na mini-tarefa.
- **Reconciliação:** job periódico que compara pedidos `PENDING` há mais tempo que o esperado (ou `FAILED`) com o status real no ERP, corrigindo divergências — descrito na arquitetura de 60–90 dias (Pergunta 1), não implementado no código por estar fora do escopo da mini-tarefa.
- **Contrato:** OpenAPI ([swagger.yaml](swagger.yaml)) com schemas de sucesso e erro para `/products`, `/checkout`, `/orders/{id}/status` e `/orders/{id}/retry`.
- **Testes:** cache hit/miss, idempotência, prevenção de overselling sob concorrência e o ciclo completo falha → DLQ → retry manual → sucesso — [tests/checkout.test.ts](tests/checkout.test.ts).
- **Prompts de IA:** registrados em [PROMPTS.md](PROMPTS.md).
