import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStore, Ticket } from '../../store';
import { logToSheet } from '../../../../../utils/logToSheet';

const bodySchema = z.object({
  qty: z.number().int().positive(),
  shippingType: z.string().optional(),
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
  const toStatus = 'shipped';

  ticket.qtyRemaining -= qty;
  const qtyRemainingAfter = ticket.qtyRemaining;
  if (qtyRemainingAfter === 0) {
    ticket.archived = true;
  }

  if (qty < qtyRemainingAfter + qty) {
    const newTicket: Ticket = {
      id: `${id}-s${Date.now()}`,
      batchNo: ticket.batchNo,
      lineNo: ticket.lineNo,
      productName: ticket.productName,
      status: 'shipped',
      qtyRemaining: qty,
      archived: true,
      shippingType: parsed.data.shippingType,
    };
    store.tickets.set(newTicket.id, newTicket);
  }

  store.movements.push({
    action: 'ship',
    movedQty: qty,
    fromStatus,
    toStatus,
    qtyRemainingAfter,
    shippingType: parsed.data.shippingType,
    operator: parsed.data.operator,
    ts: new Date().toISOString(),
  });

  await logToSheet({
    action: 'ship',
    ticketId: id,
    batchNo: ticket.batchNo,
    lineNo: ticket.lineNo,
    productName: ticket.productName,
    fromStatus,
    toStatus,
    movedQty: qty,
    qtyRemainingAfter,
    shippingType: parsed.data.shippingType,
    operator: parsed.data.operator,
  });

  return NextResponse.json({ success: true, qtyRemaining: ticket.qtyRemaining });
}

