import { Router } from 'express';
import { getCache, setCache } from '../cache/cache';
import { inventoryDB } from '../domain/inventory';
import { metrics } from '../observability/metrics';
import { startSpan } from '../observability/tracing';

const router = Router();

const CACHE_KEY = 'vitrine_products';
const CACHE_TTL_MS = 30000;

// GET /products - Cache com TTL
router.get('/products', (req, res) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const span = startSpan('get_products', correlationId);

    const cached = getCache<any>(CACHE_KEY);
    if (cached) {
        metrics.cache_hits_total++;
        console.log(JSON.stringify({ correlationId, msg: 'Cache Hit', event: 'get_products' }));
        span.end({ cache: 'hit' });
        return res.json(cached);
    }

    metrics.cache_misses_total++;
    console.log(JSON.stringify({ correlationId, msg: 'Cache Miss - Buscando ERP', event: 'get_products' }));
    const data = [
        { id: 'case-01', name: 'Capinha XYZ', price: 99.9, stock: inventoryDB['case-01'] },
        { id: 'case-02', name: 'Capinha ABC', price: 79.9, stock: inventoryDB['case-02'] },
    ];

    setCache(CACHE_KEY, data, CACHE_TTL_MS);
    span.end({ cache: 'miss' });
    res.json(data);
});

export default router;
