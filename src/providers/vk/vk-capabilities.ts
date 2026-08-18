import { ProviderCapabilities } from '../types';
import { VkAuthContext } from '@/integrations/vk/vk-types';

export type UserCredentialStatus = 'AVAILABLE' | 'REFRESHABLE' | 'REAUTH_REQUIRED' | 'MISSING';
export type VkAccessMode = 'PUBLIC_SERVICE' | 'ORGANIZER_USER' | 'COMMUNITY_GROUP';

export interface EffectiveCapabilities extends ProviderCapabilities {
  accessMode: VkAccessMode;
  credentialStatus?: UserCredentialStatus;
}

export const STATIC_VK_CAPABILITIES: ProviderCapabilities = {
  likes: true,
  comments: true,
  reposts: false,
  repostsNote: 'Сбор репостов ограничен политикой приватности VK для закрытых профилей',
  subscriptions: true,
  adminDetection: false,
  adminDetectionNote: 'Требует расширенных прав администратора сообщества',
};

/**
 * Derives effective capabilities at runtime based on the resolved auth context and target resource.
 */
export function resolveEffectiveCapabilities(
  authContext?: { type: 'SERVICE' | 'USER' | 'COMMUNITY'; credentialStatus?: UserCredentialStatus } | VkAuthContext | null
): EffectiveCapabilities {
  const accessMode: VkAccessMode = !authContext || authContext.type === 'SERVICE'
    ? 'PUBLIC_SERVICE'
    : authContext.type === 'USER'
      ? 'ORGANIZER_USER'
      : 'COMMUNITY_GROUP';

  const isCommunityAdmin = authContext?.type === 'COMMUNITY';
  const credentialStatus = authContext && 'credentialStatus' in authContext ? authContext.credentialStatus : undefined;

  return {
    ...STATIC_VK_CAPABILITIES,
    adminDetection: isCommunityAdmin,
    adminDetectionNote: isCommunityAdmin
      ? undefined
      : 'Требует прямого подключения токена сообщества с правами администратора',
    accessMode,
    ...(credentialStatus ? { credentialStatus } : {}),
  };
}
