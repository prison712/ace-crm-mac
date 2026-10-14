import type { SelectedLocation } from '@/maps/types'
import { useEffect, useMemo, useRef, useState } from 'react'

interface LocalCity {
  name: string;
}
interface LocalState {
  name: string;
  cities: LocalCity[];
}
interface LocalCountry {
  name: string;
  iso2: string;
  states: LocalState[];
}

interface TreeNode {
  key: string;
  name: string;
  label: string;
  isLeaf: boolean;
  children?: TreeNode[];
}

/**
 * 把树节点转成已选地点。
 * @param node 树节点
 * @returns 选择项
 */
function toSelected(node: TreeNode): SelectedLocation {
  const parts = node.label.split(",").map((p) => p.trim());
  return {
    country: parts[parts.length - 1] || node.name,
    state: parts.length >= 2 ? parts[parts.length - 2] : undefined,
    city: parts.length >= 3 ? parts[0] : undefined,
    label: node.label,
  };
}

/**
 * 构建离线地点树：国家 → 省/州 → 城市。
 * 无城市的州本身作为叶子。
 * @param data 本地 JSON
 * @returns 国家节点列表
 */
function buildTree(data: LocalCountry[]): TreeNode[] {
  return data.map((country) => ({
    key: `c:${country.iso2}`,
    name: country.name,
    label: country.name,
    isLeaf: false,
    children: country.states.map((state) => {
      const noCity = !state.cities?.length;
      if (noCity) {
        return {
          key: `s:${country.iso2}:${state.name}`,
          name: state.name,
          label: `${state.name}, ${country.name}`,
          isLeaf: true,
        };
      }
      return {
        key: `s:${country.iso2}:${state.name}`,
        name: state.name,
        label: `${state.name}, ${country.name}`,
        isLeaf: false,
        children: state.cities.map((city) => ({
          key: `city:${country.iso2}:${state.name}:${city.name}`,
          name: city.name,
          label: `${city.name}, ${state.name}, ${country.name}`,
          isLeaf: true,
        })),
      };
    }),
  }));
}

/**
 * 收集某节点下全部叶子地点。
 * @param node 节点
 * @returns 叶子列表
 */
function collectLeaves(node: TreeNode): TreeNode[] {
  if (node.isLeaf || !node.children?.length) return [node];
  return node.children.flatMap(collectLeaves);
}

/**
 * 仅使用本地 countries+states+cities.json 的离线地点选择。
 * 下拉以浮层叠在上层，不挤压同行布局。
 */
export function LocationPicker({
  value,
  onChange,
  onOpenChange,
}: {
  value: SelectedLocation[];
  onChange: (next: SelectedLocation[]) => void;
  /** 浮层开关变化时回调（用于临时避开地图 WebView 遮挡） */
  onOpenChange?: (open: boolean) => void;
}) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => new Set(value.map((item) => item.label)), [value]);

  useEffect(() => {
    void fetch("./countries+states+cities.json")
      .then((res) => res.json())
      .then((json: LocalCountry[]) => {
        setTree(buildTree(json));
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    return () => {
      onOpenChange?.(false);
    };
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    /**
     * 点击浮层外部时关闭。
     * @param event 鼠标事件
     */
    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) setOpen(false);
    }

    /**
     * Esc 关闭浮层。
     * @param event 键盘事件
     */
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function mergeSelected(add: SelectedLocation[], removeLabels: string[] = []) {
    const remove = new Set(removeLabels);
    const map = new Map<string, SelectedLocation>();
    for (const item of value) {
      if (!remove.has(item.label)) map.set(item.label, item);
    }
    for (const item of add) map.set(item.label, item);
    onChange([...map.values()]);
  }

  function toggleNode(node: TreeNode, checked: boolean) {
    const leaves = collectLeaves(node);
    if (checked) mergeSelected(leaves.map(toSelected));
    else mergeSelected([], leaves.map((leaf) => leaf.label));
  }

  function isChecked(node: TreeNode): boolean {
    const leaves = collectLeaves(node);
    return leaves.length > 0 && leaves.every((leaf) => selected.has(leaf.label));
  }

  function isIndeterminate(node: TreeNode): boolean {
    const leaves = collectLeaves(node);
    const count = leaves.filter((leaf) => selected.has(leaf.label)).length;
    return count > 0 && count < leaves.length;
  }

  function matchesQuery(node: TreeNode, q: string): boolean {
    if (!q) return true;
    if (node.name.toLowerCase().includes(q) || node.label.toLowerCase().includes(q)) return true;
    return (node.children || []).some((child) => matchesQuery(child, q));
  }

  function renderNode(node: TreeNode, depth: number) {
    const q = query.trim().toLowerCase();
    if (!matchesQuery(node, q)) return null;
    const isOpen = !!expanded[node.key] || !!q;
    const kids = node.children || [];

    return (
      <div key={node.key} style={{ marginLeft: depth * 12 }}>
        <div className="flex items-center gap-1 py-0.5">
          <button
            type="button"
            className="w-4 text-[10px] text-[var(--muted-foreground)]"
            disabled={node.isLeaf}
            onClick={() => setExpanded((prev) => ({ ...prev, [node.key]: !prev[node.key] }))}
          >
            {node.isLeaf ? "·" : isOpen ? "▾" : "▸"}
          </button>
          <input
            type="checkbox"
            checked={isChecked(node)}
            ref={(el) => {
              if (el) el.indeterminate = isIndeterminate(node);
            }}
            onChange={(e) => toggleNode(node, e.target.checked)}
          />
          <button
            type="button"
            className="truncate text-left"
            title={node.label}
            onClick={() =>
              !node.isLeaf &&
              setExpanded((prev) => ({ ...prev, [node.key]: !prev[node.key] }))
            }
          >
            {node.name}
            {node.isLeaf && depth === 1 && (
              <span className="ml-1 text-[10px] text-[var(--muted-foreground)]">(无下级城市)</span>
            )}
          </button>
        </div>
        {isOpen && kids.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  if (loading) return <p className="text-[11px] text-[var(--muted-foreground)]">地点加载中…</p>;
  if (error) return <p className="text-[11px] text-[var(--destructive)]">地点加载失败：{error}</p>;

  const summary =
    value.length === 0
      ? "点击选择地点…"
      : value.length <= 2
        ? value.map((item) => item.label).join("；")
        : `已选 ${value.length} 个地点`;

  return (
    <div ref={rootRef} className="relative z-40">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded border border-[var(--border)] bg-white px-2 text-left text-xs outline-none hover:border-[var(--primary)] focus:border-[var(--primary)]"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{summary}</span>
        <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-50 flex w-[min(520px,72vw)] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-xl"
          style={{ maxHeight: "min(60vh, 420px)" }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
            <input
              autoFocus
              className="h-8 flex-1 rounded border border-[var(--border)] bg-[#fbfcfd] px-2 text-xs outline-none focus:border-[var(--primary)]"
              placeholder="搜索国家 / 州 / 城市"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">已选 {value.length}</span>
            {value.length > 0 && (
              <button
                type="button"
                className="shrink-0 text-[11px] text-[var(--destructive)]"
                onClick={() => onChange([])}
              >
                清空
              </button>
            )}
          </div>
          <p className="shrink-0 px-2 py-1 text-[10px] text-[var(--muted-foreground)]">
            离线数据：国家 → 省/州 → 城市（勾选上级可级联全选）
          </p>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 text-xs">
            {tree.map((country) => renderNode(country, 0))}
          </div>
        </div>
      )}
    </div>
  );
}
