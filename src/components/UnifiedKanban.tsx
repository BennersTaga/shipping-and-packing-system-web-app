'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EnvBadge from "./EnvBadge";

type EnvKey = 'test' | 'prod';
// Unified Kanban UI – 梱包/出荷/在庫 の表側プロトタイプ
// v2.20
// - カード情報を縦並びにレイアウト（長い文字列でも途中で切れにくい）
// - 操作ダイアログのボタンを一回しか押せないように（多重送信ガード）
// - 梱包時の重複カードを自動マージ（同 rowIndex & 同ロケーション は加算更新）
// - GAS 側にログを残すため action/metadata を update API に送信

// ===== 型 =====
export type PackingItem = {
  rowIndex: number;
  manufactureDate: string;
  batchNo?: string;
  seasoningType: string;
  fishType: string;
  origin: string;
  quantity: number; // 製造数量（ベース）
  manufactureProduct: string;
  status: "未処理" | "完了" | "出荷済み"; // 既存互換
  packingInfo: {
    location: string;
    quantity: string;
    date?: string;
    user?: string;
  };
  stockQty?: number;
  shipType?: string;
  packDate?: string;
  shipDate?: string;
};

type PaginationMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type Meta = {
  pagination?: {
    manufactured: PaginationMeta;
    stock: PaginationMeta;
    shipped: PaginationMeta;
  };
  backlog?: { count: number; items?: PackingItem[] };
  env?: { key: EnvKey; label: string };
  gasUrl?: string;
};

type ShipType = "ロジカム出荷" | "羽野出荷";

// ===== API config / helpers =====
const API_ENDPOINTS = {
  SEARCH_PACKING: "/api/packing/search",
  UPDATE_PACKING: "/api/packing/update",
};

type Action = "pack" | "ship" | "move" | "restore";

const toast = (msg: string) => {
  if (typeof window !== "undefined") alert(msg);
  console.error(msg);
};

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。ネットワーク状況を確認し、ページを再読み込みしてください。";

const STORAGE_OPTIONS = [
  "パレット①",
  "パレット②",
  "パレット③",
  "パレット④",
  "パレット⑤",
  "パレット⑥",
  "パレット⑦",
  "仮置きパレット（作業途中のもの）",
  "台車（パレットに置き場所がない場合）",
];

// ラベル（灰色ボックス）の横幅を統一：味付け種類に合わせた目安
// ※必要なら数値を微調整してください（Tailwind 任意値）
const LABEL_WIDTH = "w-[6.5rem]";

// ===== Kanban 用ステータス（UI表示） =====
const K_STATUSES = [
  { id: "manufactured", label: "製造済み", hint: "未処理（梱包前）" },
  { id: "stock", label: "梱包済み（在庫）", hint: "完了＝在庫化" },
  { id: "shipped", label: "出荷済み", hint: "アーカイブから復帰可" },
] as const;

type KanbanStatusId = (typeof K_STATUSES)[number]["id"];

type Filters = {
  date: string;
  product: string;
  status: "" | "manufactured" | "stock" | "shipped";
  quantityMin: string;
  quantityMax: string;
};

// DnD
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Pager from "./Pager";

// ===== 純粋関数（テストしやすい） =====
export function computeRestoredItem(
  base: PackingItem,
  location: string,
  qty: number,
): PackingItem {
  return {
    ...base,
    packingInfo: {
      ...base.packingInfo,
      location: location.trim(),
      quantity: String(qty),
    },
    status: "完了",
    stockQty: qty,
  };
}

export function computeSplit(originalQty: number, moveQty: number) {
  const o = Math.max(0, Number(originalQty) || 0);
  const m = Math.max(1, Math.min(Number(moveQty) || 0, o));
  return { remain: o - m, move: m };
}

function normalizeLocation(raw: string): { key: string; label: string } {
  const circled: Record<string, string> = {
    "①": "1",
    "②": "2",
    "③": "3",
    "④": "4",
    "⑤": "5",
    "⑥": "6",
    "⑦": "7",
    "⑧": "8",
    "⑨": "9",
    "⑩": "10",
  };
  let v = String(raw || "")
    .trim()
    .normalize("NFKC")
    .replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfEE0),
    )
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (m) => circled[m])
    .replace(/\s+/g, " ");
  if (/^仮置きパレット/.test(v)) {
    return { key: "pallet-temp", label: "仮置きパレット" };
  }
  const m = v.match(/^パレット\s*(\d{1,2})/);
  if (m) {
    const n = m[1];
    return { key: `pallet-${n}`, label: `パレット${n}` };
  }
  const label = v.trim();
  return {
    key: label.replace(/\s+/g, "-").toLowerCase(),
    label,
  };
}

function buildMockData(date: string): PackingItem[] {
  return [
    {
      rowIndex: 1645,
      manufactureDate: date,
      batchNo: "B-645",
      seasoningType: "醤油(生食用)",
      fishType: "ホウボウ",
      origin: "福岡",
      quantity: 200,
      manufactureProduct: "フィシュル商品",
      status: "未処理",
      packingInfo: { location: "", quantity: "0" },
      shipType: "",
    },
    {
      rowIndex: 1646,
      manufactureDate: date,
      batchNo: "B-646",
      seasoningType: "醤油(生食用)",
      fishType: "ホウボウ",
      origin: "福岡",
      quantity: 443,
      manufactureProduct: "フィシュル商品",
      status: "完了",
      packingInfo: { location: "パレット②", quantity: "443", user: "A" },
      shipType: "",
      packDate: date,
    },
    {
      rowIndex: 1647,
      manufactureDate: date,
      batchNo: "B-647",
      seasoningType: "にんにく醤油(生食用)",
      fishType: "ホウボウ",
      origin: "福岡",
      quantity: 200,
      manufactureProduct: "フィシュル商品",
      status: "完了",
      packingInfo: { location: "パレット①", quantity: "200", user: "B" },
      shipType: "",
      packDate: date,
    },
  ];
}

// ===== メイン =====
function UnifiedKanbanImpl() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const inflightRef = useRef<Set<string>>(new Set()); // 多重送信ガード
  const searchRef = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  });

  const [filters, setFilters] = useState<Filters>({
    date: today,
    product: "",
    status: "",
    quantityMin: "",
    quantityMax: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationOptions, setLocationOptions] = useState(STORAGE_OPTIONS);

  // Kanban の並び（各列に属するカードID）
  const [columns, setColumns] = useState<Record<KanbanStatusId, string[]>>({
    manufactured: [],
    stock: [],
    shipped: [],
  });
  // カード辞書（id -> item）
  const [cards, setCards] = useState<Record<string, PackingItem>>({});

  // 出荷アーカイブ
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveItems, setArchiveItems] = useState<PackingItem[]>([]);
  const [archivePagination, setArchivePagination] = useState({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });
  const [archiveYears, setArchiveYears] = useState<number[]>([]);
  const [archiveMonths, setArchiveMonths] = useState<number[]>([]);
  const [archiveDays, setArchiveDays] = useState<number[]>([]);
  const [archiveYear, setArchiveYear] = useState<number | null>(null);
  const [archiveMonth, setArchiveMonth] = useState<number | null>(null);
  const [archiveDay, setArchiveDay] = useState<number | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<PackingItem | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();            // may be null on server, but we're in client
  const qp = searchParams?.get('env');               // 'test' | 'prod' | null

  const defaultEnv = (): EnvKey =>
    (process.env.NEXT_PUBLIC_DEFAULT_ENV?.toLowerCase() === 'prod' ? 'prod' : 'test');

  const initialEnv: EnvKey =
    qp === 'prod' || qp === 'test' ? (qp as EnvKey) : defaultEnv();

  const [env, setEnv] = useState<EnvKey>(initialEnv);
  const [gasUrl, setGasUrl] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState({ manufactured: 1, stock: 1, shipped: 1 });
  const [meta, setMeta] = useState<Meta | null>(null);

  const [backlogOpen, setBacklogOpen] = useState(false);
  const [backlogItems, setBacklogItems] = useState<PackingItem[]>([]);
  const [backlogPagination, setBacklogPagination] = useState({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });
  const [backlogLoading, setBacklogLoading] = useState(false);
  const prodConfirmed = useRef(false);

  useEffect(() => {
    const current = searchParams?.get("env");
    if (current !== env) {
      const sp = new URLSearchParams(searchParams ? searchParams.toString() : "");
      sp.set("env", env);
      router.replace(`?${sp.toString()}`, { scroll: false });
    }
  }, [env, router, searchParams]);

  // ==== データ取得 ====
  async function fetchData(
    override?: Partial<Filters>,
    pageOverride?: Partial<typeof pages>,
  ) {
    setLoading(true);
    setError(null);
    const myId = ++searchRef.current.id;
    searchRef.current.controller?.abort();
    const controller = new AbortController();
    searchRef.current.controller = controller;
    try {
      const f = { ...filters, ...override };
      const p = { ...pages, ...pageOverride };
      setPages(p);

      // 既存 API の status は "未処理"/"完了" なのでマッピング
      const legacyStatusMap: Record<string, string> = {
        manufactured: "未処理",
        stock: "完了",
        shipped: "出荷済み",
      };

      const params = new URLSearchParams();
      params.append("env", env);
      if (f.date) {
        params.append("date", f.date);
        params.append("includeBacklog", "1");
      }
      if (f.product) params.append("product", f.product);
      if (f.status && legacyStatusMap[f.status])
        params.append("status", legacyStatusMap[f.status]);
      if (f.quantityMin) params.append("quantityMin", f.quantityMin);
      if (f.quantityMax) params.append("quantityMax", f.quantityMax);

      params.append("paginate", "1");
      params.append("pageSize", "10");
      params.append("pageManufactured", String(p.manufactured));
      params.append("pageStock", String(p.stock));
      params.append("pageShipped", String(p.shipped));

      let data: PackingItem[] | null = null;
      let masters: string[] = [];
      let metaInfo: any = null;
      try {
        const res = await fetch(
          `${API_ENDPOINTS.SEARCH_PACKING}?${params.toString()}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error(res.statusText);
        const j = await res.json().catch(() => null);
        if (myId !== searchRef.current.id) return;
        if (j?.success === true) {
          data = (j.data as PackingItem[]) || [];
          masters = Array.isArray(j.masters?.locations)
            ? (j.masters.locations as string[])
            : masters;
          metaInfo = j.meta || null;
        } else {
          throw new Error(j?.error || "検索に失敗しました");
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        console.error("[packing/search] failed", err);
        alert(NETWORK_ERROR_MESSAGE);
        data = buildMockData(f.date);
      }
      if (myId !== searchRef.current.id) return;

      const locMap = new Map<string, string>();
      for (const raw of masters.length ? masters : STORAGE_OPTIONS) {
        const { key, label } = normalizeLocation(raw);
        if (label && !locMap.has(key)) locMap.set(key, label);
      }

      const processed: PackingItem[] = [];
      const stockGroups = new Map<string, PackingItem>();
      for (const it of data || []) {
        const loc = normalizeLocation(it.packingInfo?.location || "");
        if (loc.label && !locMap.has(loc.key)) locMap.set(loc.key, loc.label);
        const normalized: PackingItem = {
          ...it,
          packingInfo: { ...it.packingInfo, location: loc.label },
        };
        if (it.status === "完了") {
          const stockQty = Number(it.packingInfo?.quantity || 0);
          const key = `${it.rowIndex}|${loc.key}`;
          const g = stockGroups.get(key);
          if (g) {
            g.stockQty = (g.stockQty || 0) + stockQty;
            g.packingInfo.quantity = String(g.stockQty);
          } else {
            stockGroups.set(key, {
              ...normalized,
              packingInfo: {
                ...normalized.packingInfo,
                quantity: String(stockQty),
              },
              stockQty,
            });
          }
        } else {
          processed.push(normalized);
        }
      }
      processed.push(...Array.from(stockGroups.values()));

      setLocationOptions(
        Array.from(locMap.values()).sort((a, b) => a.localeCompare(b)),
      );

      const nextCards: Record<string, PackingItem> = {};
      const col: Record<KanbanStatusId, string[]> = {
        manufactured: [],
        stock: [],
        shipped: [],
      };

      for (const it of processed) {
        const uiStatus: KanbanStatusId =
          it.status === "未処理"
            ? "manufactured"
            : it.status === "出荷済み"
              ? "shipped"
              : "stock";
        const id = makeId(it);
        nextCards[id] = it;
        col[uiStatus].push(id);
      }

      setCards(nextCards);
      setColumns(col);
      setMeta(metaInfo);
      if (metaInfo?.env?.key && (metaInfo.env.key === "prod" || metaInfo.env.key === "test")) {
        if (metaInfo.env.key !== env) setEnv(metaInfo.env.key);
      }
      if (metaInfo?.gasUrl) setGasUrl(metaInfo.gasUrl);
    } catch (e: any) {
      if (myId === searchRef.current.id)
        setError(e.message || "読み込みエラー");
    } finally {
      if (myId === searchRef.current.id) setLoading(false);
    }
  }

  async function fetchBacklog(page = 1) {
    if (!filters.date) return;
    setBacklogLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("env", env);
      params.append("scope", "backlog");
      params.append("excludeDate", filters.date);
      params.append("paginate", "1");
      params.append("pageSize", "10");
      params.append("pageManufactured", String(page));
      const res = await fetch(
        `${API_ENDPOINTS.SEARCH_PACKING}?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(res.statusText);
      const j = await res.json();
      if (j.success) {
        setBacklogItems(j.data || []);
        const info =
          j.meta?.pagination?.manufactured ||
          ({ total: 0, page: 1, pageSize: 10, totalPages: 1 } as any);
        setBacklogPagination(info);
      }
    } catch (e) {
      console.error("fetchBacklog failed", e);
    } finally {
      setBacklogLoading(false);
    }
  }

  async function fetchArchive(params: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
    page?: number;
  }) {
    setArchiveLoading(true);
    try {
      const search = new URLSearchParams();
      search.append("env", env);
      search.append("scope", "archive");
      if (params.year) search.append("year", String(params.year));
      if (params.month) search.append("month", String(params.month));
      if (params.day) search.append("day", String(params.day));
      search.append("paginate", "1");
      search.append("pageSize", "10");
      search.append("pageShipped", String(params.page || 1));
      const res = await fetch(`/api/gas/search?${search.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(res.statusText);
      const j = await res.json();
      setArchiveYears(j.meta?.archive?.years || []);
      setArchiveMonths(j.meta?.archive?.months || []);
      setArchiveDays(j.meta?.archive?.days || []);
      if (params.day) {
        setArchiveItems(j.data || []);
        const info =
          j.meta?.pagination?.shipped ||
          ({ total: 0, page: 1, pageSize: 10, totalPages: 1 } as any);
        setArchivePagination(info);
      } else {
        setArchiveItems([]);
        setArchivePagination({
          total: 0,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        });
      }
    } catch (e) {
      console.error("fetchArchive failed", e);
    } finally {
      setArchiveLoading(false);
    }
  }

  function openArchiveModal() {
    setArchiveOpen(true);
    setArchiveYear(null);
    setArchiveMonth(null);
    setArchiveDay(null);
    setArchiveItems([]);
    setArchivePagination({
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    fetchArchive({});
  }

  useEffect(() => {
    fetchData({ date: today }, { manufactured: 1, stock: 1, shipped: 1 });
  }, [today, env]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==== DnD 設定 ====
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const from = findColumnOf(activeId, columns);
    const to = (over.id as KanbanStatusId) || from;
    if (!from || !to || from === to) return;

    // 製造→在庫、在庫→出荷 のみ許可（左→右）
    const allowed =
      (from === "manufactured" && to === "stock") ||
      (from === "stock" && to === "shipped");
    if (!allowed) return;

    const item = cards[activeId];
    if (!item) return;

    if (from === "manufactured" && to === "stock") {
      openDialog({
        mode: "pack",
        item,
        origin: from,
        onSubmit: (p) => doPack(item, p as any),
      });
    } else if (from === "stock" && to === "shipped") {
      openDialog({
        mode: "ship",
        item,
        origin: from,
        onSubmit: (p) => doShip(item, p as any),
      });
    }
  }

  // ==== 操作ダイアログ ====
  const [dialog, setDialog] = useState<{
    mode: "pack" | "ship" | "move" | null;
    origin?: KanbanStatusId;
    item?: PackingItem | null;
    onSubmit?: (p: {
      location?: string;
      quantity?: number;
      shipType?: ShipType;
    }) => Promise<void> | void;
  }>({ mode: null });

  function openDialog(d: {
    mode: "pack" | "ship" | "move";
    origin?: KanbanStatusId;
    item: PackingItem;
    onSubmit: (p: {
      location?: string;
      quantity?: number;
      shipType?: ShipType;
    }) => Promise<void> | void;
  }) {
    setDialog(d);
  }
  function closeDialog() {
    setDialog({ mode: null, item: null });
  }

  // ==== 親ハンドラ（KanbanCard へ渡す） ====
  function requestPack(item: PackingItem) {
    const origin = findColumnOf(makeId(item), columns) || "manufactured";
    openDialog({
      mode: "pack",
      item,
      origin,
      onSubmit: (p) => doPack(item, p as any),
    });
  }
  function requestShip(item: PackingItem) {
    const origin = findColumnOf(makeId(item), columns) || "manufactured";
    openDialog({
      mode: "ship",
      item,
      origin,
      onSubmit: (p) => doShip(item, p as any),
    });
  }
  function requestMove(item: PackingItem) {
    const origin = findColumnOf(makeId(item), columns) || "stock";
    openDialog({
      mode: "move",
      item,
      origin,
      onSubmit: async (p) => {
        const to = normalizeLocation(p.location || "");
        if (!to.label) return;
        const cur = Math.max(
          0,
          parseInt(item.packingInfo.quantity || "0", 10) || 0,
        );
        const { remain, move } = computeSplit(cur, p.quantity || cur);
        const movedQty = Math.max(1, Math.min(p.quantity || cur, cur));
        const rid = genRequestId();
        try {
          const from = normalizeLocation(item.packingInfo.location || "");
          await updatePacking({
            action: "move",
            rowIndex: item.rowIndex,
            packingData: {
              quantity: movedQty,
              location: to.label,
              from: from.label,
              to: to.label,
            },
            log: {
              when: new Date().toISOString(),
              shipType: "",
              user: "",
              fromLocation: from.label,
              toLocation: to.label,
            },
            requestId: rid,
          });
          if (move === cur) {
            const { beforeId, afterId, updated } = computeAfterMove(
              item,
              to.label,
            );
            setCards((prev) => {
              const n = { ...prev };
              delete n[beforeId];
              n[afterId] = updated;
              return n;
            });
            setColumns((prev) => ({
              ...prev,
              stock: prev.stock.map((id) => (id === beforeId ? afterId : id)),
            }));
          } else {
            const beforeId = makeId(item);
            const updatedOrigin: PackingItem = {
              ...item,
              packingInfo: { ...item.packingInfo, quantity: String(remain) },
              stockQty: remain,
            };
            const moved: PackingItem = {
              ...item,
              packingInfo: {
                ...item.packingInfo,
                location: to.label,
                quantity: String(move),
              },
              stockQty: move,
            };
            const newId = makeId(moved);
            setCards((prev) => ({
              ...prev,
              [beforeId]: updatedOrigin,
              [newId]: moved,
            }));
            setColumns((prev) => ({ ...prev, stock: [...prev.stock, newId] }));
          }
          await fetchData();
          closeDialog();
        } catch (err) {
          const msg = (err as Error).message;
          if (msg !== NETWORK_ERROR_MESSAGE) toast(msg);
        }
      },
    });
  }

  async function requestRestoreFromShipped(item: PackingItem) {
    const qtyStr = prompt("在庫へ戻す数量", "1");
    const q = Math.max(1, parseInt(qtyStr || "0", 10) || 0);
    const locRaw = prompt("戻す保管場所", item.packingInfo.location || "");
    const loc = normalizeLocation(locRaw || "");
    if (!loc.label) return;
    const before = makeId(item);
    const updated: PackingItem = computeRestoredItem(item, loc.label, q);
    const after = makeId(updated);
    setCards((prev) => {
      const n = { ...prev };
      delete n[before];
      n[after] = updated;
      return n;
    });
    setColumns((prev) => ({
      ...prev,
      shipped: prev.shipped.filter((id) => id !== before),
      stock: prev.stock.includes(after) ? prev.stock : [...prev.stock, after],
    }));
    try {
      const rid = genRequestId();
      await updatePacking({
        action: "restore",
        rowIndex: item.rowIndex,
        packingData: { quantity: q, location: loc.label, to: loc.label },
        log: {
          when: new Date().toISOString(),
          shipType: "",
          user: "",
          fromLocation: "",
          toLocation: loc.label,
        },
        requestId: rid,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== NETWORK_ERROR_MESSAGE) toast(msg);
    }
  }

  function restoreFromArchive(a: PackingItem) {
    // ダイアログで入力させる
    setRestoreTarget(a);
  }

  async function doRestoreFromArchive(
    a: PackingItem,
    payload: { location?: string; quantity?: number },
  ) {
    const loc = normalizeLocation(payload.location || "");
    if (!loc.label) return;
    const qty = Math.max(1, Math.min(a.quantity, payload.quantity || a.quantity));
    const rid = genRequestId();

    // 後処理（モーダルを閉じ、対象カードへスクロール＆一時ハイライト）
    const finish = (targetId: string) => {
      setArchiveOpen(false);
      setRestoreTarget(null);
      setTimeout(() => {
        const el = document.getElementById(`card-${targetId}`);
        if (el) {
          el.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
          });
          setHighlightId(targetId);
          setTimeout(() => setHighlightId(null), 1200);
        }
      }, 0);
    };

    // 既存在庫（同 rowIndex & 同ロケーション）があるか
    const existingId = Object.keys(cards).find((id) => {
      const it = cards[id];
      return (
        it &&
        it.rowIndex === a.rowIndex &&
        (it.packingInfo.location || "") === loc.label &&
        columns.stock.includes(id)
      );
    });

    if (existingId) {
      const current = cards[existingId];
      const curQty = Math.max(
        0,
        parseInt(current.packingInfo.quantity || "0", 10) || 0,
      );
      const nextQty = curQty + qty;
      const updated: PackingItem = {
        ...current,
        packingInfo: { ...current.packingInfo, quantity: String(nextQty) },
        stockQty: nextQty,
      };
      setCards((prev) => ({ ...prev, [existingId]: updated }));
      setColumns((prev) => ({
        ...prev,
        shipped: prev.shipped.filter(
          (id) => (cards[id]?.rowIndex ?? -1) !== a.rowIndex,
        ),
      }));
      try {
        await updatePacking({
          action: "restore",
          rowIndex: a.rowIndex,
          packingData: { quantity: qty, location: loc.label, to: loc.label },
          log: {
            when: new Date().toISOString(),
            shipType: "",
            user: "",
            fromLocation: "",
            toLocation: loc.label,
          },
          requestId: rid,
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg !== NETWORK_ERROR_MESSAGE) toast(msg);
      }
      finish(existingId);
      return;
    }

    // 新規在庫カードとして追加
    const updated = computeRestoredItem(a, loc.label, qty);
    const newId = makeId(updated);
    setCards((prev) => ({ ...prev, [newId]: updated }));
    setColumns((prev) => {
      const shippedIds = prev.shipped.filter(
        (id) => (cards[id]?.rowIndex ?? -1) !== a.rowIndex,
      );
      const nextStock = prev.stock.includes(newId)
        ? prev.stock
        : [...prev.stock, newId];
      return { ...prev, shipped: shippedIds, stock: nextStock };
    });
    try {
      await updatePacking({
        action: "restore",
        rowIndex: a.rowIndex,
        packingData: { quantity: qty, location: loc.label, to: loc.label },
        log: {
          when: new Date().toISOString(),
          shipType: "",
          user: "",
          fromLocation: "",
          toLocation: loc.label,
        },
        requestId: rid,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== NETWORK_ERROR_MESSAGE) toast(msg);
    }
    finish(newId);
  }

  // ==== 操作実装 ====

  async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const delays = [300, 600, 1200];
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(res.statusText);
        return res;
      } catch (e) {
        clearTimeout(timer);
        if (i < 2) {
          await new Promise((r) => setTimeout(r, delays[i]));
        } else {
          alert(NETWORK_ERROR_MESSAGE);
          throw new Error(NETWORK_ERROR_MESSAGE);
        }
      }
    }
    throw new Error(NETWORK_ERROR_MESSAGE);
  }

  async function updatePacking(payload: {
    action: Action;
    rowIndex: number;
    packingData: Record<string, any>;
    log: {
      when: string;
      shipType?: string;
      user?: string;
      fromLocation?: string;
      toLocation?: string;
    };
    requestId: string;
  }) {
    if (
      env === "prod" &&
      typeof window !== "undefined" &&
      !prodConfirmed.current
    ) {
      if (localStorage.getItem("skipProdConfirm") !== "1") {
        const ok = window.confirm("本番に書き込みます。よろしいですか？");
        if (!ok) throw new Error("cancelled");
        if (window.confirm("次回から表示しない")) {
          localStorage.setItem("skipProdConfirm", "1");
        }
      }
      prodConfirmed.current = true;
    }
    const res = await fetchWithRetry(
      `${API_ENDPOINTS.UPDATE_PACKING}?env=${env}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const j = await res.json().catch(() => null);
    if (!j?.success) {
      throw new Error(j?.error || res.statusText);
    }
  }

  async function doPack(
    item: PackingItem,
    payload: { location?: string; quantity?: number },
  ) {
    const key = `${item.rowIndex}:pack`;
    if (inflightRef.current.has(key)) return;
    inflightRef.current.add(key);
    const rid = genRequestId();
    try {
      const loc = normalizeLocation(payload.location || "");
      await updatePacking({
        action: "pack",
        rowIndex: item.rowIndex,
        packingData: {
          quantity: payload.quantity || 1,
          location: loc.label,
        },
        log: {
          when: new Date().toISOString(),
          shipType: "",
          user: "",
          fromLocation: "",
          toLocation: loc.label,
        },
        requestId: rid,
      });
      await fetchData();
      closeDialog();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== NETWORK_ERROR_MESSAGE) toast(msg);
    } finally {
      inflightRef.current.delete(key);
    }
  }

  async function doShip(
    item: PackingItem,
    payload: { location?: string; quantity?: number; shipType?: ShipType },
  ) {
    const key = `${item.rowIndex}:ship`;
    if (inflightRef.current.has(key)) return;
    inflightRef.current.add(key);
    const rid = genRequestId();
    try {
      const to = normalizeLocation(payload.location || "");
      const from = normalizeLocation(item.packingInfo.location || "");
      await updatePacking({
        action: "ship",
        rowIndex: item.rowIndex,
        packingData: {
          quantity: payload.quantity || 1,
          location: to.label,
          from: from.label,
          to: to.label,
        },
        log: {
          when: new Date().toISOString(),
          shipType: payload.shipType || "",
          user: "",
          fromLocation: from.label,
          toLocation: to.label,
        },
        requestId: rid,
      });
      await fetchData();
      closeDialog();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== NETWORK_ERROR_MESSAGE) toast(msg);
    } finally {
      inflightRef.current.delete(key);
    }
  }

  // ==== ユーティリティ ====
  function genRequestId() {
    try {
      const v = (globalThis as any)?.crypto?.randomUUID?.();
      return v || Math.random().toString(36).slice(2);
    } catch {
      return Math.random().toString(36).slice(2);
    }
  }
  function moveCardEx(
    oldId: string,
    from: KanbanStatusId,
    to: KanbanStatusId,
    newId?: string,
  ) {
    setColumns((prev) => {
      const src = prev[from].filter((id) => id !== oldId);
      const dst = [...prev[to], newId || oldId];
      return { ...prev, [from]: src, [to]: dst };
    });
  }
function makeId(item: PackingItem) {
  const tag =
    (item.packingInfo?.location || "").trim() || item.status || "-";
  return `${item.rowIndex}_${tag}`;
}

  function findColumnOf(
    cardId: string,
    cols: Record<KanbanStatusId, string[]>,
  ) {
    for (const k of Object.keys(cols) as KanbanStatusId[]) {
      if (cols[k].includes(cardId)) return k;
    }
    return undefined as unknown as KanbanStatusId | undefined;
  }
  function computeAfterMove(item: PackingItem, newLocation: string) {
    const beforeId = makeId(item);
    const updated: PackingItem = {
      ...item,
      packingInfo: { ...item.packingInfo, location: newLocation },
    };
    const afterId = makeId(updated);
    return { beforeId, afterId, updated };
  }

  // ==== スモークテスト（UIに影響しない簡易チェック） ====
  useEffect(() => {
    try {
      const mock = buildMockData(today)[0];
      const id0 = makeId(mock);
      console.assert(
        typeof id0 === "string" && id0.startsWith(String(mock.rowIndex)),
        "[TEST] makeId basic",
      );
      const { beforeId, afterId } = computeAfterMove(mock, "テスト棚");
      console.assert(
        beforeId !== afterId,
        "[TEST] computeAfterMove id changes",
      );
      const restored = computeRestoredItem(mock, "棚A", 10);
      const id1 = makeId(restored);
      console.assert(
        id1 !== id0 &&
          restored.status === "完了" &&
          restored.packingInfo.quantity === "10",
        "[TEST] restore logic",
      );
      const sp = computeSplit(20, 10);
      console.assert(
        sp.remain === 10 && sp.move === 10,
        "[TEST] split 20->10/10",
      );
      const md = buildMockData(today);
      console.assert(
        Array.isArray(md) && md.length === 3 && md[2].rowIndex === 1647,
        "[TEST] mock data closed array",
      );
      console.assert(
        locationOptions.length > 0,
        "[TEST] storage options ready",
      );
      const item2 = md[1];
      console.assert(
        item2.status === "完了" && !!item2.packingInfo.location,
        "[TEST] stock item has location",
      );
      console.log("[TEST] smoke OK");
    } catch (e) {
      console.warn("[TEST] smoke failed", e);
    }
  }, [today]);

  // ==== レイアウト ====
  const headerTitle = "梱包・出荷 一体型ボード（試作 v2.20）";
  const currentDialog = dialog;
  const currentItem = dialog.item as PackingItem | undefined;
  const origin = dialog.origin as KanbanStatusId | undefined;
  const computedMaxQty = currentItem
    ? currentDialog.mode === "ship"
      ? origin === "manufactured"
        ? currentItem.quantity
        : Math.max(
            1,
            parseInt(currentItem.packingInfo.quantity || "0", 10) ||
              currentItem.quantity,
          )
      : currentDialog.mode === "move"
        ? Math.max(
            1,
            parseInt(currentItem.packingInfo.quantity || "0", 10) || 1,
          )
        : currentItem.quantity
    : 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-purple-800 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-800 flex items-center gap-4">
              <span className="text-5xl">📦</span>
              {headerTitle}
            </h1>
            <div className="flex items-center gap-3">
              <EnvBadge
                env={env}
                label={meta?.env?.label || (env === "prod" ? "本番" : "テスト")}
                baseUrl={gasUrl}
                onToggle={() => setEnv(env === "prod" ? "test" : "prod")}
              />
              <button
                onClick={openArchiveModal}
                className="hidden md:inline-flex px-4 py-2 rounded-full border-2 border-purple-600 text-purple-700 hover:bg-purple-50"
              >
                アーカイブ
              </button>
            </div>
          </div>

          {/* フィルター */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                製造日
              </label>
              <input
                type="date"
                value={filters.date}
                onChange={(e) =>
                  setFilters({ ...filters, date: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                味付け種類
              </label>
              <input
                type="text"
                placeholder="味付け種類で検索"
                value={filters.product}
                onChange={(e) =>
                  setFilters({ ...filters, product: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ステータス
              </label>
              <select
                value={filters.status}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    status: e.target.value as Filters["status"],
                  })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">すべて</option>
                <option value="manufactured">製造済み</option>
                <option value="stock">梱包済み（在庫）</option>
                <option value="shipped">出荷済み</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                数量範囲
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="最小"
                  value={filters.quantityMin}
                  onChange={(e) =>
                    setFilters({ ...filters, quantityMin: e.target.value })
                  }
                  className="w-1/2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                <input
                  type="number"
                  placeholder="最大"
                  value={filters.quantityMax}
                  onChange={(e) =>
                    setFilters({ ...filters, quantityMax: e.target.value })
                  }
                  className="w-1/2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <button
                onClick={() => fetchData()}
                className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
              >
                フィルター
              </button>
              <button
                onClick={() => {
                  const next: Filters = {
                    date: today,
                    product: "",
                    status: "",
                    quantityMin: "",
                    quantityMax: "",
                  };
                  setFilters(next);
                  fetchData(next);
                }}
                className="flex-1 bg-gray-400 text-white px-4 py-2 rounded-lg hover:bg-gray-500 transition-colors"
              >
                リセット
              </button>
            </div>
          </div>
        </div>

        {/* ボード */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 rounded-xl p-4">{error}</div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div
              className="grid grid-cols-1 md:grid-cols-3 gap-4"
              style={{ gridAutoFlow: "column", overflowX: "auto" }}
            >
              {K_STATUSES.map((col) => (
                <KanbanColumn
                  key={col.id}
                  id={col.id as KanbanStatusId}
                  title={col.label}
                  hint={col.hint}
                  cardIds={columns[col.id as KanbanStatusId]}
                  allCards={cards}
                  highlightId={highlightId}
                  pagination={meta?.pagination?.[col.id as KanbanStatusId]}
                  onPageChange={(p) => fetchData(undefined, { [col.id]: p })}
                  backlogCount={
                    col.id === "manufactured" ? meta?.backlog?.count || 0 : 0
                  }
                  onShowBacklog={
                    col.id === "manufactured"
                      ? () => {
                          setBacklogOpen(true);
                          fetchBacklog(1);
                        }
                      : undefined
                  }
                  onOpenArchive={openArchiveModal}
                  onRequestPack={requestPack}
                  onRequestShip={requestShip}
                  onRequestMove={requestMove}
                  onRequestRestore={requestRestoreFromShipped}
                />
              ))}
            </div>
          </DndContext>
        )}

        {/* 操作ダイアログ */}
        {currentDialog.mode && currentItem && (
          <SimpleDialog
            onClose={closeDialog}
            title={
              currentDialog.mode === "pack"
                ? "梱包（在庫へ移動）"
                : currentDialog.mode === "move"
                  ? "在庫移動"
                  : "出荷登録"
            }
          >
            <ActionForm
              mode={currentDialog.mode}
              origin={origin}
              defaultLocation={currentItem.packingInfo.location || ""}
              maxQuantity={computedMaxQty}
              useSelectLocation={currentDialog.mode !== "ship"}
              showLocation={currentDialog.mode !== "ship" || origin === "stock"}
              showQuantity={true}
              locationOptions={locationOptions}
              shipTypeOptions={["ロジカム出荷", "羽野出荷"]}
              onCancel={closeDialog}
              onSubmit={(payload) => currentDialog.onSubmit?.(payload)}
            />
          </SimpleDialog>
        )}

        {/* 復帰ダイアログ（アーカイブ→在庫） */}
        {restoreTarget && (
          <SimpleDialog
            title="出荷アーカイブから在庫へ戻す"
            onClose={() => setRestoreTarget(null)}
          >
            <ActionForm
              mode="pack"
              defaultLocation={restoreTarget.packingInfo.location || ""}
              maxQuantity={restoreTarget.quantity}
              useSelectLocation={true}
              showLocation={true}
              showQuantity={true}
              locationOptions={locationOptions}
              shipTypeOptions={["ロジカム出荷", "羽野出荷"]}
              onCancel={() => setRestoreTarget(null)}
              onSubmit={async (p) => {
                doRestoreFromArchive(restoreTarget, p);
                setRestoreTarget(null);
              }}
            />
          </SimpleDialog>
        )}

        {/* 未梱包モーダル */}
        {backlogOpen && (
          <SimpleDialog
            title="未梱包一覧"
            onClose={() => setBacklogOpen(false)}
            headerRight={
              <Pager
                page={backlogPagination.page}
                totalPages={backlogPagination.totalPages}
                onChange={(p) => fetchBacklog(p)}
              />
            }
            bodyClassName="max-h-[36rem] overflow-y-auto"
          >
            {backlogLoading ? (
              <Loading />
            ) : (
              <div className="space-y-4">
                <DndContext sensors={[]}>
                  <SortableContext
                    items={backlogItems.map((it) => makeId(it))}
                    strategy={rectSortingStrategy}
                  >
                    <div className="space-y-4">
                      {backlogItems.map((it) => (
                        <KanbanCard
                          key={makeId(it)}
                          id={makeId(it)}
                          item={it}
                          columnId="manufactured"
                          highlightId={null}
                          onRequestPack={requestPack}
                          onRequestShip={requestShip}
                          onRequestMove={requestMove}
                          onRequestRestore={() => {}}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <Pager
                  page={backlogPagination.page}
                  totalPages={backlogPagination.totalPages}
                  onChange={(p) => fetchBacklog(p)}
                />
              </div>
            )}
          </SimpleDialog>
        )}

        {/* アーカイブモーダル */}
        {archiveOpen && (
          <SimpleDialog
            title="アーカイブ"
            onClose={() => setArchiveOpen(false)}
            headerRight={
              archiveYear && archiveMonth && archiveDay ? (
                <Pager
                  page={archivePagination.page}
                  totalPages={archivePagination.totalPages}
                  onChange={(p) =>
                    fetchArchive({
                      year: archiveYear,
                      month: archiveMonth,
                      day: archiveDay,
                      page: p,
                    })
                  }
                />
              ) : null
            }
            bodyClassName="max-h-[80vh] min-h-[40vh] overflow-y-auto"
          >
            <div className="space-y-4">
              <div className="flex gap-2">
                <select
                  value={archiveYear ?? ""}
                  onChange={(e) => {
                    const y = e.target.value ? Number(e.target.value) : null;
                    setArchiveYear(y);
                    setArchiveMonth(null);
                    setArchiveDay(null);
                    fetchArchive({ year: y });
                  }}
                  className="border px-2 py-1 rounded"
                >
                  <option value="">年</option>
                  {archiveYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  value={archiveMonth ?? ""}
                  onChange={(e) => {
                    const m = e.target.value ? Number(e.target.value) : null;
                    setArchiveMonth(m);
                    setArchiveDay(null);
                    if (archiveYear) fetchArchive({ year: archiveYear, month: m });
                  }}
                  disabled={!archiveYear}
                  className="border px-2 py-1 rounded"
                >
                  <option value="">月</option>
                  {archiveMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={archiveDay ?? ""}
                  onChange={(e) => {
                    const d = e.target.value ? Number(e.target.value) : null;
                    setArchiveDay(d);
                    if (archiveYear && archiveMonth && d)
                      fetchArchive({ year: archiveYear, month: archiveMonth, day: d });
                  }}
                  disabled={!archiveMonth}
                  className="border px-2 py-1 rounded"
                >
                  <option value="">日</option>
                  {archiveDays.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {archiveLoading ? (
                <Loading />
              ) : (
                archiveYear &&
                archiveMonth &&
                archiveDay && (
                  <>
                    <DndContext sensors={[]}>
                      <SortableContext
                        items={archiveItems.map((it) => makeId(it))}
                        strategy={rectSortingStrategy}
                      >
                        <div className="space-y-4">
                          {archiveItems.map((it) => (
                            <KanbanCard
                              key={makeId(it)}
                              id={makeId(it)}
                              item={it}
                              columnId="shipped"
                              highlightId={null}
                              onRequestPack={() => {}}
                              onRequestShip={() => {}}
                              onRequestMove={() => {}}
                              onRequestRestore={restoreFromArchive}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    <Pager
                      page={archivePagination.page}
                      totalPages={archivePagination.totalPages}
                      onChange={(p) =>
                        fetchArchive({
                          year: archiveYear,
                          month: archiveMonth,
                          day: archiveDay,
                          page: p,
                        })
                      }
                    />
                  </>
                )
              )}
            </div>
          </SimpleDialog>
        )}
      </div>
      </div>
  );
};

export default function UnifiedKanbanPrototypeV2() {
  return (
    <Suspense fallback={null}>
      <UnifiedKanbanImpl />
    </Suspense>
  );
}

// ===== Kanban Column =====
function KanbanColumn({
  id,
  title,
  hint,
  cardIds,
  allCards,
  highlightId,
  pagination,
  onPageChange,
  backlogCount,
  onShowBacklog,
  onOpenArchive,
  onRequestPack,
  onRequestShip,
  onRequestMove,
  onRequestRestore,
}: {
  id: KanbanStatusId;
  title: string;
  hint?: string;
  cardIds: string[];
  allCards: Record<string, PackingItem>;
  highlightId: string | null;
  pagination?: { total: number; page: number; pageSize: number; totalPages: number };
  onPageChange?: (p: number) => void;
  backlogCount?: number;
  onShowBacklog?: () => void;
  onOpenArchive: () => void;
  onRequestPack: (item: PackingItem) => void;
  onRequestShip: (item: PackingItem) => void;
  onRequestMove: (item: PackingItem) => void;
  onRequestRestore: (item: PackingItem) => void;
}) {
  return (
    <div className="bg-white/95 rounded-2xl shadow-xl p-4 min-h-[60vh] flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-extrabold text-gray-800">{title}</h2>
          {hint && <span className="text-xs text-gray-500">{hint}</span>}
          {id === "manufactured" && (backlogCount || 0) > 0 && (
            <button
              onClick={onShowBacklog}
              className="ml-2 bg-red-600 text-white text-xs px-2 rounded-full"
            >
              未梱包ｱﾘ
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{cardIds.length} 件</span>
          {id === "shipped" && (
            <button
              onClick={onOpenArchive}
              className="px-3 py-1.5 rounded-full border-2 border-purple-600 text-purple-700 hover:bg-purple-50 text-xs"
            >
              アーカイブ
            </button>
          )}
        </div>
      </div>
      {pagination && onPageChange && (
        <Pager
          page={pagination.page}
          totalPages={pagination.totalPages}
          onChange={onPageChange}
        />
      )}
      <SortableContext items={cardIds} strategy={rectSortingStrategy}>
        <div id={id} className="space-y-3 min-h-[50vh]" data-droppable>
          {cardIds.length === 0 && (
            <div className="h-32 grid place-items-center border-2 border-dashed rounded-xl text-gray-400">
              ここにカードをドラッグ
            </div>
          )}
          {cardIds.map((cid) => (
            <KanbanCard
              key={cid}
              id={cid}
              item={allCards[cid]}
              columnId={id}
              highlightId={highlightId}
              onRequestPack={onRequestPack}
              onRequestShip={onRequestShip}
              onRequestMove={onRequestMove}
              onRequestRestore={onRequestRestore}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

// ===== Kanban Card =====
function KanbanCard({
  id,
  item,
  columnId,
  highlightId,
  onRequestPack,
  onRequestShip,
  onRequestMove,
  onRequestRestore,
}: {
  id: string;
  item: PackingItem;
  columnId: KanbanStatusId;
  highlightId: string | null;
  onRequestPack: (item: PackingItem) => void;
  onRequestShip: (item: PackingItem) => void;
  onRequestMove: (item: PackingItem) => void;
  onRequestRestore: (item: PackingItem) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : 1,
  };

  return (
    <div
      id={`card-${id}`}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-gray-50 rounded-xl border-2 border-slate-300 shadow-sm p-4 hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
        highlightId === id ? "ring-4 ring-amber-400 animate-pulse" : ""
      }`}
    >
      {/* 情報行：2カラム混在（ご要望版） */}
      <div className="space-y-2 text-sm">
        {/* 1行目：味付け種類 / 製造日 */}
        <div className="grid grid-cols-2 gap-3">
          <Field k="味付け種類" v={item.seasoningType || "-"} />
          <Field k="製造日" v={item.manufactureDate || "-"} />
        </div>

        {/* 2行目：魚種 / 産地 */}
        <div className="grid grid-cols-2 gap-3">
          <Field k="魚種" v={item.fishType || "-"} />
          <Field k="産地" v={item.origin || "-"} />
        </div>

        {/* 3行目：数量 / 製造商品 */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            k="数量"
            v={`${columnId === "stock" ? item.stockQty ?? item.quantity : item.quantity} 個`}
          />
          <Field k="製造商品" v={item.manufactureProduct || "-"} />
        </div>
          {/* 4行目：梱包日 / 出荷日 */}
          {columnId === "stock" && <Field k="梱包日" v={item.packDate || "-"} />}
          {columnId === "shipped" && <Field k="出荷日" v={item.shipDate || "-"} />}

          {/* 5行目：保管場所 / 出荷先 */}
          {columnId === "stock" && (
            <Field k="保管場所" v={item.packingInfo.location || "-"} />
          )}
          {columnId === "shipped" && (
            <Field
              k="出荷先"
              v={
                <span
                  className={
                    item.shipType === "羽野出荷"
                      ? "text-sky-600"
                      : item.shipType === "ロジカム出荷"
                        ? "text-pink-600"
                        : "text-gray-600"
                  }
                >
                  {item.shipType || "-"}
                </span>
              }
            />
          )}
      </div>

      {/* アクション */}
      <div className="flex flex-wrap gap-2 mt-3">
        {columnId === "manufactured" && (
          <>
            <ButtonLine onClick={() => onRequestPack(item)}>梱包</ButtonLine>
            <ButtonLine onClick={() => onRequestShip(item)}>出荷</ButtonLine>
          </>
        )}
        {columnId === "stock" && (
          <>
            <ButtonLine onClick={() => onRequestShip(item)}>出荷</ButtonLine>
            <ButtonLine onClick={() => onRequestMove(item)}>移動</ButtonLine>
          </>
        )}
        {columnId === "shipped" && (
          <ButtonLine onClick={() => onRequestRestore(item)}>
            在庫へ戻す
          </ButtonLine>
        )}
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span
        className={`inline-flex h-6 items-center px-2 rounded bg-gray-600 text-white text-xs font-bold mb-1 ${LABEL_WIDTH}`}
      >
        {k}
      </span>
      <span className="font-bold text-gray-900 break-words leading-tight">
        {v}
      </span>
    </div>
  );
}

function ButtonLine({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full border-2 border-purple-600 text-purple-700 hover:bg-purple-50 text-xs"
    >
      {children}
    </button>
  );
}

function Loading() {
  return (
    <div className="py-10 flex items-center justify-center text-gray-600">
      <div className="h-5 w-5 mr-2 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      データ読み込み中…
    </div>
  );
}

// ===== ダイアログ & フォーム =====
function SimpleDialog({
  title,
  children,
  onClose,
  headerRight,
  bodyClassName,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  headerRight?: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              className="px-2 py-1 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </div>
        </div>
        <div className={`p-5 ${bodyClassName || ''}`}>{children}</div>
      </div>
    </div>
  );
}

function ActionForm({
  mode,
  origin,
  defaultLocation,
  maxQuantity,
  onSubmit,
  onCancel,
  showLocation,
  showQuantity,
  useSelectLocation,
  locationOptions,
  shipTypeOptions,
}: {
  mode: "pack" | "ship" | "move";
  origin?: KanbanStatusId;
  defaultLocation?: string;
  maxQuantity: number;
  onSubmit: (p: {
    location?: string;
    quantity?: number;
    shipType?: ShipType;
  }) => Promise<void> | void;
  onCancel: () => void;
  showLocation: boolean;
  showQuantity: boolean;
  useSelectLocation: boolean;
  locationOptions: string[];
  shipTypeOptions: ShipType[];
}) {
  const [location, setLocation] = useState(defaultLocation || "");
  const [quantity, setQuantity] = useState(1);
  const [shipType, setShipType] = useState<ShipType>("ロジカム出荷");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting) return; // 二重送信防止
        if (showLocation && !location) return;
        if (showQuantity && quantity <= 0) return;
        try {
          setSubmitting(true);
          await onSubmit({
            location: showLocation ? location : undefined,
            quantity: showQuantity ? quantity : undefined,
            shipType,
          });
        } finally {
          setSubmitting(false);
        }
      }}
      className="space-y-4"
    >
      {showLocation && (
        <div>
          <label className="block text-sm font-medium mb-1">
            {mode === "pack" || mode === "move"
              ? "保管場所"
              : "出荷元ロケーション"}
          </label>
          {useSelectLocation ? (
            <select
              value={location}
              disabled={submitting}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="">選択してください</option>
              {locationOptions.map((opt) => {
                const { label } = normalizeLocation(opt);
                return (
                  <option key={label} value={label}>
                    {label}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              value={location}
              disabled={submitting}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例: パレット①"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          )}
        </div>
      )}

      {showQuantity && (
        <div>
          <label className="block text-sm font-medium mb-1">
            数量（最大 {maxQuantity}）
          </label>
          <input
            type="number"
            min={1}
            max={Math.max(1, maxQuantity)}
            value={quantity}
            disabled={submitting}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          />
        </div>
      )}

      {mode === "ship" && (
        <div>
          <label className="block text-sm font-medium mb-1">出荷タイプ</label>
          <select
            value={shipType}
            disabled={submitting}
            onChange={(e) => setShipType(e.target.value as ShipType)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            {shipTypeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 rounded-lg border"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
        >
          {submitting
            ? "処理中…"
            : mode === "pack"
              ? "在庫へ移動"
              : mode === "move"
                ? "移動する"
                : "出荷を登録"}
        </button>
      </div>
    </form>
  );
}

