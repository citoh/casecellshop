import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { hasStock, decrementStock } from '../domain/inventory';
import { ordersDB } from '../domain/orders';
import { idempotencyStore } from '../domain/idempotency';
import { queue } from '../queue/queue';
import { metrics, recordCheckoutDuration } from '../observability/metrics';
import { startSpan } from '../observability/tracing';

const router = Router();

// POST /checkout - Assíncrono com Idempotência e Atomic Update simulado
router.post('/checkout', (req, res) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const span = startSpan('checkout_handler', correlationId);
    const start = Date.now();
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    const { productId, simulateFailure } = req.body;

    if (!idempotencyKey) {
        span.end({ result: 'error', reason: 'missing_idempotency_key' });
        return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key required' });
    }

    // Checagem de Idempotência
    if (idempotencyStore.has(idempotencyKey)) {
        metrics.checkout_idempotent_replay_total++;
        const orderId = idempotencyStore.get(idempotencyKey)!;
        span.end({ result: 'idempotent_replay', orderId });
        return res.status(200).json({ orderId, status: ordersDB.get(orderId)?.status ?? 'PENDING', idempotent: true });
    }

    // Controle de concorrência (Atomic Update Simulation)
    if (!hasStock(productId)) {
        metrics.checkout_rejected_out_of_stock_total++;
        span.end({ result: 'rejected', reason: 'out_of_stock' });
        return res.status(422).json({ error: 'OUT_OF_STOCK', message: 'Out of stock (Overselling prevented)' });
    }
    decrementStock(productId); // Baixa imediata para segurar o lock lógico

    const orderId = uuidv4();
    idempotencyStore.set(idempotencyKey, orderId);
    ordersDB.set(orderId, { orderId, status: 'PENDING', productId, attempts: 0, simulateFailure: !!simulateFailure });

    metrics.checkout_accepted_total++;
    recordCheckoutDuration(Date.now() - start);
    console.log(JSON.stringify({ correlationId, orderId, msg: 'Pedido Aceito. Enviando p/ fila', event: 'checkout_accepted' }));

    // Publica na fila (depois de gravar o pedido local — ver RESPOSTAS.md, Pergunta 5)
    queue.emit('process_order', { orderId, correlationId, productId });

    span.end({ result: 'accepted', orderId });
    res.status(202).json({ orderId, status: 'ACCEPTED' });
});

export default router;
