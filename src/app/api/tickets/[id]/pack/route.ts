import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStore, Ticket } from '../../store';
import { logToSheet } from '../../../../../utils/logToSheet';

const bodySchema = z.object({
  qty: z.number().int().positive(),
  storageLocation: z.string().optional(),
  operator: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const store = getStore();
  const ticket = store.tickets.get(id);
  if (!ticket) {
    return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  }

  const qty = parsed.data.qty;
  if (qty <= 0 || qty > ticket.qtyRemaining) {
    return NextResponse.json({ success: false, error: 'invalid qty' }, { status: 400 });
  }

  const fromStatus = ticket.status;
  const toStatus = 'packed';

  ticket.qtyRemaining -= qty;
  const qtyRemainingAfter = ticket.qtyRemaining;
  if (qtyRemainingAfter === 0) {
    ticket.archived = true;
  }

  if (qty < qtyRemainingAfter + qty) {
    const newTicket: Ticket = {
      id: `${id}-p${Date.now()}`,
      batchNo: ticket.batchNo,
      lineNo: ticket.lineNo,
      productName: ticket.productName,
      status: 'packed',
      qtyRemaining: qty,
      archived: false,
      storageLocation: parsed.data.storageLocation,
    };
    store.tickets.set(newTicket.id, newTicket);
  }

  store.movements.push({
    action: 'pack',
    movedQty: qty,
    fromStatus,
    toStatus,
    qtyRemainingAfter,
    storageLocation: parsed.data.storageLocation,
    operator: parsed.data.operator,
    ts: new Date().toISOString(),
  });

  await logToSheet({
    action: 'pack',
    ticketId: id,
    batchNo: ticket.batchNo,
    lineNo: ticket.lineNo,
    productName: ticket.productName,
    fromStatus,
    toStatus,
    movedQty: qty,
    qtyRemainingAfter,
    storageLocation: parsed.data.storageLocation,
    operator: parsed.data.operator,
  });

  return NextResponse.json({ success: true, qtyRemaining: ticket.qtyRemaining });
}

