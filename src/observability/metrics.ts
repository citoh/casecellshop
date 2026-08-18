// Métricas simples em memória (simulando counters/gauges/histograms de um APM tipo Datadog)
export const metrics = {
    cache_hits_total: 0,
    cache_misses_total: 0,
    checkout_accepted_total: 0,
    checkout_rejected_out_of_stock_total: 0,
    checkout_idempotent_replay_total: 0,
    orders_completed_total: 0,
    orders_failed_total: 0,
    worker_retry_total: 0,
    checkout_duration_ms: [] as number[], // histograma bruto (últimas N amostras)
};

export function recordCheckoutDuration(ms: number): void {
    metrics.checkout_duration_ms.push(ms);
    if (metrics.checkout_duration_ms.length > 1000) metrics.checkout_duration_ms.shift();
}

export function percentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}
