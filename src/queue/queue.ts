import { EventEmitter } from 'events';

export interface OrderMessage {
    orderId: string;
    correlationId: string;
    productId: string;
}

// Simula uma fila (RabbitMQ/SQS) via EventEmitter em memória.
export const queue = new EventEmitter();
