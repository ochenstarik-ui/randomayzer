'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Sparkles, 
  Heart, 
  MessageSquare, 
  Repeat2, 
  Users, 
  Shield, 
  CheckCircle2, 
  XCircle, 
  Trophy, 
  RefreshCw, 
  Shuffle, 
  Copy, 
  ExternalLink, 
  Info, 
  Check, 
  AlertCircle,
  Lock
} from 'lucide-react';
import { FilterRules, DEFAULT_FILTER_RULES, PostMetadata } from '@/core/types/giveaway';
import { FilteredParticipant, Winner } from '@/core/types/participant';
import { DrawExecutionResult, ParticipantSnapshotData } from '@/core/types/audit';

export default function NewGiveawayWizardPage() {
  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Post URL & Metadata
  const [postUrl, setPostUrl] = useState('');
  const [loadingPost, setLoadingPost] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postData, setPostData] = useState<PostMetadata | null>(null);
  const [createdGiveawayId, setCreatedGiveawayId] = useState<string | null>(null);

  // Step 2: Conditions
  const [rules, setRules] = useState<FilterRules>({ ...DEFAULT_FILTER_RULES });
  const [blacklistInput, setBlacklistInput] = useState('');

  // Step 3: Participants & Snapshot
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [participants, setParticipants] = useState<FilteredParticipant[]>([]);
  const [participantTab, setParticipantTab] = useState<'all' | 'eligible' | 'excluded'>('eligible');
  const [lockingSnapshot, setLockingSnapshot] = useState(false);
  const [lockedSnapshot, setLockedSnapshot] = useState<ParticipantSnapshotData | null>(null);

  // Step 4: Draw parameters
  const [winnersCount, setWinnersCount] = useState<number>(1);
  const [reserveWinnersCount, setReserveWinnersCount] = useState<number>(1);
  const [seed, setSeed] = useState<string>('');
  const [drawing, setDrawing] = useState(false);

  // Step 5: Results
  const [drawResult, setDrawResult] = useState<DrawExecutionResult | null>(null);
  const [copiedProof, setCopiedProof] = useState(false);

  // Step 1 handler: Fetch Post Metadata
  const handleFetchPost = async () => {
    if (!postUrl.trim()) return;
    setLoadingPost(true);
    setPostError(null);

    try {
      const res = await fetch('/api/posts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: postUrl.trim(), platform: 'VK' }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Не удалось загрузить данные поста');
      }

      setPostData(data.post);

      const createRes = await fetch('/api/giveaways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: postUrl.trim(),
          post: data.post,
          filterRules: rules,
        }),
      });

      const createData = await createRes.json();
      if (createData.giveaway) {
        setCreatedGiveawayId(createData.giveaway.id);
      }
    } catch (err: any) {
      setPostError(err.message);
    } finally {
      setLoadingPost(false);
    }
  };

  const [totalCount, setTotalCount] = useState(0);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingPage, setLoadingPage] = useState(false);

  const loadParticipantsPage = async (giveawayId: string, page: number, tab: 'all' | 'eligible' | 'excluded') => {
    setLoadingPage(true);
    try {
      const res = await fetch(`/api/giveaways/${giveawayId}/participants?page=${page}&pageSize=50&tab=${tab}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setParticipants(data.participants || []);
        setTotalCount(data.totalCount || 0);
        setEligibleCount(data.eligibleCount || 0);
        setExcludedCount(data.excludedCount || 0);
        setCurrentPage(data.page || 1);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingPage(false);
    }
  };

  // Step 2 handler: Fetch & Enrich Participants
  const handleFetchParticipants = async () => {
    if (!createdGiveawayId) return;
    setLoadingParticipants(true);

    try {
      const activeRules: FilterRules = {
        ...rules,
        excludeBlacklistedIds: blacklistInput
          .split(/[\n,]/)
          .map(s => s.trim())
          .filter(Boolean),
      };

      const res = await fetch(`/api/giveaways/${createdGiveawayId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterRules: activeRules }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Ошибка загрузки участников');

      setTotalCount(data.totalCount || 0);
      setEligibleCount(data.eligibleCount || 0);
      setExcludedCount(data.excludedCount || 0);
      setStep(3);
      await loadParticipantsPage(createdGiveawayId, 1, participantTab);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoadingParticipants(false);
    }
  };

  // Step 3 handler: Lock Immutable Snapshot
  const handleLockSnapshotAndProceed = async () => {
    if (!createdGiveawayId) return;
    setLockingSnapshot(true);

    try {
      const res = await fetch(`/api/giveaways/${createdGiveawayId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterRules: rules }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания неизменяемого слепка');

      setLockedSnapshot(data.snapshot);
      setStep(4);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLockingSnapshot(false);
    }
  };

  // Step 4 handler: Execute Draw
  const handleExecuteDraw = async () => {
    if (!createdGiveawayId) return;
    setDrawing(true);

    try {
      const res = await fetch(`/api/giveaways/${createdGiveawayId}/draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnersCount,
          reserveWinnersCount,
          seed: seed.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка проведения розыгрыша');

      setDrawResult(data.drawResult);
      setStep(5);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDrawing(false);
    }
  };

  const eligibleParticipants = participants.filter(p => p.eligible);
  const excludedParticipants = participants.filter(p => !p.eligible);

  const displayedParticipants =
    participantTab === 'all'
      ? participants
      : participantTab === 'eligible'
      ? eligibleParticipants
      : excludedParticipants;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Breadcrumb & Step Tracker */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Вернуться на дашборд
        </Link>
        <span className="text-xs text-slate-400">Этап {step} из 5</span>
      </div>

      {/* Progress Steps Header */}
      <div className="grid grid-cols-5 gap-2 p-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-center text-xs font-medium">
        <div className={`py-2 rounded-lg transition-colors ${step >= 1 ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400'}`}>
          1. Пост VK
        </div>
        <div className={`py-2 rounded-lg transition-colors ${step >= 2 ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400'}`}>
          2. Условия
        </div>
        <div className={`py-2 rounded-lg transition-colors ${step >= 3 ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400'}`}>
          3. Участники
        </div>
        <div className={`py-2 rounded-lg transition-colors ${step >= 4 ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400'}`}>
          4. Настройки
        </div>
        <div className={`py-2 rounded-lg transition-colors ${step >= 5 ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400'}`}>
          5. Итоги
        </div>
      </div>

      {/* ================= STEP 1: Post URL Input & Preview ================= */}
      {step === 1 && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Шаг 1: Выберите запись ВКонтакте</h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Вставьте ссылку на конкурсный пост со стены сообщества или личной страницы
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Ссылка на пост ВКонтакте
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="https://vk.com/wall-22446688_1054"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                className="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                onClick={handleFetchPost}
                disabled={loadingPost || !postUrl.trim()}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-blue-600/25 flex items-center justify-center gap-2 shrink-0"
              >
                {loadingPost ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Загрузка...
                  </>
                ) : (
                  'Загрузить пост'
                )}
              </button>
            </div>

            {/* Quick Demo Helper */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              <span>Для теста можно вставить: </span>
              <button
                type="button"
                onClick={() => setPostUrl('https://vk.com/wall-22446688_1054')}
                className="text-blue-400 hover:underline"
              >
                https://vk.com/wall-22446688_1054
              </button>
            </div>
          </div>

          {postError && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{postError}</span>
            </div>
          )}

          {/* Post Preview Card */}
          {postData && (
            <div className="p-5 rounded-xl bg-slate-950 border border-blue-500/30 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  {postData.authorAvatarUrl && (
                    <img
                      src={postData.authorAvatarUrl}
                      alt={postData.authorName || 'Author'}
                      className="w-10 h-10 rounded-full object-cover border border-slate-700"
                    />
                  )}
                  <div>
                    <h4 className="text-sm font-semibold text-white">{postData.authorName}</h4>
                    <span className="text-xs text-slate-400">Сообщество организатора</span>
                  </div>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Пост готов
                </span>
              </div>

              <p className="text-xs sm:text-sm text-slate-300 whitespace-pre-line leading-relaxed">
                {postData.text}
              </p>

              {postData.imageUrl && (
                <div className="relative rounded-xl overflow-hidden max-h-64 border border-slate-800">
                  <img
                    src={postData.imageUrl}
                    alt="Post preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Counters */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-rose-400 text-xs font-medium mb-1">
                    <Heart className="w-3.5 h-3.5 fill-rose-400/20" />
                    Лайки
                  </div>
                  <span className="text-lg font-bold text-white">{postData.likesCount}</span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-blue-400 text-xs font-medium mb-1">
                    <MessageSquare className="w-3.5 h-3.5" />
                    Комментарии
                  </div>
                  <span className="text-lg font-bold text-white">{postData.commentsCount}</span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                    <Repeat2 className="w-3.5 h-3.5" />
                    Репосты
                  </div>
                  <span className="text-lg font-bold text-white">{postData.repostsCount}</span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-blue-600/30"
                >
                  Перейти к настройке условий →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= STEP 2: Conditions / Filter Rules ================= */}
      {step === 2 && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Шаг 2: Условия участия</h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Отметьте условия, которые будут проверены у участников
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Condition: Like */}
            <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={rules.requireLike}
                onChange={(e) => setRules({ ...rules, requireLike: e.target.checked })}
                className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700"
              />
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-400" />
                  Поставил лайк
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Учитывать только тех, кто оценил запись
                </p>
              </div>
            </label>

            {/* Condition: Comment */}
            <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={rules.requireComment}
                onChange={(e) => setRules({ ...rules, requireComment: e.target.checked })}
                className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700"
              />
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  Оставил комментарий
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Требовать наличие комментария под постом
                </p>
              </div>
            </label>

            {/* Condition: Subscription */}
            <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={rules.requireSubscription}
                onChange={(e) => setRules({ ...rules, requireSubscription: e.target.checked })}
                className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700"
              />
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-400" />
                  Подписка на сообщество
                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                    VK API
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Реальная пакетная проверка членства через groups.isMember
                </p>
              </div>
            </label>

            {/* Filter: 1 User = 1 Chance */}
            <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={rules.excludeDuplicateComments}
                onChange={(e) => setRules({ ...rules, excludeDuplicateComments: e.target.checked })}
                className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700"
              />
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Учитывать пользователя один раз
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Дублирующие комментарии не увеличивают шансы
                </p>
              </div>
            </label>

            {/* Condition: Repost (Disabled by capability) */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-950/40 border border-slate-800/50 opacity-60 cursor-not-allowed">
              <input
                type="checkbox"
                disabled
                checked={false}
                className="mt-1 w-4 h-4 rounded text-slate-600 bg-slate-900 border-slate-700"
              />
              <div>
                <div className="text-sm font-semibold text-slate-400 flex items-center gap-2">
                  <Repeat2 className="w-4 h-4 text-slate-500" />
                  Сделал репост
                  <span className="text-[10px] font-medium px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                    Ограничение VK API
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Не поддерживается VK API для закрытых профилей сторонними приложениями
                </p>
              </div>
            </div>

            {/* Filter: Exclude Admins */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-950/40 border border-slate-800/50 opacity-60 cursor-not-allowed">
              <input
                type="checkbox"
                disabled
                checked={false}
                className="mt-1 w-4 h-4 rounded text-slate-600 bg-slate-900 border-slate-700"
              />
              <div>
                <div className="text-sm font-semibold text-slate-400 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-slate-500" />
                  Исключить администраторов
                  <span className="text-[10px] font-medium px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                    Этап 2 (OAuth)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Требует авторизации организатора через VK ID для доступа к списку контактов
                </p>
              </div>
            </div>
          </div>

          {/* Blacklist IDs */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              Черный список (VK ID или логины через запятую / с новой строки)
            </label>
            <textarea
              rows={2}
              placeholder="1000137, @spammer_user"
              value={blacklistInput}
              onChange={(e) => setBlacklistInput(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              ← Назад
            </button>
            <button
              onClick={handleFetchParticipants}
              disabled={loadingParticipants}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-blue-600/30 flex items-center gap-2"
            >
              {loadingParticipants ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Загрузка и проверка...
                </>
              ) : (
                'Загрузить и проверить условия →'
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================= STEP 3: Participants Table & Lock Snapshot ================= */}
      {step === 3 && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Шаг 3: Проверка участников</h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Список пользователей после применения фильтров и проверки подписок
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium self-start sm:self-auto">
              <button
                onClick={() => {
                  setParticipantTab('eligible');
                  if (createdGiveawayId) loadParticipantsPage(createdGiveawayId, 1, 'eligible');
                }}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  participantTab === 'eligible'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Допущены ({eligibleCount})
              </button>
              <button
                onClick={() => {
                  setParticipantTab('excluded');
                  if (createdGiveawayId) loadParticipantsPage(createdGiveawayId, 1, 'excluded');
                }}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  participantTab === 'excluded'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Отклонены ({excludedCount})
              </button>
              <button
                onClick={() => {
                  setParticipantTab('all');
                  if (createdGiveawayId) loadParticipantsPage(createdGiveawayId, 1, 'all');
                }}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  participantTab === 'all'
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Все ({totalCount})
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="border border-slate-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            {loadingPage ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-400" />
                Загрузка участников...
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Участник</th>
                    <th className="py-3 px-4">VK ID</th>
                    <th className="py-3 px-4 text-center">Лайк</th>
                    <th className="py-3 px-4 text-center">Коммент</th>
                    <th className="py-3 px-4 text-center">Подписка</th>
                    <th className="py-3 px-4 text-right">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                  {participants.map((p) => (
                    <tr key={p.platformUserId} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 text-slate-300 font-medium">
                          {p.avatarUrl ? (
                            <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            p.firstName[0]
                          )}
                        </div>
                        <span className="font-medium text-white truncate max-w-[140px]">
                          {p.firstName} {p.lastName}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-mono">
                        id{p.platformUserId}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {p.liked ? (
                          <Check className="w-4 h-4 text-rose-400 mx-auto" />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {p.commented ? (
                          <span className="text-blue-400 font-medium">{p.commentsCount || 1}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {p.subscribed ? (
                          <Check className="w-4 h-4 text-indigo-400 mx-auto" />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {p.eligible ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            Допущен
                          </span>
                        ) : (
                          <span 
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-help"
                            title={p.exclusionReason || 'Не выполнил условия'}
                          >
                            <XCircle className="w-3 h-3" />
                            {p.exclusionReason || 'Отклонен'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>Страница {currentPage} из {totalPages}</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={currentPage <= 1 || loadingPage}
                  onClick={() => createdGiveawayId && loadParticipantsPage(createdGiveawayId, currentPage - 1, participantTab)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition-colors"
                >
                  Назад
                </button>
                <button
                  disabled={currentPage >= totalPages || loadingPage}
                  onClick={() => createdGiveawayId && loadParticipantsPage(createdGiveawayId, currentPage + 1, participantTab)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition-colors"
                >
                  Вперед
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              ← Назад к условиям
            </button>
            <button
              onClick={handleLockSnapshotAndProceed}
              disabled={lockingSnapshot || eligibleCount === 0}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-blue-600/30 flex items-center gap-2"
            >
              {lockingSnapshot ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Фиксация слепка...
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Зафиксировать слепок и перейти к розыгрышу ({eligibleCount}) →
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================= STEP 4: Draw Configuration ================= */}
      {step === 4 && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Шаг 4: Настройки жеребьевки</h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Укажите количество призовых и резервных мест
            </p>
          </div>

          <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-purple-300">
              <Lock className="w-4 h-4 text-purple-400" />
              <span>Слепок зафиксирован (версия {lockedSnapshot?.version || 1})</span>
            </div>
            {lockedSnapshot?.participantsSnapshotHash && (
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-purple-200">
                <span className="text-purple-400">Хеш слепка:</span>
                <span className="font-mono text-emerald-400 truncate max-w-xs">{lockedSnapshot.participantsSnapshotHash}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <label className="text-xs font-semibold text-white">Количество победителей</label>
              <input
                type="number"
                min={1}
                max={Math.max(1, eligibleCount)}
                value={winnersCount}
                onChange={(e) => setWinnersCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <label className="text-xs font-semibold text-white">Резервные победители</label>
              <input
                type="number"
                min={0}
                max={Math.max(0, eligibleCount - winnersCount)}
                value={reserveWinnersCount}
                onChange={(e) => setReserveWinnersCount(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <label className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>Пользовательская соль / Seed (опционально)</span>
              <Info className="w-3.5 h-3.5 text-slate-400" />
            </label>
            <input
              type="text"
              placeholder="Оставьте пустым для генерации CSPRNG соли или введите публичный seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 font-mono text-xs"
            />
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(3)}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              ← Назад к списку
            </button>
            <button
              onClick={handleExecuteDraw}
              disabled={drawing || eligibleParticipants.length === 0}
              className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/30 flex items-center gap-2 active:scale-95"
            >
              {drawing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Определение победителей...
                </>
              ) : (
                <>
                  <Trophy className="w-5 h-5 text-amber-300" />
                  Определить победителя!
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================= STEP 5: Results & Provably Fair Audit ================= */}
      {step === 5 && drawResult && (
        <div className="space-y-6">
          {/* Winner Celebration Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/20 via-blue-900/40 to-slate-950 border border-amber-500/30 p-8 shadow-2xl text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-bold mb-3">
              <Trophy className="w-4 h-4" />
              Розыгрыш успешно проведен!
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">
              🎉 Поздравляем победителей!
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-lg mx-auto mb-6">
              Выборка произведена алгоритмом {drawResult.algorithmVersion} среди {drawResult.totalEligibleCount} допущенных участников.
            </p>

            {/* Main Winners Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
              {drawResult.winners.map((winner) => (
                <div
                  key={winner.participant.platformUserId}
                  className="p-5 rounded-2xl bg-slate-900/90 border-2 border-amber-500/40 shadow-xl flex items-center gap-4 relative overflow-hidden"
                >
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 font-extrabold text-xs">
                    #{winner.position} место
                  </div>
                  <div className="w-14 h-14 rounded-full bg-slate-800 border-2 border-amber-400 flex items-center justify-center overflow-hidden shrink-0">
                    {winner.participant.avatarUrl ? (
                      <img
                        src={winner.participant.avatarUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xl font-bold text-white">
                        {winner.participant.firstName[0]}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-base font-bold text-white truncate">
                      {winner.participant.firstName} {winner.participant.lastName}
                    </h4>
                    <span className="text-xs text-slate-400 font-mono block">
                      id{winner.participant.platformUserId}
                    </span>
                    <a
                      href={`https://vk.com/id${winner.participant.platformUserId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1"
                    >
                      Открыть профиль VK
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {/* Reserve Winners */}
            {drawResult.reserveWinners.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-800 max-w-2xl mx-auto text-left">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Резервные победители:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {drawResult.reserveWinners.map((res) => (
                    <div
                      key={res.participant.platformUserId}
                      className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3"
                    >
                      <span className="text-xs font-bold text-slate-400">
                        Резерв #{res.position}
                      </span>
                      <span className="text-xs font-medium text-white truncate">
                        {res.participant.firstName} {res.participant.lastName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Provably Fair Audit Certificate */}
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                <Shield className="w-4 h-4" />
                Криптографический сертификат честности (Audit Trail)
              </div>
              <button
                onClick={() => {
                  const proofText = JSON.stringify(drawResult, null, 2);
                  navigator.clipboard.writeText(proofText);
                  setCopiedProof(true);
                  setTimeout(() => setCopiedProof(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
              >
                {copiedProof ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Скопировано!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Скопировать JSON аудита
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-medium">Seed розыгрыша:</span>
                <p className="font-mono text-blue-400 break-all">{drawResult.seedUsed}</p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-medium">Алгоритм:</span>
                <p className="font-mono text-amber-400 break-all">{drawResult.algorithmVersion}</p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-medium">Хеш участников (SHA-256):</span>
                <p className="font-mono text-emerald-400 break-all">{drawResult.participantsSnapshotHash}</p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-medium">Хеш условий (conditionsHash):</span>
                <p className="font-mono text-purple-400 break-all">{drawResult.conditionsHash}</p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 sm:col-span-2">
                <span className="text-slate-400 font-medium">deterministicProofHash (воспроизводимый):</span>
                <p className="font-mono text-indigo-300 break-all">{drawResult.deterministicProofHash}</p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 sm:col-span-2">
                <span className="text-slate-400 font-medium">auditEventHash (уникальный для события):</span>
                <p className="font-mono text-slate-400 break-all">{drawResult.auditEventHash}</p>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <Link
                href="/"
                className="text-xs font-medium text-blue-400 hover:underline"
              >
                ← Вернуться в дашборд
              </Link>
              <Link
                href={`/giveaways/${drawResult.giveawayId}`}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Страница постоянного аудита →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
