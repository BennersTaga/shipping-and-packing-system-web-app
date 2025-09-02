import React from 'react';

type Props = {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
};

export default function Pager({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  return (
    <div className="flex justify-center items-center gap-1 my-2">
      <button
        className="px-2 py-1 text-xs rounded border"
        disabled={page <= 1}
        onClick={() => page > 1 && onChange(page - 1)}
      >
        Prev
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
        disabled={page >= totalPages}
        onClick={() => page < totalPages && onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
