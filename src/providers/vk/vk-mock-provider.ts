import { PlatformType, PostMetadata } from '../../core/types/giveaway';
import { RawParticipant } from '../../core/types/participant';
import { FetchParticipantsParams, ProviderCapabilities, SocialMediaProvider } from '../types';
import { parseVkPostUrl } from './vk-parser';

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

  parsePostUrl(url: string): { ownerId: string; postId: string } | null {
    return parseVkPostUrl(url);
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

  async fetchParticipants(params: FetchParticipantsParams): Promise<RawParticipant[]> {
    const mockNames = [
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

    const participants: RawParticipant[] = [];

    for (let i = 1; i <= 35; i++) {
      const nameObj = mockNames[(i - 1) % mockNames.length];
      const userId = `${1000000 + i * 137}`;
      
      const liked = i !== 7 && i !== 19;
      const commented = i % 2 === 0 || i % 3 === 0;
      const commentsCount = commented ? (i % 5 === 0 ? 3 : 1) : 0;
      const reposted = false; // explicitly false as per capabilities
      const subscribed = false; // will be resolved via checkSubscription
      const isAdmin = false;

      participants.push({
        platformUserId: userId,
        firstName: nameObj.first + (i > mockNames.length ? ` ${Math.floor(i / mockNames.length) + 1}` : ''),
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

    return participants;
  }

  async checkSubscription(userIds: string[], groupId: string): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    for (const id of userIds) {
      // Mock: users ending in 0 or 5 are not subscribed, others are subscribed
      const num = parseInt(id, 10);
      result.set(id, num % 5 !== 0);
    }
    return result;
  }
}
