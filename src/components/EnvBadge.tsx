'use client';
import React from 'react';
import { EnvKey } from '@/lib/env';

type Props = {
  env: EnvKey;
  label?: string;
  baseUrl?: string;
  onToggle: () => void;
};

export default function EnvBadge({ env, label, baseUrl, onToggle }: Props) {
  const cls =
    env === 'prod'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-amber-100 text-amber-700';
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onToggle}
        className={`px-2 py-1 text-xs rounded ${cls}`}
        title="クリックで切替"
      >
        {label || (env === 'prod' ? '本番' : 'テスト')}
      </button>
      {baseUrl && (
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline opacity-70"
        >
          GAS
        </a>
      )}
    </div>
  );
}
