// Porta de integração WhatsApp. A aplicação depende apenas desta interface;
// cada fornecedor (Meta Cloud API direta, parceiro de coexistência) é um adaptador.

import type { NormalizedEvent } from './events.js';

export interface PhoneNumberInfo {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  platformType: string | null; // CLOUD_API | ON_PREMISE | NOT_APPLICABLE
  isCoexistence: boolean | null;
  throughputLevel: string | null;
}

export interface PermissionCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WhatsAppProvider {
  readonly id: 'WHATSAPP_CLOUD_API' | 'WHATSAPP_COEXISTENCE_PARTNER';
  readonly displayName: string;

  /** Verifica a autenticidade do webhook a partir do corpo bruto e dos cabeçalhos. */
  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;

  /** Converte o payload bruto em eventos normalizados (pode gerar vários por entrega). */
  normalize(payload: unknown): NormalizedEvent[];

  getPhoneNumberInfo(): Promise<PhoneNumberInfo>;

  /** Diagnóstico de permissões/assinaturas necessárias. */
  diagnosePermissions(): Promise<PermissionCheck[]>;

  /** Solicita sincronização de contatos ou histórico (coexistência; uma vez por onboarding). */
  requestAppDataSync(kind: 'smb_app_state_sync' | 'history'): Promise<{ requestId: string | null }>;
}

/** Campos de webhook que a aplicação precisa assinar na Meta. */
export const REQUIRED_WEBHOOK_FIELDS = ['messages', 'account_update'] as const;
export const COEXISTENCE_WEBHOOK_FIELDS = ['history', 'smb_app_state_sync', 'smb_message_echoes'] as const;
