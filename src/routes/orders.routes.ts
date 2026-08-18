import { Router } from 'express';
import { ordersDB } from '../domain/orders';
import { queue } from '../queue/queue';

const router = Router();

// GET /orders/:orderId/status
router.get('/orders/:orderId/status', (req, res) => {
    const order = ordersDB.get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Not found' });
    res.json({ orderId: order.orderId, status: order.status, attempts: order.attempts });
});

// POST /orders/:orderId/retry - Runbook de suporte: reprocessa pedidos em DLQ (status FAILED)
router.post('/orders/:orderId/retry', (req, res) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const order = ordersDB.get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Not found' });
    if (order.status !== 'FAILED') {
        return res.status(409).json({ error: 'INVALID_STATE', message: 'Only FAILED orders can be retried manually' });
    }

    order.attempts = 0;
    order.status = 'PENDING';
    order.simulateFailure = false; // assume que a causa raiz foi corrigida antes do retry manual
    ordersDB.set(order.orderId, order);

    console.log(JSON.stringify({ correlationId, orderId: order.orderId, msg: 'Retry manual acionado via runbook', event: 'manual_retry' }));
    queue.emit('process_order', { orderId: order.orderId, correlationId, productId: order.productId });
    res.status(202).json({ orderId: order.orderId, status: 'PENDING' });
});

export default router;
