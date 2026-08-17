'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  Gift, 
  PlusCircle, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  Users, 
  ShieldCheck, 
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { GiveawaySummary } from '@/lib/repository/giveaway-repository';

export default function DashboardPage() {
  const [giveaways, setGiveaways] = useState<GiveawaySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGiveaways = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/giveaways');
      const data = await res.json();
      if (data.giveaways) {
        setGiveaways(data.giveaways);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGiveaways();
  }, []);

  const completedCount = giveaways.filter(g => g.status === 'DRAWN' || g.status === 'PUBLISHED').length;
  const totalEligible = giveaways.reduce((acc, g) => acc + (g.eligibleParticipantsCount || 0), 0);

  return (
    <div className="space-y-8">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900 border border-blue-500/20 p-8 shadow-xl">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Честные розыгрыши ВКонтакте
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl mb-3">
            Честный рандомайзер с доказуемым результатом
          </h1>
          <p className="text-slate-300 text-sm sm:text-base mb-6 leading-relaxed">
            Выбирайте победителей по лайкам и комментариям. 
            Каждый розыгрыш фиксируется неизменяемым слепком (Snapshot) и криптографическим auditHash (HMAC-SHA256).
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/giveaways/new"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              <PlusCircle className="w-5 h-5" />
              Создать новый розыгрыш
            </Link>
          </div>
        </div>
        <div className="absolute right-6 top-1/2 -translate-y-1/2 hidden lg:block opacity-15 pointer-events-none">
          <Gift className="w-64 h-64 text-blue-400" />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Всего кампаний</span>
            <Gift className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">{giveaways.length}</div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Проведено розыгрышей</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">{completedCount}</div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Участников в розыгрышах</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-indigo-400">{totalEligible}</div>
        </div>
      </div>

      {/* List of Giveaways */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Список розыгрышей</h2>
            <p className="text-xs text-slate-400">История созданных и завершенных конкурсов</p>
          </div>
          <button
            onClick={fetchGiveaways}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Обновить"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
            Загрузка списка...
          </div>
        ) : giveaways.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
            <Gift className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-300 font-medium mb-1">Пока нет созданных розыгрышей</p>
            <p className="text-xs text-slate-400 mb-4 max-w-sm mx-auto">
              Вставьте ссылку на пост ВКонтакте, чтобы загрузить участников и зафиксировать результат
            </p>
            <Link
              href="/giveaways/new"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Создать первый розыгрыш
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {giveaways.map((gw) => (
              <div
                key={gw.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-blue-500/50 transition-all gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-blue-400 font-bold text-xs mt-0.5">
                    VK
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors">
                      {gw.title || 'Розыгрыш по записи VK'}
                    </h3>
                    <p className="text-xs text-slate-400 truncate mt-0.5 max-w-md">
                      {gw.sourceUrl}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                      <span>Создан: {new Date(gw.createdAt).toLocaleDateString('ru-RU')}</span>
                      <span>•</span>
                      <span>Лайков: {gw.postLikesCount}</span>
                      <span>•</span>
                      <span>Комментов: {gw.postCommentsCount}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  {gw.status === 'DRAWN' || gw.status === 'PUBLISHED' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      {gw.status}
                    </span>
                  ) : gw.status === 'SNAPSHOT_LOCKED' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      <Clock className="w-3 h-3" />
                      Слепок зафиксирован
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      <Clock className="w-3 h-3" />
                      {gw.status}
                    </span>
                  )}

                  <Link
                    href={`/giveaways/${gw.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                  >
                    Подробнее
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Provably Fair Info Box */}
      <div className="rounded-xl bg-slate-900/40 border border-slate-800 p-6 flex flex-col md:flex-row items-start md:items-center gap-4">
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">
            Как гарантируется честность результатов?
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Перед жеребьевкой список участников фиксируется в неизменяемый слепок и хешируется по стандарту SHA-256. 
            Победитель определяется алгоритмом HMAC_SHA256_FY_V1 с rejection sampling. Любой зритель может воспроизвести результат и проверить неизменность выборки.
          </p>
        </div>
      </div>
    </div>
  );
}
