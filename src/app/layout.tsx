import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Gift, ShieldCheck, PlusCircle, LayoutDashboard } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Randomayzer — Доказуемые розыгрыши ВКонтакте',
  description: 'Прозрачный и верифицируемый сервис проведения конкурсов и розыгрышей в социальных сетях',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="bg-[#0b0f17] text-slate-100 min-h-screen flex flex-col antialiased selection:bg-blue-600 selection:text-white">
        {/* Navigation Header */}
        <header className="border-b border-slate-800 bg-[#0f172a]/90 backdrop-blur sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Gift className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  Randomayzer
                </span>
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  VK Edition
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-3">
              <Link
                href="/"
                className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                Дашборд
              </Link>
              <Link
                href="/giveaways/new"
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all shadow-md shadow-blue-600/25 active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
                Новый розыгрыш
              </Link>
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-800 bg-[#0f172a] py-6 text-sm text-slate-400">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Provably Fair Engine • Криптографически доказуемый выбор</span>
            </div>
            <p className="text-xs text-slate-400">
              Randomayzer Core v1.0 • Этап 1
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
