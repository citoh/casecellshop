export type OrderStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface Order {
    orderId: string;
    status: OrderStatus;
    productId: string;
    attempts: number;
    simulateFailure: boolean;
}

export const ordersDB = new Map<string, Order>();
