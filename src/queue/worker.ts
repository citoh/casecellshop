import { queue, OrderMessage } from './queue';
import { ordersDB } from '../domain/orders';
import { metrics } from '../observability/metrics';
import { startSpan } from '../observability/tracing';

const MAX_ATTEMPTS = 3;
const WORKER_DELAY_MS = 60; // reduzido para tornar os testes rápidos (simulação, não representa latência real do ERP)

// Worker Assíncrono (Simulando resiliência, retry e DLQ na integração com o ERP)
queue.on('process_order', (msg: OrderMessage) => {
    const span = startSpan('worker_process_order', msg.correlationId, { orderId: msg.orderId });
    console.log(JSON.stringify({ ...msg, msg: 'Worker iniciou processamento', event: 'worker_start' }));

    setTimeout(() => {
        const order = ordersDB.get(msg.orderId);
        if (!order) return;

        order.attempts += 1;

        // Falha simulada no ERP (opt-in via body.simulateFailure) para exercitar retry + DLQ
        if (order.simulateFailure && order.attempts < MAX_ATTEMPTS) {
            metrics.worker_retry_total++;
            ordersDB.set(msg.orderId, order);
            console.log(JSON.stringify({ ...msg, attempt: order.attempts, msg: 'Falha simulada no ERP. Reenfileirando', event: 'worker_retry' }));
            span.end({ result: 'retry', attempt: order.attempts });
            queue.emit('process_order', msg);
            return;
        }

        if (order.simulateFailure && order.attempts >= MAX_ATTEMPTS) {
            order.status = 'FAILED';
            ordersDB.set(msg.orderId, order);
            metrics.orders_failed_total++;
            console.log(JSON.stringify({ ...msg, attempt: order.attempts, msg: 'Pedido falhou 3x. Movido para DLQ (FAILED)', event: 'worker_dlq' }));
            span.end({ result: 'dlq', attempt: order.attempts });
            return;
        }

        order.status = 'COMPLETED';
        ordersDB.set(msg.orderId, order);
        metrics.orders_completed_total++;
        console.log(JSON.stringify({ ...msg, msg: 'Pedido processado no ERP com sucesso', event: 'worker_success' }));
        span.end({ result: 'success' });
    }, WORKER_DELAY_MS);
});
