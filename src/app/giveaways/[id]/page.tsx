'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  ArrowLeft, 
  ShieldCheck, 
  Trophy, 
  ExternalLink, 
  CheckCircle2, 
  Copy, 
  Check, 
  Users, 
  Calendar,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { StoredGiveaway } from '@/lib/giveaway-store';

export default function GiveawayDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [giveaway, setGiveaway] = useState<StoredGiveaway | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetchGw = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/giveaways/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Розыгрыш не найден');
        setGiveaway(data.giveaway);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchGw();
  }, [id]);

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-400 text-sm">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500" />
        Загрузка данных розыгрыша...
      </div>
    );
  }

  if (error || !giveaway) {
    return (
      <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl">
        <p className="text-rose-400 mb-4">{error || 'Розыгрыш не найден'}</p>
        <Link href="/" className="text-xs text-blue-400 hover:underline">
          ← Вернуться на главную
        </Link>
      </div>
    );
  }

  const drawResult = giveaway.drawResult;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Назад к списку
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
            VKontakte
          </span>
          {giveaway.status === 'COMPLETED' ? (
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              Завершен
            </span>
          ) : (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
              В процессе
            </span>
          )}
        </div>
      </div>

      {/* Main Details Card */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">{giveaway.title}</h1>
          <p className="text-xs sm:text-sm text-slate-300 whitespace-pre-line leading-relaxed">
            {giveaway.description}
          </p>
        </div>

        {giveaway.postImageUrl && (
          <div className="rounded-xl overflow-hidden max-h-64 border border-slate-800">
            <img src={giveaway.postImageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Source link */}
        <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
          <span className="text-slate-400">Ссылка на запись:</span>
          <a
            href={giveaway.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline flex items-center gap-1 font-mono"
          >
            {giveaway.sourceUrl}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Draw Result Presentation */}
      {drawResult && (
        <div className="bg-gradient-to-br from-amber-500/10 via-slate-900/80 to-slate-950 border border-amber-500/30 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
              <Trophy className="w-5 h-5" />
              Официальные победители
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(drawResult.drawnAt).toLocaleString('ru-RU')}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {drawResult.winners.map((winner) => (
              <div
                key={winner.participant.platformUserId}
                className="p-4 rounded-xl bg-slate-950 border border-amber-500/30 flex items-center gap-3.5"
              >
                <div className="w-12 h-12 rounded-full bg-slate-800 border-2 border-amber-400 flex items-center justify-center overflow-hidden shrink-0">
                  {winner.participant.avatarUrl ? (
                    <img src={winner.participant.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-bold">{winner.participant.firstName[0]}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-400">#{winner.position} место</span>
                  </div>
                  <h4 className="text-sm font-bold text-white truncate">
                    {winner.participant.firstName} {winner.participant.lastName}
                  </h4>
                  <a
                    href={`https://vk.com/id${winner.participant.platformUserId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline mt-0.5"
                  >
                    id{winner.participant.platformUserId}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Provably Fair Audit Trail */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4" />
                Публичный криптографический аудит (Provably Fair)
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(drawResult, null, 2));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Скопировано' : 'JSON аудита'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Seed розыгрыша:</span>
                <p className="font-mono text-blue-400 break-all">{drawResult.seedUsed}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Snapshot Hash (SHA-256):</span>
                <p className="font-mono text-emerald-400 break-all">{drawResult.participantsSnapshotHash}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 sm:col-span-2">
                <span className="text-slate-400">Verification Signature:</span>
                <p className="font-mono text-indigo-300 break-all">{drawResult.verificationSignature}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
