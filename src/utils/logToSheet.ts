export async function logToSheet(event: {
  action: 'pack' | 'ship';
  ticketId: string;
  batchNo?: string;
  lineNo?: string;
  productName?: string;
  fromStatus: string;
  toStatus: string;
  movedQty: number;
  qtyRemainingAfter: number;
  storageLocation?: string;
  shippingType?: string;
  operator?: string;
  note?: string;
}) {
  const token = process.env.GAS_WEBHOOK_TOKEN!;
  if (!token) return;
  await fetch(`/api/gas/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-token': token },
    body: JSON.stringify(event),
    cache: 'no-store',
  });
}

