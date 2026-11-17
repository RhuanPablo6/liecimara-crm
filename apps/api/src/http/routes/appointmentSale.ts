// Validação do "valor do atendimento" enviado junto do agendamento (Agenda e Lead).
import { z } from 'zod';
import type { Container } from '../../container.js';
import { ForbiddenError } from '../../domain/errors.js';
import { effectivePermissions } from '../../modules/auth/screens.js';
import type { AppointmentSaleInput } from '../../modules/funnel/AppointmentSales.js';

const method = z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'BANK_TRANSFER', 'OTHER']);

export const appointmentSaleSchema = z.union([
  z.object({ saleId: z.string().min(1) }),
  z.object({
    amountCents: z.number().int().positive().max(1_000_000_000),
    payment: z
      .object({
        amountCents: z.number().int().positive().nullish(),
        method,
        installments: z.number().int().min(1).max(24).nullish(),
        paidAt: z.coerce.date().nullish(),
      })
      .nullish(),
  }),
]);

/** Lançar valor pede permissão de venda; registrar pagamento, a de pagamento. */
export async function assertCanAttachSale(c: Container, userId: string, input: AppointmentSaleInput) {
  const user = await c.repos.users.findById(userId);
  const perms = user ? effectivePermissions(user) : [];
  if (!perms.includes('sales:write')) throw new ForbiddenError('Seu usuário não pode lançar valores de venda');
  if (!('saleId' in input) && input.payment && !perms.includes('payments:write')) throw new ForbiddenError('Seu usuário não pode registrar pagamentos');
}
