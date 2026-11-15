import { cookies } from 'next/headers';
import { Sidebar } from '@/components/sidebar';

/** Lê o nome do usuário do token apenas para exibição (a API valida a assinatura). */
async function userName(): Promise<string> {
  const token = (await cookies()).get('crm_session')?.value;
  try {
    const payload = JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString());
    return payload.name ?? 'Usuário';
  } catch {
    return 'Usuário';
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <Sidebar userName={await userName()} />
      <main className="flex-1 overflow-x-hidden px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
