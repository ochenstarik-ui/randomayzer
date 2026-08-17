'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  ArrowLeft, 
  ShieldCheck, 
  Trophy, 
  ExternalLink, 
  Copy, 
  Check, 
  Calendar,
  RefreshCw,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { StoredGiveaway } from '@/lib/giveaway-store';

export default function GiveawayDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [giveaway, setGiveaway] = useState<StoredGiveaway | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any | null>(null);

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

  const handleVerify = async () => {
    if (!id) return;
    try {
      setVerifying(true);
      const res = await fetch(`/api/giveaways/${id}/verify`);
      const data = await res.json();
      setVerificationResult(data);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setVerifying(false);
    }
  };

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
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium font-mono">
            {giveaway.status}
          </span>
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4" />
                Публичный криптографический аудит (Provably Fair)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
                  Верифицировать результат
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify({
                      giveawayId: giveaway.id,
                      drawId: drawResult.drawId,
                      snapshotId: drawResult.snapshotId,
                      algorithmVersion: drawResult.algorithmVersion,
                      seed: drawResult.seedUsed,
                      participantsSnapshotHash: drawResult.participantsSnapshotHash,
                      conditionsHash: drawResult.conditionsHash,
                      deterministicProofHash: drawResult.deterministicProofHash,
                      auditEventHash: drawResult.auditEventHash,
                      winnerIds: drawResult.winnerIds,
                      reserveWinnerIds: drawResult.reserveWinnerIds,
                      drawnAt: drawResult.drawnAt,
                    }, null, 2));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Скопировано' : 'JSON'}
                </button>
              </div>
            </div>

            {/* Live Verification Banner if clicked */}
            {verificationResult && (
              <div className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                verificationResult.verified 
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}>
                <div className="flex items-center gap-2 font-bold text-sm">
                  {verificationResult.verified ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Результат 100% подтвержден и математически доказуем!
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      Несоответствие верификации!
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                  <div>Целостность участников: {verificationResult.participantsSnapshotIntegrity ? 'ДА ✓' : 'НЕТ ✗'}</div>
                  <div>Целостность условий: {verificationResult.conditionsIntegrity ? 'ДА ✓' : 'НЕТ ✗'}</div>
                  <div>Победители совпали: {verificationResult.winnersMatch ? 'ДА ✓' : 'НЕТ ✗'}</div>
                  <div>Резерв совпал: {verificationResult.reserveWinnersMatch ? 'ДА ✓' : 'НЕТ ✗'}</div>
                  <div>Proof Hash совпал: {verificationResult.deterministicProofHashMatch ? 'ДА ✓' : 'НЕТ ✗'}</div>
                  <div>Event Hash совпал: {verificationResult.auditEventHashMatch ? 'ДА ✓' : 'НЕТ ✗'}</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Draw ID:</span>
                <p className="font-mono text-amber-300 break-all">{drawResult.drawId}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Snapshot ID:</span>
                <p className="font-mono text-slate-300 break-all">{drawResult.snapshotId}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Алгоритм:</span>
                <p className="font-mono text-amber-400 break-all">{drawResult.algorithmVersion}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Seed:</span>
                <p className="font-mono text-blue-400 break-all">{drawResult.seedUsed}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Snapshot Hash:</span>
                <p className="font-mono text-emerald-400 break-all">{drawResult.participantsSnapshotHash}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400">Conditions Hash:</span>
                <p className="font-mono text-purple-400 break-all">{drawResult.conditionsHash}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 sm:col-span-2">
                <span className="text-slate-400">deterministicProofHash (воспроизводимый):</span>
                <p className="font-mono text-indigo-300 break-all">{drawResult.deterministicProofHash}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 sm:col-span-2">
                <span className="text-slate-400">auditEventHash (уникальный для события):</span>
                <p className="font-mono text-slate-400 break-all">{drawResult.auditEventHash}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
