// Trace/span stub — simula um tracer (OpenTelemetry/Datadog APM) via logs correlacionados.
// Justificativa: sem conta real de APM, o span é representado por um par de logs
// (span_start/span_end) com o mesmo correlationId e a duração calculada.
export function startSpan(name: string, correlationId: string, extra: Record<string, any> = {}) {
    const start = Date.now();
    console.log(JSON.stringify({ correlationId, span: name, event: 'span_start', ...extra }));
    return {
        end: (endExtra: Record<string, any> = {}) => {
            const durationMs = Date.now() - start;
            console.log(JSON.stringify({ correlationId, span: name, event: 'span_end', durationMs, ...extra, ...endExtra }));
            return durationMs;
        },
    };
}
