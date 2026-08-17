import { PlatformType, PostMetadata } from '../../core/types/giveaway';
import { RawParticipant } from '../../core/types/participant';
import { FetchParticipantsParams, ProviderCapabilities, SocialMediaProvider } from '../types';
import { parseVkPostUrl } from './vk-parser';

export interface MockScenario {
  /** Total number of generated participants (default 35). */
  participantCount: number;
  /** Ratio of participants with liked=true (0..1). Default matches legacy behavior. */
  likedRatio?: number;
  /** Ratio of participants with commented=true (0..1). Default matches legacy behavior. */
  commentedRatio?: number;
  /** Number of comments per commented participant. Default matches legacy behavior. */
  commentsCount?: number | ((index: number) => number);
  /** Ratio of subscribed participants (0..1). When omitted, legacy "ends with 0 or 5" rule is used. */
  subscribedRatio?: number;
  /** IDs that should be marked as admins. */
  adminIds?: string[];
  /** IDs that should exist in the generated set for blacklist tests (they are not auto-excluded). */
  blacklistedIds?: string[];
  /** Additional raw entries injected into the returned list (useful for duplicates). */
  extraParticipants?: RawParticipant[];
}

const DEFAULT_SCENARIO: MockScenario = {
  participantCount: 35,
};

const MOCK_NAMES = [
  { first: 'Алексей', last: 'Смирнов', user: 'smirnov_alex' },
  { first: 'Екатерина', last: 'Иванова', user: 'katya_iva' },
  { first: 'Дмитрий', last: 'Кузнецов', user: 'kuznetsov_d' },
  { first: 'Анна', last: 'Попова', user: 'anna_popova' },
  { first: 'Михаил', last: 'Соколов', user: 'misha_sokol' },
  { first: 'Елена', last: 'Лебедева', user: 'elena_leb' },
  { first: 'Сергей', last: 'Козлов', user: 'sergey_kozlov' },
  { first: 'Ольга', last: 'Новикова', user: 'olga_nov' },
  { first: 'Иван', last: 'Морозов', user: 'ivan_moroz' },
  { first: 'Татьяна', last: 'Петрова', user: 'tatyana_p' },
  { first: 'Артем', last: 'Волков', user: 'artem_volkov' },
  { first: 'Мария', last: 'Соловьева', user: 'maria_sol' },
  { first: 'Максим', last: 'Васильев', user: 'max_vas' },
  { first: 'Виктория', last: 'Зайцева', user: 'vika_zaytseva' },
  { first: 'Павел', last: 'Павлов', user: 'pavel_p' },
  { first: 'Ксения', last: 'Семенова', user: 'ksenia_sem' },
  { first: 'Роман', last: 'Голубев', user: 'roman_g' },
  { first: 'Алина', last: 'Виноградова', user: 'alina_vin' },
  { first: 'Денис', last: 'Богданов', user: 'denis_bogdan' },
  { first: 'Анастасия', last: 'Воробьева', user: 'nastya_vorob' },
  { first: 'Илья', last: 'Федоров', user: 'ilya_fed' },
  { first: 'Полина', last: 'Михайлова', user: 'polina_m' },
  { first: 'Владимир', last: 'Беляев', user: 'vlad_bel' },
  { first: 'Дарья', last: 'Тарасова', user: 'daria_t' },
  { first: 'Никита', last: 'Белов', user: 'nikita_bel' },
];

/**
 * Deterministic pseudo-random value in [0, 1) based on an integer seed.
 * Uses a simple LCG so mock scenarios are reproducible across test runs.
 */
function deterministic01(seed: number): number {
  return ((seed * 9301 + 49297) % 233280) / 233280;
}

function legacyLiked(i: number): boolean {
  return i !== 7 && i !== 19;
}

function legacyCommented(i: number): boolean {
  return i % 2 === 0 || i % 3 === 0;
}

function legacyCommentsCount(i: number): number {
  return legacyCommented(i) ? (i % 5 === 0 ? 3 : 1) : 0;
}

export class VkMockProvider implements SocialMediaProvider {
  readonly platform: PlatformType = 'VK';
  readonly capabilities: ProviderCapabilities = {
    likes: true,
    comments: true,
    reposts: false,
    repostsNote: 'Не поддерживается VK API из-за ограничений приватности закрытых профилей',
    subscriptions: true,
    adminDetection: false,
    adminDetectionNote: 'Требует расширенных прав администратора сообщества',
  };

  private scenario: MockScenario = { ...DEFAULT_SCENARIO };

  parsePostUrl(url: string): { ownerId: string; postId: string } | null {
    return parseVkPostUrl(url);
  }

  /**
   * Configure the mock scenario. Does not change the public SocialMediaProvider contract.
   */
  setScenario(scenario: Partial<MockScenario>): void {
    this.scenario = { ...DEFAULT_SCENARIO, ...scenario };
  }

  /**
   * Reset to the original 35-participant default scenario.
   */
  resetScenario(): void {
    this.scenario = { ...DEFAULT_SCENARIO };
  }

  getScenario(): MockScenario {
    return { ...this.scenario };
  }

  async fetchPost(url: string): Promise<PostMetadata> {
    const parsed = this.parsePostUrl(url);
    const ownerId = parsed ? parsed.ownerId : '-22446688';
    const postId = parsed ? parsed.postId : '1054';

    await new Promise(r => setTimeout(r, 200));

    return {
      platform: 'VK',
      ownerId,
      postId,
      sourceUrl: url.startsWith('http') ? url : `https://vk.com/wall${ownerId}_${postId}`,
      title: 'Большой весенний розыгрыш подарков!',
      text: '🎉 Внимание! Разыгрываем крутые призы среди наших подписчиков!\n\nУсловия просты:\n1. Поставить лайк этому посту ❤️\n2. Написать любой комментарий 💬\n3. Быть подписанным на наше сообщество ✨\n\nИтоги подведем честно и прозрачно через генератор случайных чисел!',
      authorName: 'Официальное сообщество Randomayzer',
      authorAvatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      imageUrl: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&auto=format&fit=crop&q=80',
      likesCount: 142,
      commentsCount: 86,
      repostsCount: 37,
      publishedAt: new Date(Date.now() - 3600000 * 24 * 2),
    };
  }

  async fetchParticipants(_params: FetchParticipantsParams): Promise<RawParticipant[]> {
    const {
      participantCount,
      likedRatio,
      commentedRatio,
      commentsCount: commentsCountOverride,
      adminIds = [],
      extraParticipants = [],
    } = this.scenario;

    const adminSet = new Set(adminIds.map(id => id.trim()));

    const participants: RawParticipant[] = [];

    for (let i = 1; i <= participantCount; i++) {
      const nameObj = MOCK_NAMES[(i - 1) % MOCK_NAMES.length];
      const userId = `${1000000 + i * 137}`;

      const liked = likedRatio !== undefined
        ? deterministic01(i * 7 + 1) < likedRatio
        : legacyLiked(i);

      const commented = commentedRatio !== undefined
        ? deterministic01(i * 13 + 3) < commentedRatio
        : legacyCommented(i);

      const commentsCount = typeof commentsCountOverride === 'function'
        ? commentsCountOverride(i)
        : commentsCountOverride !== undefined
          ? (commented ? commentsCountOverride : 0)
          : legacyCommentsCount(i);

      const reposted = false; // explicitly false as per capabilities
      const subscribed = false; // resolved via checkSubscription
      const isAdmin = adminSet.has(userId);

      participants.push({
        platformUserId: userId,
        firstName: nameObj.first + (i > MOCK_NAMES.length ? ` ${Math.floor(i / MOCK_NAMES.length) + 1}` : ''),
        lastName: nameObj.last,
        username: `${nameObj.user}_${i}`,
        avatarUrl: `https://images.unsplash.com/photo-${1534528741775 + (i * 1000)}?w=100&auto=format&fit=crop&q=80`,
        source: 'COMBINED',
        liked,
        commented,
        commentsCount,
        reposted,
        subscribed,
        isAdmin,
      });
    }

    if (extraParticipants.length > 0) {
      participants.push(...extraParticipants);
    }

    return participants;
  }

  async checkSubscription(userIds: string[], _groupId: string): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const { subscribedRatio } = this.scenario;

    for (const id of userIds) {
      const num = parseInt(id, 10);

      if (subscribedRatio !== undefined) {
        result.set(id, deterministic01(num * 17 + 11) < subscribedRatio);
      } else {
        // Legacy behavior: users ending in 0 or 5 are not subscribed
        result.set(id, num % 5 !== 0);
      }
    }

    return result;
  }
}
