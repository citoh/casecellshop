import { Router } from 'express';
import { inventoryDB } from '../domain/inventory';
import { ordersDB } from '../domain/orders';
import { metrics, percentile } from '../observability/metrics';

const router = Router();

// GET /metrics - snapshot simples (simulando export de counters/gauges/histograms para o Datadog Agent)
router.get('/metrics', (req, res) => {
    res.json({
        counters: {
            cache_hits_total: metrics.cache_hits_total,
            cache_misses_total: metrics.cache_misses_total,
            checkout_accepted_total: metrics.checkout_accepted_total,
            checkout_rejected_out_of_stock_total: metrics.checkout_rejected_out_of_stock_total,
            checkout_idempotent_replay_total: metrics.checkout_idempotent_replay_total,
            orders_completed_total: metrics.orders_completed_total,
            orders_failed_total: metrics.orders_failed_total,
            worker_retry_total: metrics.worker_retry_total,
        },
        gauges: {
            inventory_case_01: inventoryDB['case-01'] ?? 0,
            inventory_case_02: inventoryDB['case-02'] ?? 0,
            orders_in_memory: ordersDB.size,
        },
        histograms: {
            checkout_duration_ms: {
                p50: percentile(metrics.checkout_duration_ms, 50),
                p95: percentile(metrics.checkout_duration_ms, 95),
                p99: percentile(metrics.checkout_duration_ms, 99),
            },
        },
    });
});

export default router;
