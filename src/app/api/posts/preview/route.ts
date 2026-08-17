import { NextRequest, NextResponse } from 'next/server';
import { ProviderRegistry } from '@/providers/registry';
import { PlatformType } from '@/core/types/giveaway';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, platform = 'VK' } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const provider = ProviderRegistry.getProvider(platform as PlatformType);
    const parsed = provider.parsePostUrl(url);

    if (!parsed) {
      return NextResponse.json({ 
        error: 'Неверный формат ссылки на запись VK. Пример: https://vk.com/wall-123456_789' 
      }, { status: 400 });
    }

    const postMetadata = await provider.fetchPost(url);
    return NextResponse.json({ success: true, post: postMetadata });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Ошибка при загрузке данных поста' },
      { status: 500 }
    );
  }
}
