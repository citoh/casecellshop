import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app';

function newIdempotencyKey() {
    return `key-${Math.random().toString(36).slice(2)}`;
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test('GET /products responde 200 e usa cache (2a chamada é cache hit)', async () => {
    const before = await request(app).get('/metrics');
    await request(app).get('/products');
    const second = await request(app).get('/products');
    const after = await request(app).get('/metrics');

    assert.equal(second.status, 200);
    assert.ok(after.body.counters.cache_hits_total > before.body.counters.cache_hits_total);
});

test('POST /checkout exige x-idempotency-key', async () => {
    const res = await request(app).post('/checkout').send({ productId: 'case-01' });
    assert.equal(res.status, 400);
});

test('POST /checkout é idempotente: mesma key retorna o mesmo orderId', async () => {
    const key = newIdempotencyKey();
    const first = await request(app).post('/checkout').set('x-idempotency-key', key).send({ productId: 'case-01' });
    const second = await request(app).post('/checkout').set('x-idempotency-key', key).send({ productId: 'case-01' });

    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal(first.body.orderId, second.body.orderId);
    assert.equal(second.body.idempotent, true);
});

test('POST /checkout nunca vende além do estoque, mesmo com requisições concorrentes', async () => {
    // 'case-01' tem estoque 10; o teste anterior consumiu 1, restam 9.
    const requests = Array.from({ length: 20 }, () =>
        request(app).post('/checkout').set('x-idempotency-key', newIdempotencyKey()).send({ productId: 'case-01' })
    );
    const results = await Promise.all(requests);

    const accepted = results.filter((r) => r.status === 202);
    const rejected = results.filter((r) => r.status === 422);

    assert.equal(accepted.length + rejected.length, 20);
    assert.ok(accepted.length <= 9, 'não pode aceitar mais pedidos do que o estoque restante');
    assert.ok(rejected.length > 0, 'deveria rejeitar por falta de estoque em algum momento');
});

test('GET /orders/:orderId/status retorna 404 para pedido inexistente', async () => {
    const res = await request(app).get('/orders/id-inexistente/status');
    assert.equal(res.status, 404);
});

test('Fluxo completo: falha simulada no worker leva o pedido a FAILED (DLQ) após 3 tentativas, e o retry manual o recupera', async () => {
    const key = newIdempotencyKey();
    const checkout = await request(app)
        .post('/checkout')
        .set('x-idempotency-key', key)
        .send({ productId: 'case-02', simulateFailure: true });

    assert.equal(checkout.status, 202);
    const { orderId } = checkout.body;

    await wait(400); // aguarda as 3 tentativas automáticas do worker

    const failedStatus = await request(app).get(`/orders/${orderId}/status`);
    assert.equal(failedStatus.body.status, 'FAILED');
    assert.equal(failedStatus.body.attempts, 3);

    const retry = await request(app).post(`/orders/${orderId}/retry`);
    assert.equal(retry.status, 202);

    await wait(200); // aguarda o reprocessamento pós-retry (sem falha simulada desta vez)

    const finalStatus = await request(app).get(`/orders/${orderId}/status`);
    assert.equal(finalStatus.body.status, 'COMPLETED');
});
