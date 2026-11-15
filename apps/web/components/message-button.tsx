'use client';

import { MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, NativeSelect, Textarea } from '@/components/ui/form';
import { useApi } from '@/lib/api';

export type MessageUse = 'RETURN' | 'REACTIVATION' | 'CONFIRM' | 'POSTCARE' | 'CHARGE' | 'GENERAL';

export interface MessageVars {
  nome?: string | null;
  procedimento?: string | null;
  data?: string | null;
  hora?: string | null;
  valor?: string | null;
  ultima_vez?: string | null;
  link?: string | null;
}

/** Troca {nome}, {primeiro_nome}... pelos dados da paciente. Campos vazios viram texto neutro. */
export function fillTemplate(body: string, vars: MessageVars, clinicName: string) {
  const nome = vars.nome?.trim() || '';
  const map: Record<string, string> = {
    nome: nome || 'tudo bem',
    primeiro_nome: nome.split(/\s+/)[0] || '',
    procedimento: vars.procedimento || 'procedimento',
    data: vars.data || '',
    hora: vars.hora || '',
    valor: vars.valor || '',
    ultima_vez: vars.ultima_vez || '',
    link: vars.link || '',
    clinica: clinicName,
  };
  return body
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k]! : m))
    .replace(/Oi, !/g, 'Oi!')
    .replace(/[ \t]+([,.!?])/g, '$1');
}

export const waLink = (waId: string, text: string) => `https://wa.me/${waId.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/**
 * Botão "Mensagem pronta": escolhe o modelo, mostra o texto já preenchido (dá para ajustar)
 * e abre o WhatsApp da clínica com a conversa da paciente. Nada é enviado sem a recepção tocar em "Enviar".
 */
export function MessageButton({
  waId,
  vars,
  use = 'GENERAL',
  label = 'Mensagem',
  size = 'sm',
  variant = 'outline',
  onSent,
  appointmentId,
}: {
  /** Agendamento: inclui o link para a paciente confirmar, desmarcar ou remarcar. */
  appointmentId?: string;
  waId: string | null | undefined;
  vars: MessageVars;
  use?: MessageUse;
  label?: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'default' | 'gold' | 'ghost';
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<any>(open ? '/messages/templates' : null);
  const { data: linkData } = useApi<any>(open && appointmentId ? `/appointments/${appointmentId}/link` : null);
  const link = linkData?.token ? `${window.location.origin}/c/${linkData.token}` : null;
  const [templateId, setTemplateId] = useState('');
  const [text, setText] = useState('');
  const templates: any[] = data?.templates ?? [];
  const chosen = useMemo(() => templates.find((t) => t.id === templateId) ?? templates.find((t) => t.use === use) ?? templates[0], [templates, templateId, use]);

  useEffect(() => {
    if (!chosen || !data || (appointmentId && !link)) return;
    // Modelo antigo sem {link}: acrescenta o link no fim quando for de agendamento.
    const body = appointmentId && !chosen.body.includes('{link}') ? `${chosen.body}\n\nConfirme, desmarque ou remarque por aqui: {link}` : chosen.body;
    setText(fillTemplate(body, { ...vars, link }, data.clinicName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id, data?.clinicName, link]);

  if (!waId) return null;
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <MessageCircle /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mensagem pronta</DialogTitle>
          </DialogHeader>
          {!data && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {data && (
            <div className="space-y-4">
              <Field label="Modelo">
                <NativeSelect value={chosen?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Texto (pode ajustar antes de enviar)">
                <Textarea className="min-h-[140px]" value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  asChild
                  variant="gold"
                  onClick={() => {
                    onSent?.();
                    setOpen(false);
                  }}
                >
                  <a href={waLink(waId, text)} target="_blank" rel="noreferrer">
                    <MessageCircle /> Abrir no WhatsApp
                  </a>
                </Button>
                <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(text).catch(() => undefined)}>
                  Copiar texto
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Abre a conversa da paciente no WhatsApp (app ou WhatsApp Web) com o texto pronto. A mensagem só vai quando você tocar em enviar lá.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
