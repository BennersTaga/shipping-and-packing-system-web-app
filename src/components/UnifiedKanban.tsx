'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
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
};

type ShipType = "ロジカム出荷" | "羽野出荷";

type ArchiveItem = {
  id: string; // cardId + ts
  base: PackingItem;
  ship: { type: ShipType; quantity: number; date: string };
};

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

function normalizeLocation(raw: string) {
  const circled: Record<string, string> = {
    "①": "1","②": "2","③": "3","④": "4","⑤": "5",
    "⑥": "6","⑦": "7","⑧": "8","⑨": "9","⑩": "10",
  };
  let v = String(raw || "")
    .trim()
    .normalize("NFKC")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (m) => circled[m])
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/（[^）]*）/g, "")
    .replace(/\s+/g, "");
  if (/^パレット(\d+)/.test(v)) {
    const n = RegExp.$1;
    return { key: `palet${n}`, label: `パレット${n}` };
  }
  if (v.startsWith("仮置き")) {
    return { key: "kariokipalet", label: "仮置きパレット" };
  }
  return {
    key: v
      .toLowerCase()
      .replace(/パレット/g, "palet")
      .replace(/仮置き/g, "karioki"),
    label: v,
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
    },
  ];
}

// ===== メイン =====
export default function UnifiedKanbanPrototypeV2() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const inflightRef = useRef<Set<string>>(new Set()); // 多重送信ガード

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

  const [hasShipped, setHasShipped] = useState(false);

  // 出荷アーカイブ
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<ArchiveItem | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // ==== データ取得 ====
  async function fetchData(override?: Partial<Filters>) {
    setLoading(true);
    setError(null);
    try {
      const f = { ...filters, ...override };

      // 既存 API の status は "未処理"/"完了" なのでマッピング
      const legacyStatusMap: Record<string, string> = {
        manufactured: "未処理",
        stock: "完了",
      };

      const params = new URLSearchParams();
      if (f.date) params.append("date", f.date);
      if (f.product) params.append("product", f.product);
      if (f.status && legacyStatusMap[f.status])
        params.append("status", legacyStatusMap[f.status]);
      if (f.quantityMin) params.append("quantityMin", f.quantityMin);
      if (f.quantityMax) params.append("quantityMax", f.quantityMax);

      let data: PackingItem[] | null = null;
      let archives: ArchiveItem[] = [];
      let masters: string[] = [];
      try {
        const res = await fetch(
          `${API_ENDPOINTS.SEARCH_PACKING}?${params.toString()}`,
          { cache: "no-store" },
        );
        const j = await res.json();
        if (j?.success) {
          data = (j.data as PackingItem[]) || [];
          archives = (j.archive as ArchiveItem[]) || [];
          masters = Array.isArray(j.masters?.locations)
            ? (j.masters.locations as string[])
            : masters;
        } else {
          throw new Error(j?.error || "検索に失敗しました");
        }
      } catch {
        data = buildMockData(f.date);
      }

      const locMap = new Map<string, string>();
      for (const raw of masters.length ? masters : STORAGE_OPTIONS) {
        const { key, label } = normalizeLocation(raw);
        if (!locMap.has(key)) locMap.set(key, label);
      }
      setLocationOptions(Array.from(locMap.values()));

      const processed: PackingItem[] = [];
      const stockGroups = new Map<string, PackingItem>();
      for (const it of data || []) {
        if (it.status === "完了") {
          const stockQty =
            Number(it.packingInfo?.quantity ?? it.quantity ?? 0) || 0;
          const loc = normalizeLocation(it.packingInfo?.location || "");
          const key = `${it.rowIndex}|${loc.key}`;
          const g = stockGroups.get(key);
          if (g) {
            g.stockQty = (g.stockQty || 0) + stockQty;
            g.packingInfo.quantity = String(g.stockQty);
          } else {
            stockGroups.set(key, {
              ...it,
              packingInfo: {
                ...it.packingInfo,
                location: loc.label,
                quantity: String(stockQty),
              },
              stockQty,
            });
          }
        } else {
          processed.push(it);
        }
      }
      processed.push(...Array.from(stockGroups.values()));

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
      setHasShipped(col.shipped.length > 0);
      setArchive(archives);
    } catch (e: any) {
      setError(e.message || "読み込みエラー");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData({ date: today });
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const to = normalizeLocation(p.location || "").label;
        if (!to) return;
        const cur = Math.max(
          0,
          parseInt(item.packingInfo.quantity || "0", 10) || 0,
        );
        const { remain, move } = computeSplit(cur, p.quantity || cur);
        const movedQty = Math.max(1, Math.min(p.quantity || cur, cur));
        const rid = genRequestId();
        if (move === cur) {
          // 全量移動（IDも更新）
          const { beforeId, afterId, updated } = computeAfterMove(item, to);
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
          // 分割：元を減算し、新カードを追加
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
              location: to,
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
        closeDialog();
        // ログ送信（必須：from/to/quantity + requestId）
        try {
          await updatePacking({
            action: "move",
            rowIndex: item.rowIndex,
            packingData: {
              quantity: movedQty,
              location: to,
              from: item.packingInfo.location,
              to,
            },
            log: {
              when: new Date().toISOString(),
              shipType: "",
              user: "",
              fromLocation: item.packingInfo.location,
              toLocation: to,
            },
            requestId: rid,
          });
        } catch (err) {
          toast((err as Error).message);
        }
      },
    });
  }

  async function requestRestoreFromShipped(item: PackingItem) {
    const qtyStr = prompt("在庫へ戻す数量", "1");
    const q = Math.max(1, parseInt(qtyStr || "0", 10) || 0);
    const loc = prompt("戻す保管場所", item.packingInfo.location || "");
    if (!loc) return;
    const before = makeId(item);
    const updated: PackingItem = computeRestoredItem(item, loc, q);
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
        packingData: { quantity: q, location: loc, to: loc },
        log: {
          when: new Date().toISOString(),
          shipType: "",
          user: "",
          fromLocation: "",
          toLocation: loc,
        },
        requestId: rid,
      });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function restoreFromArchive(a: ArchiveItem) {
    // ダイアログで入力させる
    setRestoreTarget(a);
  }

  async function doRestoreFromArchive(
    a: ArchiveItem,
    payload: { location?: string; quantity?: number },
  ) {
    const loc = (payload.location || "").trim();
    if (!loc) return;
    const qty = Math.max(
      1,
      Math.min(a.ship.quantity, payload.quantity || a.ship.quantity),
    );
    const rid = genRequestId();

    // 後処理（ドロワーを閉じ、対象カードへスクロール＆一時ハイライト）
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
        it.rowIndex === a.base.rowIndex &&
        (it.packingInfo.location || "") === loc &&
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
          (id) => (cards[id]?.rowIndex ?? -1) !== a.base.rowIndex,
        ),
      }));
      try {
        await updatePacking({
          action: "restore",
          rowIndex: a.base.rowIndex,
          packingData: { quantity: qty, location: loc, to: loc },
          log: {
            when: new Date().toISOString(),
            shipType: "",
            user: "",
            fromLocation: "",
            toLocation: loc,
          },
          requestId: rid,
        });
      } catch (err) {
        toast((err as Error).message);
      }
      finish(existingId);
      return;
    }

    // 新規在庫カードとして追加
    const updated = computeRestoredItem(a.base, loc, qty);
    const newId = makeId(updated);
    setCards((prev) => ({ ...prev, [newId]: updated }));
    setColumns((prev) => {
      const shippedIds = prev.shipped.filter(
        (id) => (cards[id]?.rowIndex ?? -1) !== a.base.rowIndex,
      );
      const nextStock = prev.stock.includes(newId)
        ? prev.stock
        : [...prev.stock, newId];
      return { ...prev, shipped: shippedIds, stock: nextStock };
    });
    try {
      await updatePacking({
        action: "restore",
        rowIndex: a.base.rowIndex,
        packingData: { quantity: qty, location: loc, to: loc },
        log: {
          when: new Date().toISOString(),
          shipType: "",
          user: "",
          fromLocation: "",
          toLocation: loc,
        },
        requestId: rid,
      });
    } catch (err) {
      toast((err as Error).message);
    }
    finish(newId);
  }

  // ==== 操作実装 ====

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
    const res = await fetch(API_ENDPOINTS.UPDATE_PACKING, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const resJson = await res.json().catch(() => null);
    if (!res.ok || !resJson?.success) {
      throw new Error(resJson?.error || res.statusText);
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
      const loc = normalizeLocation(payload.location || "").label;
      await updatePacking({
        action: "pack",
        rowIndex: item.rowIndex,
        packingData: {
          quantity: payload.quantity || 1,
          location: loc,
        },
        log: {
          when: new Date().toISOString(),
          shipType: "",
          user: "",
          fromLocation: "",
          toLocation: loc,
        },
        requestId: rid,
      });
      await fetchData();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      inflightRef.current.delete(key);
      closeDialog();
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
      await updatePacking({
        action: "ship",
        rowIndex: item.rowIndex,
        packingData: {
          quantity: payload.quantity || 1,
          location: payload.location?.trim(),
          from: item.packingInfo.location,
          to: payload.location?.trim(),
        },
        log: {
          when: new Date().toISOString(),
          shipType: payload.shipType || "",
          user: "",
          fromLocation: item.packingInfo.location,
          toLocation: payload.location?.trim() || "",
        },
        requestId: rid,
      });
      await fetchData();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      inflightRef.current.delete(key);
      closeDialog();
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
    return `${item.rowIndex}_${item.packingInfo?.location || "-"}`;
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
            <button
              onClick={() => setArchiveOpen(true)}
              className="hidden md:inline-flex px-4 py-2 rounded-full border-2 border-purple-600 text-purple-700 hover:bg-purple-50"
            >
              アーカイブ
            </button>
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
              className={`grid grid-cols-1 ${
                hasShipped ? "md:grid-cols-3" : "md:grid-cols-2"
              } gap-4`}
              style={{ gridAutoFlow: "column", overflowX: "auto" }}
            >
              {(hasShipped ? K_STATUSES : K_STATUSES.filter((c) => c.id !== "shipped")).map((col) => (
                <KanbanColumn
                  key={col.id}
                  id={col.id as KanbanStatusId}
                  title={col.label}
                  hint={col.hint}
                  cardIds={columns[col.id as KanbanStatusId]}
                  allCards={cards}
                  highlightId={highlightId}
                  onOpenArchive={() => setArchiveOpen(true)}
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
              defaultLocation={restoreTarget.base.packingInfo.location || ""}
              maxQuantity={restoreTarget.ship.quantity}
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

        {/* アーカイブ ドロワー */}
        <ArchiveDrawer
          open={archiveOpen}
          onClose={() => setArchiveOpen(false)}
          items={archive}
          query={archiveQuery}
          onQuery={setArchiveQuery}
          onRestore={restoreFromArchive}
        />
      </div>
    </div>
  );
};

// ===== Kanban Column =====
function KanbanColumn({
  id,
  title,
  hint,
  cardIds,
  allCards,
  highlightId,
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
      <div className="flex justify-between items-center mb-2">
        <div className="text-sm text-gray-600">
          {item.manufactureDate} ・バッチ{item.batchNo || "-"} ・行No.
          {item.rowIndex}
        </div>
        {columnId === "stock" && (
          <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            在庫 {item.stockQty ?? item.quantity} 個
          </span>
        )}
      </div>

      {/* 情報行：2カラム混在（ご要望版） */}
      <div className="space-y-2 text-sm">
        {/* 1行目：味付け種類（フル幅） */}
        <Field k="味付け種類" v={item.seasoningType || "-"} />

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

        {/* 4行目：保管場所（在庫列のみ） */}
        {columnId === "stock" && (
          <Field k="保管場所" v={item.packingInfo.location || "-"} />
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

// ===== ダイアログ & フォーム =====
function SimpleDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
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
          <button
            onClick={onClose}
            className="px-2 py-1 text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
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
              {locationOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
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

// ===== Archive Drawer =====
function ArchiveDrawer({
  open,
  onClose,
  items,
  query,
  onQuery,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  items: ArchiveItem[];
  query: string;
  onQuery: (q: string) => void;
  onRestore: (x: ArchiveItem) => void;
}) {
  const list = items.filter((i) =>
    !query ||
    `${i.base.seasoningType}${i.base.fishType}${i.base.origin}${i.base.manufactureProduct}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  return (
    <div
      className={`fixed top-0 right-0 h-screen w-full md:w-[420px] bg-white shadow-2xl z-50 transition-transform ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <strong>📚 出荷アーカイブ</strong>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="味付け/魚種/産地で検索"
            className="px-3 py-2 border rounded-lg"
          />
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-gray-200"
          >
            閉じる
          </button>
        </div>
      </div>
      <div className="p-3 overflow-auto h-[calc(100vh-56px)]">
        {list.length === 0 && (
          <div className="text-gray-500 text-sm">出荷履歴はまだありません</div>
        )}
        {list.map((i) => (
          <div key={i.id} className="border rounded-xl p-3 mb-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold">{i.base.seasoningType}</div>
                <div className="text-sm text-gray-500">
                  {i.base.fishType} / {i.base.origin}
                </div>
              </div>
              <button
                onClick={() => onRestore(i)}
                className="px-2 py-1 text-sm bg-purple-600 text-white rounded-lg"
              >
                復帰
              </button>
            </div>
            <div className="text-sm">
              {i.ship.type} {i.ship.quantity}個 ({i.ship.date})
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
