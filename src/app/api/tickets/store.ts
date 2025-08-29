export type Ticket = {
  id: string;
  batchNo?: string;
  lineNo?: string;
  productName?: string;
  status: 'manufactured' | 'packed' | 'shipped';
  qtyRemaining: number;
  archived: boolean;
  storageLocation?: string;
  shippingType?: string;
};

export type Movement = {
  action: 'pack' | 'ship';
  movedQty: number;
  fromStatus: string;
  toStatus: string;
  qtyRemainingAfter: number;
  storageLocation?: string;
  shippingType?: string;
  operator?: string;
  ts: string;
};

export function getStore() {
  const g = globalThis as any;
  if (!g.__ticketStore) {
    g.__ticketStore = {
      tickets: new Map<string, Ticket>(),
      movements: [] as Movement[],
    };
  }
  return g.__ticketStore as { tickets: Map<string, Ticket>; movements: Movement[] };
}

