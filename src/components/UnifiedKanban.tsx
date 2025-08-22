'use client';

import React, { useEffect, useMemo, useState } from "react";
// Unified Kanban UI – 梱包/出荷/在庫 の表側プロトタイプ
// v2.16  (Client Component 指定)
// - SyntaxError: Unexpected token の根本原因を修正（メイン関数のreturn/クロージャ欠落 & buildMockData の末尾カッコ）
// - 出荷アーカイブ → 在庫へ戻す をUIダイアログで確実に反映（在庫列へ追加/加算 + 自動スクロール & ハイライト）
// - 在庫→一部出荷／在庫移動を維持

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
  status: "未処理" | "完了"; // 既存互換
  packingInfo: { location: string; quantity: string; date?: string; user?: string };
};

type ShipType = "ロジカム出荷" | "羽野出荷";

type ArchiveItem = {
  id: string; // cardId + ts
  base: PackingItem;
  ship: { type: ShipType; quantity: number; date: string };
};

// ===== 定数 =====
const API_ENDPOINTS = {
  SEARCH_PACKING: "/api/packing/search",
  UPDATE_PACKING: "/api/packing/update",
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
import { DndContext, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ===== 純粋関数（テストしやすい） =====
export function computeRestoredItem(base: PackingItem, location: string, qty: number): PackingItem {
  return {
    ...base,
    packingInfo: { ...base.packingInfo, location: location.trim(), quantity: String(qty) },
    status: "完了",
  };
}

export function computeSplit(originalQty: number, moveQty: number) {
  const o = Math.max(0, Number(originalQty) || 0);
  const m = Math.max(1, Math.min(Number(moveQty) || 0, o));
  return { remain: o - m, move: m };
}

// ===== メイン =====
export default function UnifiedKanbanPrototypeV2() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [filters, setFilters] = useState<Filters>({
    date: today,
    product: "",
    status: "",
    quantityMin: "",
    quantityMax: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kanban の並び（各列に属するカードID）
  const [columns, setColumns] = useState<Record<KanbanStatusId, string[]>>({
    manufactured: [],
    stock: [],
    shipped: [],
  });
  // カード辞書（id -> item）
  const [cards, setCards] = useState<Record<string, PackingItem>>({});

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
      if (f.status && legacyStatusMap[f.status]) params.append("status", legacyStatusMap[f.status]);
      if (f.quantityMin) params.append("quantityMin", f.quantityMin);
      if (f.quantityMax) params.append("quantityMax", f.quantityMax);

      let data: PackingItem[] | null = null;
      try {
        const res = await fetch(`${API_ENDPOINTS.SEARCH_PACKING}?${params.toString()}`, { cache: "no-store" });
        const j = await res.json();
        if (j?.success) data = (j.data as PackingItem[]) || [];
        else throw new Error(j?.error || "検索に失敗しました");
      } catch {
        data = buildMockData(f.date);
      }

      const nextCards: Record<string, PackingItem> = {};
      const col: Record<KanbanStatusId, string[]> = { manufactured: [], stock: [], shipped: [] };

      for (const it of data) {
        const uiStatus: KanbanStatusId = it.status === "未処理" ? "manufactured" : "stock";
        const id = makeId(it);
        nextCards[id] = it;
        col[uiStatus].push(id);
      }

      setCards(nextCards);
      setColumns(col);

      // 初期アーカイブ（サンプル3件）
      setArchive((prev) => {
        if (prev.length > 0) return prev;
        const bases = data || [];
        const b0 = bases[0] || buildMockData(f.date)[0];
        const b1 = bases[1] || buildMockData(f.date)[1];
        const b2 = bases[2] || buildMockData(f.date)[2];
        return [
          { id: `sample#1`, base: b1, ship: { type: "ロジカム出荷", quantity: 120, date: f.date } },
          { id: `sample#2`, base: b2, ship: { type: "羽野出荷", quantity: 50, date: f.date } },
          { id: `sample#3`, base: { ...b0, status: "完了", packingInfo: { ...b0.packingInfo, location: "パレット③", quantity: "100" } }, ship: { type: "ロジカム出荷", quantity: 80, date: f.date } },
        ];
      });
    } catch (e: any) {
      setError(e.message || "読み込みエラー");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData({ date: today });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // ==== DnD 設定 ====
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const from = findColumnOf(activeId, columns);
    const to = (over.id as KanbanStatusId) || from;
    if (!from || !to || from === to) return;

    // 製造→在庫、在庫→出荷 のみ許可（左→右）
    const allowed = (from === "manufactured" && to === "stock") || (from === "stock" && to === "shipped");
    if (!allowed) return;

    const item = cards[activeId];
    if (!item) return;

    if (from === "manufactured" && to === "stock") {
      openDialog({ mode: "pack", item, origin: from, onSubmit: (p) => doPack(item, p as any) });
    } else if (from === "stock" && to === "shipped") {
      openDialog({ mode: "ship", item, origin: from, onSubmit: (p) => doShip(item, p as any) });
    }
  }

  // ==== 操作ダイアログ ====
  const [dialog, setDialog] = useState<{
    mode: "pack" | "ship" | "move" | null;
    origin?: KanbanStatusId;
    item?: PackingItem | null;
    onSubmit?: (p: { location?: string; quantity?: number; shipType?: ShipType }) => void;
  }>({ mode: null });

  function openDialog(d: { mode: "pack" | "ship" | "move"; origin?: KanbanStatusId; item: PackingItem; onSubmit: (p: { location?: string; quantity?: number; shipType?: ShipType }) => void }) {
    setDialog(d);
  }
  function closeDialog() {
    setDialog({ mode: null, item: null });
  }

  // ==== 親ハンドラ（KanbanCard へ渡す） ====
  function requestPack(item: PackingItem) {
    const origin = findColumnOf(makeId(item), columns) || "manufactured";
    openDialog({ mode: "pack", item, origin, onSubmit: (p) => doPack(item, p as any) });
  }
  function requestShip(item: PackingItem) {
    const origin = findColumnOf(makeId(item), columns) || "manufactured";
    openDialog({ mode: "ship", item, origin, onSubmit: (p) => doShip(item, p as any) });
  }
  function requestMove(item: PackingItem) {
    const origin = findColumnOf(makeId(item), columns) || "stock";
    openDialog({
      mode: "move",
      item,
      origin,
      onSubmit: (p) => {
        const to = (p.location || "").trim();
        if (!to) return;
        const cur = Math.max(0, parseInt(item.packingInfo.quantity || "0", 10) || 0);
        const { remain, move } = computeSplit(cur, p.quantity || cur);
        if (move === cur) {
          // 全量移動（IDも更新）
          const { beforeId, afterId, updated } = computeAfterMove(item, to);
          setCards((prev) => {
            const n = { ...prev };
            delete n[beforeId];
            n[afterId] = updated;
            return n;
          });
          setColumns((prev) => ({ ...prev, stock: prev.stock.map((id) => (id === beforeId ? afterId : id)) }));
        } else {
          // 分割：元を減算し、新カードを追加
          const beforeId = makeId(item);
          const updatedOrigin: PackingItem = { ...item, packingInfo: { ...item.packingInfo, quantity: String(remain) } };
          const moved: PackingItem = { ...item, packingInfo: { ...item.packingInfo, location: to, quantity: String(move) } };
          const newId = makeId(moved);
          setCards((prev) => ({ ...prev, [beforeId]: updatedOrigin, [newId]: moved }));
          setColumns((prev) => ({ ...prev, stock: [...prev.stock, newId] }));
        }
        closeDialog();
      },
    });
  }
  function requestRestoreFromShipped(item: PackingItem) {
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
  }

  function restoreFromArchive(a: ArchiveItem) {
    // ダイアログで入力させる
    setRestoreTarget(a);
  }

  function doRestoreFromArchive(a: ArchiveItem, payload: { location?: string; quantity?: number }) {
    const loc = (payload.location || "").trim();
    if (!loc) return;
    const qty = Math.max(1, Math.min(a.ship.quantity, payload.quantity || a.ship.quantity));

    // 後処理（ドロワーを閉じ、対象カードへスクロール＆一時ハイライト）
    const finish = (targetId: string) => {
      setArchiveOpen(false);
      setRestoreTarget(null);
      setTimeout(() => {
        const el = document.getElementById(`card-${targetId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
          setHighlightId(targetId);
          setTimeout(() => setHighlightId(null), 1200);
        }
      }, 0);
    };

    // 既存在庫（同 rowIndex & 同ロケーション）があるか
    const existingId = Object.keys(cards).find((id) => {
      const it = cards[id];
      return it && it.rowIndex === a.base.rowIndex && (it.packingInfo.location || "") === loc && columns.stock.includes(id);
    });

    if (existingId) {
      const current = cards[existingId];
      const curQty = Math.max(0, parseInt(current.packingInfo.quantity || "0", 10) || 0);
      const nextQty = curQty + qty;
      const updated: PackingItem = { ...current, packingInfo: { ...current.packingInfo, quantity: String(nextQty) } };
      setCards((prev) => ({ ...prev, [existingId]: updated }));
      setColumns((prev) => ({ ...prev, shipped: prev.shipped.filter((id) => (cards[id]?.rowIndex ?? -1) !== a.base.rowIndex) }));
      finish(existingId);
      return;
    }

    // 新規在庫カードとして追加
    const updated = computeRestoredItem(a.base, loc, qty);
    const newId = makeId(updated);
    setCards((prev) => ({ ...prev, [newId]: updated }));
    setColumns((prev) => {
      const shippedIds = prev.shipped.filter((id) => (cards[id]?.rowIndex ?? -1) !== a.base.rowIndex);
      const nextStock = prev.stock.includes(newId) ? prev.stock : [...prev.stock, newId];
      return { ...prev, shipped: shippedIds, stock: nextStock };
    });
    finish(newId);
  }

  // ==== 操作実装（サーバ更新は仮） ====
  async function doPack(item: PackingItem, payload: { location?: string; quantity?: number }) {
    const beforeId = makeId(item);
    const loc = (payload.location || "").trim();
    const qty = Math.max(1, payload.quantity || item.quantity);
    try {
      await fetch(API_ENDPOINTS.UPDATE_PACKING, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: item.rowIndex, packingData: { location: loc, quantity: String(qty) } }),
      });
    } catch {}
    const updated: PackingItem = { ...item, packingInfo: { ...item.packingInfo, location: loc, quantity: String(qty) }, status: "完了" };
    const afterId = makeId(updated);
    setCards((prev) => {
      const n = { ...prev };
      delete n[beforeId];
      n[afterId] = updated;
      return n;
    });
    moveCardEx(beforeId, "manufactured", "stock", afterId);
    closeDialog();
  }

  async function doShip(item: PackingItem, payload: { location?: string; quantity?: number; shipType?: ShipType }) {
    const from = findColumnOf(makeId(item), columns);
    const shipType: ShipType = (payload.shipType as ShipType) || "ロジカム出荷";
    // 製造→出荷では location 入力なし
    const loc = from === "manufactured" ? "" : payload.location || item.packingInfo.location || "";
    const maxFromManufactured = item.quantity;
    const maxFromStock = Math.max(1, Number(item.packingInfo.quantity) || item.quantity);
    const reqQty = payload.quantity || (from === "manufactured" ? maxFromManufactured : maxFromStock);
    const qty = Math.max(1, Math.min(reqQty, from === "manufactured" ? maxFromManufactured : maxFromStock));

    try {
      await fetch(API_ENDPOINTS.UPDATE_PACKING, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: item.rowIndex, packingData: { location: loc, quantity: String(qty) } }),
      });
    } catch {}

    if (from === "stock") {
      // 在庫→出荷は一部出荷に対応
      const cur = Math.max(0, parseInt(item.packingInfo.quantity || "0", 10) || 0);
      const { remain, move } = computeSplit(cur, qty);
      // 出荷ログは常にアーカイブへ追加
      const arch: ArchiveItem = {
        id: `${makeId(item)}#${Date.now()}`,
        base: item,
        ship: { type: shipType, quantity: move, date: filters.date || today },
      };
      setArchive((prev) => [arch, ...prev]);

      if (remain > 0) {
        // 一部出荷：カードは在庫に残し、数量だけ減算
        const beforeId = makeId(item);
        const updated: PackingItem = { ...item, packingInfo: { ...item.packingInfo, quantity: String(remain) } };
        setCards((prev) => ({ ...prev, [beforeId]: updated }));
        closeDialog();
        return;
      }
      // ちょうど出荷：列を出荷済みに移動
      moveCardEx(makeId(item), "stock", "shipped");
      closeDialog();
      return;
    }

    // 製造→出荷（全量 or 指定量）。UI上はカードを出荷済みに移動
    const arch: ArchiveItem = {
      id: `${makeId(item)}#${Date.now()}`,
      base: item,
      ship: { type: shipType, quantity: qty, date: filters.date || today },
    };
    setArchive((prev) => [arch, ...prev]);
    moveCardEx(makeId(item), from || "manufactured", "shipped");
    closeDialog();
  }

  // ==== ユーティリティ ====
  function moveCardEx(oldId: string, from: KanbanStatusId, to: KanbanStatusId, newId?: string) {
    setColumns((prev) => {
      const src = prev[from].filter((id) => id !== oldId);
      const dst = [...prev[to], newId || oldId];
      return { ...prev, [from]: src, [to]: dst };
    });
  }
  function makeId(item: PackingItem) {
    return `${item.rowIndex}_${item.packingInfo?.location || "-"}`;
  }
  function findColumnOf(cardId: string, cols: Record<KanbanStatusId, string[]>) {
    for (const k of Object.keys(cols) as KanbanStatusId[]) {
      if (cols[k].includes(cardId)) return k;
    }
    return undefined as unknown as KanbanStatusId | undefined;
  }
  function computeAfterMove(item: PackingItem, newLocation: string) {
    const beforeId = makeId(item);
    const updated: PackingItem = { ...item, packingInfo: { ...item.packingInfo, location: newLocation } };
    const afterId = makeId(updated);
    return { beforeId, afterId, updated };
  }

  // ==== スモークテスト（UIに影響しない簡易チェック） ====
  useEffect(() => {
    try {
      const mock = buildMockData(today)[0];
      const id0 = makeId(mock);
      console.assert(typeof id0 === "string" && id0.startsWith(String(mock.rowIndex)), "[TEST] makeId basic");
      const { beforeId, afterId } = computeAfterMove(mock, "テスト棚");
      console.assert(beforeId !== afterId, "[TEST] computeAfterMove id changes");
      const restored = computeRestoredItem(mock, "棚A", 10);
      const id1 = makeId(restored);
      console.assert(id1 !== id0 && restored.status === "完了" && restored.packingInfo.quantity === "10", "[TEST] restore logic");
      const sp = computeSplit(20, 10);
      console.assert(sp.remain === 10 && sp.move === 10, "[TEST] split 20->10/10");
      const md = buildMockData(today);
      console.assert(Array.isArray(md) && md.length === 3 && md[2].rowIndex === 1647, "[TEST] mock data closed array");
      console.assert(STORAGE_OPTIONS.length === 9 && STORAGE_OPTIONS[0].includes("パレット"), "[TEST] storage options ready");
      const item2 = md[1];
      console.assert(item2.status === "完了" && !!item2.packingInfo.location, "[TEST] stock item has location");
      console.log("[TEST] smoke OK");
    } catch (e) {
      console.warn("[TEST] smoke failed", e);
    }
  }, [today]);

  // ==== レイアウト ====
  const headerTitle = "梱包・出荷 一体型ボード（試作 v2.16）";
  const currentDialog = dialog;
  const currentItem = dialog.item as PackingItem | undefined;
  const origin = dialog.origin as KanbanStatusId | undefined;
  const computedMaxQty = currentItem
    ? currentDialog.mode === "ship"
      ? origin === "manufactured"
        ? currentItem.quantity
        : Math.max(1, parseInt(currentItem.packingInfo.quantity || "0", 10) || currentItem.quantity)
      : currentDialog.mode === "move"
      ? Math.max(1, parseInt(currentItem.packingInfo.quantity || "0", 10) || 1)
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
              <label className="block text-sm font-medium text-gray-700 mb-1">製造日</label>
              <input
                type="date"
                value={filters.date}
                onChange={(e) => setFilters({ ...filters, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">味付け種類</label>
              <input
                type="text"
                placeholder="味付け種類で検索"
                value={filters.product}
                onChange={(e) => setFilters({ ...filters, product: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ステータス</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">すべて</option>
                <option value="manufactured">製造済み</option>
                <option value="stock">梱包済み（在庫）</option>
                <option value="shipped">出荷済み</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">数量範囲</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="最小"
                  value={filters.quantityMin}
                  onChange={(e) => setFilters({ ...filters, quantityMin: e.target.value })}
                  className="w-1/2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                <input
                  type="number"
                  placeholder="最大"
                  value={filters.quantityMax}
                  onChange={(e) => setFilters({ ...filters, quantityMax: e.target.value })}
                  className="w-1/2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <button onClick={() => fetchData()} className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors">
                フィルター
              </button>
              <button
                onClick={() => {
                  const next: Filters = { date: today, product: "", status: "", quantityMin: "", quantityMax: "" };
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ gridAutoFlow: "column", overflowX: "auto" }}>
              {K_STATUSES.map((col) => (
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
            title={currentDialog.mode === "pack" ? "梱包（在庫へ移動）" : currentDialog.mode === "move" ? "在庫移動" : "出荷登録"}
          >
            <ActionForm
              mode={currentDialog.mode}
              origin={origin}
              defaultLocation={currentItem.packingInfo.location || ""}
              maxQuantity={computedMaxQty}
              useSelectLocation={currentDialog.mode !== "ship"}
              showLocation={currentDialog.mode !== "ship" || origin === "stock"}
              showQuantity={true}
              locationOptions={STORAGE_OPTIONS}
              shipTypeOptions={["ロジカム出荷", "羽野出荷"]}
              onCancel={closeDialog}
              onSubmit={(payload) => currentDialog.onSubmit?.(payload)}
            />
          </SimpleDialog>
        )}

        {/* 復帰ダイアログ（アーカイブ→在庫） */}
        {restoreTarget && (
          <SimpleDialog title="出荷アーカイブから在庫へ戻す" onClose={() => setRestoreTarget(null)}>
            <ActionForm
              mode="pack"
              defaultLocation={restoreTarget.base.packingInfo.location || ""}
              maxQuantity={restoreTarget.ship.quantity}
              useSelectLocation={true}
              showLocation={true}
              showQuantity={true}
              locationOptions={STORAGE_OPTIONS}
              shipTypeOptions={["ロジカム出荷", "羽野出荷"]}
              onCancel={() => setRestoreTarget(null)}
              onSubmit={(p) => {
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
}

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
            <div className="h-32 grid place-items-center border-2 border-dashed rounded-xl text-gray-400">ここにカードをドラッグ</div>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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
          {item.manufactureDate} ・バッチ{item.batchNo || "-"} ・行No.{item.rowIndex}
        </div>
        {columnId === "stock" && (
          <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            在庫 {item.packingInfo.quantity || item.quantity} 個
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Field k="味付け種類" v={item.seasoningType || "-"} />
        <Field k="魚種" v={item.fishType || "-"} />
        <Field k="産地" v={item.origin || "-"} />
        <Field k="数量" v={`${item.quantity} 個`} />
        {columnId === "stock" ? (
          <>
            <Field k="製造商品" v={item.manufactureProduct || "-"} />
            <Field k="保管場所" v={item.packingInfo.location || "-"} />
          </>
        ) : (
          <div className="col-span-2">
            <Field k="製造商品" v={item.manufactureProduct || "-"} />
          </div>
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
        {columnId === "shipped" && <ButtonLine onClick={() => onRequestRestore(item)}>在庫へ戻す</ButtonLine>}
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto,1fr] items-center gap-x-2 pb-1">
      <span className="inline-flex h-6 items-center px-2 rounded bg-gray-600 text-white text-xs font-bold whitespace-nowrap">
        {k}
      </span>
      <span className="font-bold text-gray-900 text-right truncate">{v}</span>
    </div>
  );
}

function ButtonLine({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="px-3 py-1.5 rounded-full border-2 border-purple-600 text-purple-700 hover:bg-purple-50 text-xs">
      {children}
    </button>
  );
}

// ===== ダイアログ & フォーム =====
function SimpleDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="px-2 py-1 text-gray-500 hover:text-gray-700">
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
  onSubmit: (p: { location?: string; quantity?: number; shipType?: ShipType }) => void;
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (showLocation && !location) return;
        if (showQuantity && quantity <= 0) return;
        onSubmit({ location: showLocation ? location : undefined, quantity: showQuantity ? quantity : undefined, shipType });
      }}
      className="space-y-4"
    >
      {showLocation && (
        <div>
          <label className="block text-sm font-medium mb-1">{mode === "pack" || mode === "move" ? "保管場所" : "出荷元ロケーション"}</label>
          {useSelectLocation ? (
            <select
              value={location}
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
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例: パレット①"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          )}
        </div>
      )}

      {showQuantity && (
        <div>
          <label className="block text-sm font-medium mb-1">数量（最大 {maxQuantity}）</label>
          <input
            type="number"
            min={1}
            max={Math.max(1, maxQuantity)}
            value={quantity}
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
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border">
          キャンセル
        </button>
        <button type="submit" className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700">
          {mode === "pack" ? "在庫へ移動" : mode === "move" ? "移動する" : "出荷を登録"}
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
  const list = items.filter(
    (i) =>
      !query ||
      `${i.base.seasoningType} ${i.base.fishType} ${i.base.origin} ${i.base.manufactureProduct}`
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
          <button onClick={onClose} className="px-3 py-2 rounded-lg bg-gray-200">
            閉じる
          </button>
        </div>
      </div>
      <div className="p-3 overflow-auto h-[calc(100vh-56px)]">
        {list.length === 0 && <div className="text-gray-500 text-sm">出荷履歴はまだありません</div>}
        {list.map((i) => (
          <div key={i.id} className="border rounded-xl p-3 mb-3 bg-gray-50">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
              <div>
                {i.ship.date} ・ 行No.{i.base.rowIndex}
              </div>
              <span className="px-2 py-0.5 rounded-full border text-[11px]">{i.ship.type}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Field k="味付け種類" v={i.base.seasoningType} />
              <Field k="産地" v={i.base.origin} />
              <Field k="魚種" v={i.base.fishType} />
              <Field k="出荷数量" v={`${i.ship.quantity} 個`} />
            </div>
            <div className="flex justify-end mt-2">
              <ButtonLine onClick={() => onRestore(i)}>在庫へ戻す</ButtonLine>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==== モックデータ ====
function buildMockData(date: string): PackingItem[] {
  return [
    {
      rowIndex: 1645,
      manufactureDate: date,
      batchNo: `B-${String(1645).slice(-3)}`,
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
      batchNo: `B-${String(1646).slice(-3)}`,
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
      batchNo: `B-${String(1647).slice(-3)}`,
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
