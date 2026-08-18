// case-02 tem estoque alto de propósito, para não interferir nos testes de overselling de case-01.
export const inventoryDB: Record<string, number> = { 'case-01': 10, 'case-02': 500 };

export function hasStock(productId: string): boolean {
    return inventoryDB[productId] !== undefined && inventoryDB[productId] > 0;
}

export function decrementStock(productId: string): void {
    inventoryDB[productId] -= 1;
}
