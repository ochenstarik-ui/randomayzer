import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../src/providers/registry';
import { VkProvider } from '../src/providers/vk/vk-provider';
import { GiveawayStore } from '../src/lib/giveaway-store';
import { MemoryGiveawayRepository } from '../src/lib/repository/memory-repository';
import { NextRequest } from 'next/server';
import { POST as giveawaysPost } from '../src/app/api/giveaways/route';
import { POST as previewPost } from '../src/app/api/posts/preview/route';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Security: VK_SERVICE_TOKEN handling', () => {
  const secretToken = 'vk1.a.super-secret-service-token-xyz';

  beforeEach(() => {
    GiveawayStore.setRepository(new MemoryGiveawayRepository());
    ProviderRegistry.useMockVk();
  });

  it('ProviderRegistry does not expose VK_SERVICE_TOKEN in public API', () => {
    process.env.VK_SERVICE_TOKEN = secretToken;
    // Re-initialize registry (static block already ran, but we can inspect provider)
    const provider = ProviderRegistry.getProvider('VK');
    expect(provider.platform).toBe('VK');
    expect(provider).not.toHaveProperty('serviceToken');
    delete process.env.VK_SERVICE_TOKEN;
  });

  it('Giveaway API response does not contain VK_SERVICE_TOKEN', async () => {
    process.env.VK_SERVICE_TOKEN = secretToken;
    const req = new NextRequest('http://localhost/api/giveaways', {
      method: 'POST',
      body: JSON.stringify({
        sourceUrl: 'https://vk.com/wall-1_1',
        post: {
          platform: 'VK',
          ownerId: '-1',
          postId: '1',
          sourceUrl: 'https://vk.com/wall-1_1',
          title: 'Test',
          text: 'Test',
          likesCount: 0,
          commentsCount: 0,
          repostsCount: 0,
        },
        filterRules: {
          requireLike: true,
          requireComment: false,
          requireRepost: false,
          requireSubscription: false,
          excludeAdmins: false,
          excludeBlacklistedIds: [],
          excludeDuplicateComments: true,
        },
      }),
    });

    const res = await giveawaysPost(req);
    const text = await res.text();
    expect(text).not.toContain(secretToken);
    delete process.env.VK_SERVICE_TOKEN;
  });

  it('Post preview response does not contain VK_SERVICE_TOKEN', async () => {
    process.env.VK_SERVICE_TOKEN = secretToken;
    ProviderRegistry.useMockVk(); // mock so no real API call
    const req = new NextRequest('http://localhost/api/posts/preview', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vk.com/wall-1_1' }),
    });

    const res = await previewPost(req);
    const text = await res.text();
    expect(text).not.toContain(secretToken);
    delete process.env.VK_SERVICE_TOKEN;
  });

  it('Created giveaway does not persist VK_SERVICE_TOKEN', async () => {
    process.env.VK_SERVICE_TOKEN = secretToken;
    const repo = new MemoryGiveawayRepository();
    GiveawayStore.setRepository(repo);

    const gw = await GiveawayStore.create({
      sourceUrl: 'https://vk.com/wall-1_1',
      post: {
        platform: 'VK',
        ownerId: '-1',
        postId: '1',
        sourceUrl: 'https://vk.com/wall-1_1',
        title: 'Test',
        text: 'Test',
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
      },
      filterRules: {
        requireLike: true,
        requireComment: false,
        requireRepost: false,
        requireSubscription: false,
        excludeAdmins: false,
        excludeBlacklistedIds: [],
        excludeDuplicateComments: true,
      },
      organizerId: 'usr_security_test',
    });

    const json = JSON.stringify(gw);
    expect(json).not.toContain(secretToken);
    delete process.env.VK_SERVICE_TOKEN;
  });

  it('VkProvider error messages do not contain the token', async () => {
    const provider = new VkProvider(secretToken);
    let thrownMessage = '';
    try {
      // Force error by calling with no token? Provider has token, but callApi will fail network.
      await provider.fetchPost('not-a-valid-url');
    } catch (err: any) {
      thrownMessage = err.message || '';
    }
    expect(thrownMessage).not.toContain(secretToken);
  });

  it('.gitignore excludes local environment files', () => {
    const gitignore = readFileSync(resolve(__dirname, '../.gitignore'), 'utf-8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env*.local');
  });

  it('.env.example does not contain real secrets', () => {
    const envExample = readFileSync(resolve(__dirname, '../.env.example'), 'utf-8');
    expect(envExample).toContain('your_vk_service_token_here');
    expect(envExample).not.toMatch(/vk1\.[a-zA-Z0-9]/);
  });
});
