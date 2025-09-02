import React from 'react';

type Props = {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
};

export default function Pager({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;

  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  const start = Math.max(
    1,
    Math.min(page - half, totalPages - windowSize + 1),
  );
  const end = Math.min(totalPages, start + windowSize - 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div className="flex justify-center items-center gap-1 my-2">
      <button
        className="px-2 py-1 text-xs rounded border"
        disabled={page === 1}
        onClick={() => onChange(1)}
      >
        ‹
      </button>
      {pages.map((p) => (
        <button
          key={p}
          className={`px-2 py-1 text-xs rounded border ${p === page ? 'bg-gray-800 text-white' : 'bg-white'}`}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      <button
        className="px-2 py-1 text-xs rounded border"
        disabled={page === totalPages}
        onClick={() => onChange(totalPages)}
      >
        ›
      </button>
    </div>
  );
}
