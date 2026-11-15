// Envia webhooks assinados para a API local, simulando a Meta.
// Uso (homologação): META_APP_SECRET=... pnpm simulate:webhook ad|plain|echo|duplicate
import { createHmac } from 'node:crypto';

const api = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const secret = process.env.META_APP_SECRET;
if (!secret) throw new Error('Defina META_APP_SECRET (o mesmo usado pela API)');

const scenario = process.argv[2] ?? 'ad';
const phone = process.argv[3] ?? '5511999990000';
const now = Math.floor(Date.now() / 1000);
const id = `wamid.SIM${now}${Math.floor(Math.random() * 1000)}`;

const meta = { display_phone_number: '5511900000000', phone_number_id: process.env.SIM_PHONE_NUMBER_ID ?? '000000000' };
const wrap = (field: string, value: object) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: process.env.SIM_WABA_ID ?? '000000000', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: meta, ...value } }] }],
});

const message = (withAd: boolean) =>
  wrap('messages', {
    contacts: [{ profile: { name: 'Paciente Teste' }, wa_id: phone }],
    messages: [
      {
        from: phone,
        id,
        timestamp: String(now),
        type: 'text',
        text: { body: 'Olá! Vi o anúncio e quero saber mais.' },
        ...(withAd
          ? {
              referral: {
                source_url: 'https://fb.me/teste',
                source_id: process.env.SIM_AD_ID ?? '120200000000000001',
                source_type: 'ad',
                headline: 'Avaliação gratuita',
                body: 'Agende sua avaliação',
                media_type: 'image',
                ctwa_clid: `SIMCLID${now}`,
              },
            }
          : {}),
      },
    ],
  });

const payloads: Record<string, object> = {
  ad: message(true),
  plain: message(false),
  echo: wrap('smb_message_echoes', {
    message_echoes: [{ from: meta.display_phone_number, to: phone, id, timestamp: String(now), type: 'text', text: { body: 'Olá! Tudo bem?' } }],
  }),
  duplicate: message(true),
};

const payload = payloads[scenario];
if (!payload) throw new Error(`Cenário desconhecido: ${scenario}`);

async function send() {
  const raw = JSON.stringify(payload);
  const sig = `sha256=${createHmac('sha256', secret!).update(raw).digest('hex')}`;
  const res = await fetch(`${api}/webhooks/whatsapp/cloud`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: raw,
  });
  console.log(scenario, res.status, await res.text());
}

await send();
if (scenario === 'duplicate') await send();
