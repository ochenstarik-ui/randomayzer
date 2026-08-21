'use client';

import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

interface AuthUser {
  id: string;
  vkUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
}

export function AuthButton() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      window.location.reload();
    } catch (e) {
      console.error('Logout error', e);
    }
  };

  if (loading) {
    return (
      <div className="w-24 h-9 bg-slate-800/50 animate-pulse rounded-lg" />
    );
  }

  if (user) {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || `VK ${user.vkUserId}`;
    return (
      <div className="flex items-center gap-3 bg-slate-800/40 border border-slate-700/60 rounded-lg py-1 px-2.5">
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt={fullName}
            width={28}
            height={28}
            className="w-7 h-7 rounded-full object-cover border border-blue-500/40"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-blue-600/30 flex items-center justify-center text-blue-400">
            <UserIcon className="w-3.5 h-3.5" />
          </div>
        )}
        <span className="text-xs font-medium text-slate-200 hidden sm:inline max-w-[120px] truncate">
          {fullName}
        </span>
        <button
          onClick={handleLogout}
          title="Выйти"
          className="text-slate-400 hover:text-rose-400 p-1 hover:bg-slate-700/50 rounded transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const authUrl = pathname && pathname !== '/' 
    ? `/api/auth/vk/start?redirectTarget=${encodeURIComponent(pathname)}`
    : '/api/auth/vk/start';

  return (
    <a
      href={authUrl}
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-[#0077ff]/15 hover:bg-[#0077ff]/25 text-[#0077ff] border border-[#0077ff]/30 rounded-lg transition-all active:scale-95 shadow-sm"
    >
      <LogIn className="w-3.5 h-3.5" />
      <span>Войти через VK ID</span>
    </a>
  );
}
