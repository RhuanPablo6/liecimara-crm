import { AccessGate, AccessProvider } from '@/components/access';
import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <AccessProvider>
        <Sidebar />
        <main className="flex-1 overflow-x-hidden px-4 py-6 md:px-8 md:py-8 print:p-0">
          {/* O bloqueio fica dentro do <main>: o menu continua visível. */}
          <AccessGate>{children}</AccessGate>
        </main>
      </AccessProvider>
    </div>
  );
}
