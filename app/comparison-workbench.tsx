'use client';

import { Bookmark, Check, ChevronDown, ChevronLeft, CircleHelp, Clock3, Eye, FileUp, Maximize2, Minus, Pencil, Plus, RotateCcw, Search, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ExperimentEditor } from './experiment-editor';
import { ExperimentEvidence, formatSeconds, normalizeExperiment, RealExperiment, realExperiments, realLogCount, RunStatus, TimeLink, TimeNode } from './comparison-model';

type Selection = { experiment: RealExperiment; node: TimeNode };
type RelationTarget = { experimentId: string; linkId: string; stageKey: string; sourceLabel: string; targetLabel: string; duration: number; origin: TimeLink['origin'] };
type TimeLens = { start: number; end: number; startX: number; endX: number; factor: number; pointCount: number; displayWidth: number; positionAt: (time: number) => number };
type ExpandedSegment = { linkId: string; scopeStack: string[] };
type RowContextMenu = { experimentId: string; left: number; top: number };
type NodeContextMenu = { experiment: RealExperiment; node: TimeNode; left: number; top: number; expandable: boolean };
type RelationContextMenu = RelationTarget & { left: number; top: number; canExpand: boolean; expanded: boolean };
type DropTarget = { experimentId: string; edge: 'before' | 'after' };
type ViewPreferences = { syncStages: boolean; showDurations: boolean };
type ParsedLine = { line: string; index: number; time?: number };
type WorkspaceState = {
  imported: RealExperiment[];
  overrides: Record<string, RealExperiment>;
  removedIds: string[];
  orderIds?: string[];
  baselineId?: string;
};

const WORKSPACE_KEY = 'chronoscope.workspace.v1';
const PREFERENCES_KEY = 'chronoscope.preferences.v1';
const DEFAULT_PREFERENCES: ViewPreferences = { syncStages: true, showDurations: true };

function lineTime(line: string) {
  const match = line.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  return Date.UTC(2026, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])) / 1000;
}

function detectModel(text: string, fileName: string) {
  const sample = `${fileName}\n${text.slice(0, 20000)}`;
  if (/DeepSeek[-_ ]?V?4/i.test(sample)) return 'DeepSeek-V4';
  const glm = sample.match(/\bGLM[-_ ]?\d+(?:\.\d+)?(?:[-_][A-Za-z0-9.]+)?/i);
  if (glm) return glm[0].replace('_', '-').toUpperCase();
  const qwen = sample.match(/\bQwen[-_ ]?[A-Za-z0-9.]+/i);
  if (qwen) return qwen[0].replace('_', '-');
  return '未识别模型';
}

function parseLog(text: string, file: File, order: number): RealExperiment | null {
  const lines: ParsedLine[] = text.split(/\r?\n/).map((line, index) => ({ line, index, time: lineTime(line) }));
  const timed = lines.filter((item) => item.time !== undefined);
  if (!timed.length) return null;

  const find = (pattern: RegExp) => lines.find((item) => pattern.test(item.line) && item.time !== undefined);
  const engine = find(/EngineCore.*(?:initial|start)|Starting engine core/i) ?? timed[0];
  const load = find(/Starting to load model|start(?:ing)? to load weights|Loading model weights/i);
  const weightLines = lines.filter((item) => /Loading weights took\s+[\d.]+\s+seconds/i.test(item.line) && item.time !== undefined && !/MTP/i.test(item.line));
  const main = weightLines.reduce<ParsedLine | undefined>((best, item) => {
    const value = Number(item.line.match(/Loading weights took\s+([\d.]+)/i)?.[1] ?? 0);
    const bestValue = Number(best?.line.match(/Loading weights took\s+([\d.]+)/i)?.[1] ?? 0);
    return value > bestValue ? item : best;
  }, undefined);
  const mtp = find(/MTP.*(?:weights?|loading).*(?:took|complete|loaded)|(?:took|complete|loaded).*MTP/i);
  const ready = find(/Application startup complete|Uvicorn running|service.*ready|GET \/(?:health|v1\/models).*200/i);

  const progressCandidates = lines
    .map((item) => {
      const match = item.line.match(/(\d+)%.*?(\d+)\/(\d+)/);
      return match && item.time !== undefined ? { item, percent: Number(match[1]), done: Number(match[2]), total: Number(match[3]) } : null;
    })
    .filter((item): item is { item: ParsedLine; percent: number; done: number; total: number } => Boolean(item));
  const progress = progressCandidates.reduce<{ item: ParsedLine; percent: number; done: number; total: number } | null>((best, item) => {
      if (!best) return item;
      return Math.abs(item.percent - 17) < Math.abs(best.percent - 17) ? item : best;
    }, null);

  const base = engine.time!;
  const nodes: TimeNode[] = [];
  const add = (item: ParsedLine | undefined, label: string, kind: TimeNode['kind'], detail: string) => {
    if (!item?.time) return;
    nodes.push({ id: `local-${order}-${item.index}-${kind}`, label, time: Math.max(0, item.time - base), kind, detail, locator: `L${item.index + 1}` });
  };
  add(engine, '引擎启动', 'start', 'EngineCore 开始初始化');
  add(load, '权重开始', 'start', '开始加载模型权重');
  if (progress) add(progress.item, `权重 ${progress.done}/${progress.total}`, main ? 'progress' : 'open', `Safetensors ${progress.percent}%`);
  const mainWeight = Number(main?.line.match(/Loading weights took\s+([\d.]+)/i)?.[1] ?? 0) || undefined;
  add(main, '主权重', 'rank', mainWeight ? `主权重 ${mainWeight.toFixed(2)} s` : '主权重完成');
  add(mtp, 'MTP 权重', 'mtp', 'MTP 权重完成');
  add(ready, '服务就绪', 'ready', '服务初始化完成');
  nodes.sort((a, b) => a.time - b.time);
  if (nodes.length < 2) return null;

  const total = Math.max(1, nodes.at(-1)?.time ?? mainWeight ?? 1);
  const short = file.name.replace(/\.(log|txt)$/i, '').slice(0, 20);
  const stamp = engine.line.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})/)?.[1] ?? '本地导入';
  const evidence: ExperimentEvidence = {
    id: `local-${Date.now()}-${order}`,
    name: short,
    model: detectModel(text, file.name),
    shortName: short,
    config: `手工导入 · ${file.name}`,
    date: stamp,
    total,
    mainWeight,
    source: file.name,
    nodes,
    links: nodes.slice(1).map((node, index) => ({
      id: `local-${order}-relation-${index}`,
      from: nodes[index].id,
      to: node.id,
      kind: 'sequence',
      origin: 'inferred',
    })),
  };
  return normalizeExperiment(evidence);
}

function moveJelly(event: ReactPointerEvent<HTMLDivElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width;
  const y = (event.clientY - box.top) / box.height;
  event.currentTarget.style.setProperty('--mx', `${x * 100}%`);
  event.currentTarget.style.setProperty('--my', `${y * 100}%`);
}

function resetJelly(event: ReactPointerEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty('--mx', '42%');
  event.currentTarget.style.setProperty('--my', '8%');
}

const MAIN_LANE_Y = 25;

function branchOrder(node: TimeNode) {
  const dp = node.label.match(/(?:DP|节点)\s*[·:_-]?\s*(\d+)/i);
  const tp = node.label.match(/TP\s*[·:_-]?\s*(\d+)/i);
  if (dp || tp) return Number(dp?.[1] ?? 0) * 1000 + Number(tp?.[1] ?? 0);
  return node.lane ?? Number.MAX_SAFE_INTEGER;
}

function branchLanePositions(count: number) {
  if (count <= 1) return [MAIN_LANE_Y];
  const top = count > 3 ? 9 : 14;
  const bottom = count > 3 ? 41 : 36;
  return Array.from({ length: count }, (_, index) => top + ((bottom - top) * index) / (count - 1));
}

function createLaneLayout(experiment: RealExperiment) {
  const nodes = new Map(experiment.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, TimeLink[]>();
  const outgoing = new Map<string, TimeLink[]>();
  experiment.links.forEach((link) => {
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link]);
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link]);
  });

  const layout = new Map(experiment.nodes.map((node) => [node.id, MAIN_LANE_Y]));
  experiment.nodes
    .slice()
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
    .forEach((source) => {
      const branches = (outgoing.get(source.id) ?? [])
        .filter((link) => link.kind === 'branch')
        .sort((left, right) => {
          const leftNode = nodes.get(left.to);
          const rightNode = nodes.get(right.to);
          if (!leftNode || !rightNode) return left.to.localeCompare(right.to);
          return branchOrder(leftNode) - branchOrder(rightNode) || leftNode.id.localeCompare(rightNode.id);
        });
      if (branches.length < 2) return;

      const positions = branchLanePositions(branches.length);
      branches.forEach((branch, index) => {
        let cursor = branch.to;
        const visited = new Set<string>();
        while (!visited.has(cursor) && nodes.has(cursor)) {
          visited.add(cursor);
          layout.set(cursor, positions[index]);
          const nextLinks = (outgoing.get(cursor) ?? []).filter((link) => link.kind === 'sequence');
          if (nextLinks.length !== 1) break;
          const next = nextLinks[0].to;
          if ((incoming.get(next) ?? []).length !== 1) break;
          cursor = next;
        }
      });
    });

  experiment.nodes.forEach((node) => {
    if ((incoming.get(node.id) ?? []).length > 1) layout.set(node.id, MAIN_LANE_Y);
  });
  return layout;
}

function laneClass(y: number) {
  if (y < MAIN_LANE_Y - 1) return 'lane-upper';
  if (y > MAIN_LANE_Y + 1) return 'lane-lower';
  return 'lane-main';
}

function nodeStageKey(node: TimeNode) {
  const label = node.label.toLowerCase();
  if (/预置/.test(label)) return 'prestage';
  if (/graph|图捕获/.test(label)) return 'graph';
  if (/vllm/.test(label)) return 'vllm';
  if (/engine|引擎/.test(label)) return 'engine';
  if (node.kind === 'ready' || /http|服务就绪/.test(label)) return 'ready';
  if (node.kind === 'mtp' || /mtp/.test(label)) return 'mtp';
  if (node.kind === 'rank' || /主权重|dp\d+\s*权重/.test(label)) return 'main-weight';
  if (node.kind === 'progress' || /权重\s*(?:\d+%|\d+\/\d+)/.test(label)) return 'weight-progress';
  if (/worker.*权重|权重开始/.test(label)) return 'weight-start';
  return `${node.kind}:${label.replace(/\d+(?:\.\d+)?/g, '#').replace(/\s+/g, '')}`;
}

function linkStageKey(link: TimeLink, nodes: Map<string, TimeNode>) {
  const source = nodes.get(link.from);
  const target = nodes.get(link.to);
  if (!source || !target) return link.id;
  return `${nodeStageKey(source)}>${nodeStageKey(target)}`;
}

const TIME_COLORS = [
  { at: 0, color: '#030405' },
  { at: 0.12, color: '#801e24' },
  { at: 0.2, color: '#dc4c32' },
  { at: 0.31, color: '#f3c444' },
  { at: 0.43, color: '#66bd63' },
  { at: 0.57, color: '#49c8ce' },
  { at: 0.71, color: '#3e73d9' },
  { at: 0.85, color: '#8454d2' },
  { at: 1, color: '#f3f7f7' },
];

function colorAt(value: number) {
  const at = Math.max(0, Math.min(1, value));
  const right = TIME_COLORS.find((stop) => stop.at >= at) ?? TIME_COLORS.at(-1)!;
  const left = [...TIME_COLORS].reverse().find((stop) => stop.at <= at) ?? TIME_COLORS[0];
  if (left.at === right.at) return left.color;
  const mix = (at - left.at) / (right.at - left.at);
  const channels = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const from = channels(left.color);
  const to = channels(right.color);
  return `rgb(${from.map((channel, index) => Math.round(channel + (to[index] - channel) * mix)).join(' ')})`;
}

function gradientSlice(start: number, end: number) {
  const safeStart = Math.max(0, Math.min(1, start));
  const safeEnd = Math.max(safeStart, Math.min(1, end));
  if (safeEnd - safeStart < 0.0001) return colorAt(safeStart);
  const points = [
    { at: safeStart, color: colorAt(safeStart) },
    ...TIME_COLORS.filter((stop) => stop.at > safeStart && stop.at < safeEnd),
    { at: safeEnd, color: colorAt(safeEnd) },
  ];
  return `linear-gradient(90deg, ${points.map((stop) => `${stop.color} ${((stop.at - safeStart) / (safeEnd - safeStart)) * 100}%`).join(', ')})`;
}

function allExperimentNodes(experiment: RealExperiment) {
  return new Map([...experiment.nodes, ...(experiment.detailNodes ?? [])].map((node) => [node.id, node]));
}

function hierarchyDepth(node: TimeNode, nodes: Map<string, TimeNode>) {
  let depth = 0;
  let current = node;
  const visited = new Set<string>();
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = nodes.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function directPathChild(scopeId: string, leafId: string, nodes: Map<string, TimeNode>) {
  let current = nodes.get(leafId);
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === scopeId) return current;
    current = nodes.get(current.parentId);
  }
  return undefined;
}

function segmentDetailNodes(experiment: RealExperiment, linkId: string, scopeOverride?: string) {
  const link = experiment.links.find((item) => item.id === linkId);
  if (!link) return [];
  const nodes = allExperimentNodes(experiment);
  if (scopeOverride) {
    const scope = nodes.get(scopeOverride);
    const relevant = (link.detailNodeIds ?? [])
      .map((id) => directPathChild(scopeOverride, id, nodes))
      .filter((node): node is TimeNode => Boolean(node));
    if (relevant.length) return Array.from(new Map(relevant.map((node) => [node.id, node])).values());
    return (scope?.childIds ?? []).map((id) => nodes.get(id)).filter((node): node is TimeNode => Boolean(node));
  }
  if (!link.detailNodeIds?.length) return [];
  if (!link.scopeNodeId) return link.detailNodeIds.map((id) => nodes.get(id)).filter((node): node is TimeNode => Boolean(node));
  const direct = link.detailNodeIds
    .map((id) => directPathChild(link.scopeNodeId!, id, nodes))
    .filter((node): node is TimeNode => Boolean(node));
  return Array.from(new Map(direct.map((node) => [node.id, node])).values());
}

function projectSegmentDetailNodes(experiment: RealExperiment, linkId: string, scopeOverride?: string) {
  const detailNodes = segmentDetailNodes(experiment, linkId, scopeOverride);
  const link = experiment.links.find((item) => item.id === linkId);
  if (!link || !detailNodes.length) return detailNodes;
  const nodes = allExperimentNodes(experiment);
  const source = nodes.get(link.from);
  const target = nodes.get(link.to);
  if (!source || !target) return detailNodes;
  const segmentStart = Math.min(source.time, target.time);
  const segmentEnd = Math.max(source.time, target.time);
  const leafIds = link.detailNodeIds ?? [];

  return detailNodes.map((node) => {
    const descendantTimes = leafIds
      .map((id) => nodes.get(id))
      .filter((leaf): leaf is TimeNode => Boolean(leaf))
      .filter((leaf) => {
        let current: TimeNode | undefined = leaf;
        const visited = new Set<string>();
        while (current && !visited.has(current.id)) {
          if (current.id === node.id) return true;
          visited.add(current.id);
          current = current.parentId ? nodes.get(current.parentId) : undefined;
        }
        return false;
      })
      .map((leaf) => leaf.time)
      .filter((time) => time >= segmentStart && time <= segmentEnd);
    if (!descendantTimes.length) {
      return { ...node, time: Math.max(segmentStart, Math.min(segmentEnd, node.time)) };
    }
    const first = Math.min(...descendantTimes);
    const last = Math.max(...descendantTimes);
    return {
      ...node,
      time: first === last ? first : first + (last - first) / 2,
      start: first,
      end: last,
      detail: `${descendantTimes.length} 个下级节点 · ${formatSeconds(first)}–${formatSeconds(last)}`,
    };
  });
}

function createTimeLens(experiment: RealExperiment, linkId: string | undefined, scopeId: string | undefined, width: number, maximum: number): TimeLens | null {
  if (!linkId) return null;
  const link = experiment.links.find((item) => item.id === linkId);
  const nodes = new Map(experiment.nodes.map((node) => [node.id, node]));
  const source = link ? nodes.get(link.from) : undefined;
  const target = link ? nodes.get(link.to) : undefined;
  if (!source || !target || source.time === target.time) return null;
  const detailNodes = segmentDetailNodes(experiment, linkId, scopeId);
  if (!detailNodes.length) return null;
  const start = Math.min(source.time, target.time);
  const end = Math.max(source.time, target.time);
  const startTrack = (start / maximum) * 100;
  const endTrack = (end / maximum) * 100;
  const originalSpan = endTrack - startTrack;
  const labelDemand = detailNodes.reduce((sum, node) => sum + Math.min(8, Math.max(2.5, node.label.length * 0.48)), 0);
  const spacingDemand = detailNodes.length * 2.4;
  const requiredSpan = Math.min(34, Math.max(6, labelDemand + spacingDemand));
  const extra = Math.max(0, requiredSpan - originalSpan);
  const displayWidth = width + extra;
  const positionAt = (time: number) => {
    const original = (time / maximum) * 100;
    const distorted = original <= startTrack
      ? original
      : original >= endTrack
        ? original + extra
        : startTrack + (original - startTrack) * ((originalSpan + extra) / originalSpan);
    return (distorted / displayWidth) * 100;
  };
  return {
    start,
    end,
    startX: positionAt(start),
    endX: positionAt(end),
    factor: (originalSpan + extra) / originalSpan,
    pointCount: detailNodes.length,
    displayWidth,
    positionAt,
  };
}

function createDetailLinks(link: TimeLink, detailNodes: TimeNode[]): TimeLink[] {
  if (!detailNodes.length) return [];
  const multiple = detailNodes.length > 1;
  return detailNodes.flatMap((node) => ([
    {
      id: `${link.id}:detail:${node.id}:in`,
      from: link.from,
      to: node.id,
      kind: multiple ? 'branch' as const : 'sequence' as const,
      origin: link.origin,
      interactive: true,
    },
    {
      id: `${link.id}:detail:${node.id}:out`,
      from: node.id,
      to: link.to,
      kind: multiple ? 'join' as const : 'sequence' as const,
      origin: link.origin,
      interactive: true,
    },
  ]));
}

function selectVisibleLabels(nodes: TimeNode[], positionAt: (time: number) => number, laneY: Map<string, number>, zoom: number, selectedId?: string) {
  const result = new Set<string>();
  const accepted = new Map<number, Array<{ position: number; gap: number }>>();
  const priority = (node: TimeNode) => node.id === selectedId ? 100 : node.importance === 'key' ? 80 : node.semanticKind === 'phase' ? 70 : node.importance === 'diagnostic' ? 45 : 20;
  nodes
    .slice()
    .sort((left, right) => priority(right) - priority(left) || left.time - right.time || left.id.localeCompare(right.id))
    .forEach((node) => {
      const lane = Math.round(laneY.get(node.id) ?? MAIN_LANE_Y);
      const position = positionAt(node.time);
      const gap = Math.min(10, Math.max(2.3, node.label.length * 0.42)) / Math.sqrt(Math.max(1, zoom));
      const peers = accepted.get(lane) ?? [];
      if (peers.some((peer) => Math.abs(peer.position - position) < Math.max(peer.gap, gap))) return;
      peers.push({ position, gap });
      accepted.set(lane, peers);
      result.add(node.id);
    });
  return result;
}

function relationPath(link: TimeLink, nodes: Map<string, TimeNode>, laneY: Map<string, number>, positionAt: (time: number) => number) {
  const source = nodes.get(link.from);
  const target = nodes.get(link.to);
  if (!source || !target) return '';
  const x1 = positionAt(source.time);
  const x2 = positionAt(target.time);
  const y1 = laneY.get(source.id) ?? MAIN_LANE_Y;
  const y2 = laneY.get(target.id) ?? MAIN_LANE_Y;
  if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const bend = Math.max(0.8, Math.min(3.2, (x2 - x1) * 0.28));
  if (link.kind === 'branch') return `M ${x1} ${y1} L ${x1 + bend} ${y1} C ${x1 + bend * 1.35} ${y1} ${x2 - bend * 0.7} ${y2} ${x2} ${y2}`;
  return `M ${x1} ${y1} C ${x1 + bend * 0.7} ${y1} ${x2 - bend * 1.35} ${y2} ${x2 - bend} ${y2} L ${x2} ${y2}`;
}

function RelationLayer({
  experiment,
  selectedNodeId,
  focusedStageKey,
  focusedLinkId,
  showDurations,
  positionAt,
  laneY,
  pinnedLinkId,
  expandedLinkId,
  onLinkHover,
  onLinkClick,
  onLinkDoubleClick,
  onOpenMenu,
}: {
  experiment: RealExperiment;
  selectedNodeId?: string;
  focusedStageKey?: string;
  focusedLinkId?: string;
  showDurations: boolean;
  positionAt: (time: number) => number;
  laneY: Map<string, number>;
  pinnedLinkId?: string;
  expandedLinkId?: string;
  onLinkHover: (target?: RelationTarget) => void;
  onLinkClick: (target: RelationTarget) => void;
  onLinkDoubleClick: (target: RelationTarget) => void;
  onOpenMenu: (target: RelationTarget, clientX: number, clientY: number) => void;
}) {
  const nodes = new Map(experiment.nodes.map((node) => [node.id, node]));
  return (
    <>
      <svg className="relation-layer" viewBox="0 0 100 50" preserveAspectRatio="none" role="group" aria-label={`${experiment.shortName} 阶段关系`}>
        {experiment.links.map((link) => {
          const interactive = link.interactive !== false;
          const stageKey = linkStageKey(link, nodes);
          const active = interactive && (focusedStageKey ? focusedStageKey === stageKey : focusedLinkId ? focusedLinkId === link.id : selectedNodeId === link.from || selectedNodeId === link.to);
          const dimmed = interactive && Boolean(focusedStageKey || focusedLinkId || selectedNodeId) && !active;
          const path = relationPath(link, nodes, laneY, positionAt);
          const sourceNode = nodes.get(link.from);
          const targetNode = nodes.get(link.to);
          const x1 = sourceNode ? positionAt(sourceNode.time) : 0;
          const x2 = targetNode ? positionAt(targetNode.time) : 0;
          const y1 = laneY.get(link.from) ?? MAIN_LANE_Y;
          const y2 = laneY.get(link.to) ?? MAIN_LANE_Y;
          const horizontal = Math.abs(y1 - y2) < .1;
          const source = nodes.get(link.from)?.label ?? link.from;
          const target = nodes.get(link.to)?.label ?? link.to;
          const relationTarget = {
            experimentId: experiment.id,
            linkId: link.id,
            stageKey,
            sourceLabel: source,
            targetLabel: target,
            duration: Math.max(0, (targetNode?.time ?? 0) - (sourceNode?.time ?? 0)),
            origin: link.origin,
          };
          const expandable = Boolean(link.detailNodeIds?.length);
          return (
            <g key={link.id}>
              <path
                className={`relation-link relation-${link.kind} origin-${link.origin}${interactive ? ' is-interactive' : ' is-static'}${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}${pinnedLinkId === link.id ? ' is-pinned' : ''}${expandedLinkId === link.id ? ' is-expanded' : ''}${expandable ? ' is-expandable' : ''}`}
                d={path}
                vectorEffect="non-scaling-stroke"
                aria-hidden="true"
              />
              {interactive && (horizontal ? (
                <rect
                  className="relation-hit relation-hit-area"
                  x={Math.min(x1, x2)}
                  y={y1 - 6}
                  width={Math.max(.8, Math.abs(x2 - x1))}
                  height={12}
                  rx={4}
                  tabIndex={0}
                  role="button"
                  aria-pressed={pinnedLinkId === link.id}
                  aria-expanded={expandedLinkId === link.id}
                  aria-label={`${source} 至 ${target} 的时间关系`}
                  onPointerEnter={() => onLinkHover(relationTarget)}
                  onPointerLeave={() => onLinkHover()}
                  onFocus={() => onLinkHover(relationTarget)}
                  onBlur={() => onLinkHover()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onLinkClick(relationTarget);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (expandable) onLinkDoubleClick(relationTarget);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenMenu(relationTarget, event.clientX, event.clientY);
                  }}
                />
              ) : (
                <path
                  className="relation-hit"
                  d={path}
                  vectorEffect="non-scaling-stroke"
                  tabIndex={0}
                  role="button"
                  aria-pressed={pinnedLinkId === link.id}
                  aria-expanded={expandedLinkId === link.id}
                  aria-label={`${source} 至 ${target} 的时间关系`}
                  onPointerEnter={() => onLinkHover(relationTarget)}
                  onPointerLeave={() => onLinkHover()}
                  onFocus={() => onLinkHover(relationTarget)}
                  onBlur={() => onLinkHover()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onLinkClick(relationTarget);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (expandable) onLinkDoubleClick(relationTarget);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenMenu(relationTarget, event.clientX, event.clientY);
                  }}
                />
              ))}
            </g>
          );
        })}
      </svg>
      {showDurations && (focusedStageKey || focusedLinkId) && experiment.links.map((link) => {
        const matchesFocus = focusedStageKey ? linkStageKey(link, nodes) === focusedStageKey : link.id === focusedLinkId;
        if (link.interactive === false || !matchesFocus) return null;
        const source = nodes.get(link.from);
        const target = nodes.get(link.to);
        if (!source || !target) return null;
        const midpoint = positionAt((source.time + target.time) / 2);
        const lane = ((laneY.get(source.id) ?? MAIN_LANE_Y) + (laneY.get(target.id) ?? MAIN_LANE_Y)) / 2;
        const elapsed = Math.max(0, target.time - source.time);
        return (
          <span className="relation-duration" key={`${link.id}-duration`} style={{ left: `${midpoint}%`, top: `${lane}px` }} title={`${source.label} → ${target.label}：${formatSeconds(elapsed)}`}>
            {formatSeconds(elapsed)}
          </span>
        );
      })}
    </>
  );
}

function NodeMarker({
  node,
  position,
  y,
  selected,
  stagePeer,
  relationState,
  showLabel,
  expandable,
  semanticDepth,
  onToggle,
  onDrill,
  onOpenMenu,
}: {
  node: TimeNode;
  position: number;
  y: number;
  selected: boolean;
  stagePeer: boolean;
  relationState: 'idle' | 'endpoint' | 'dimmed' | 'unlinked';
  showLabel: boolean;
  expandable: boolean;
  semanticDepth: number;
  onToggle: (node: TimeNode) => void;
  onDrill: (node: TimeNode) => void;
  onOpenMenu: (node: TimeNode, clientX: number, clientY: number) => void;
}) {
  const edgeClass = position <= 1 ? 'edge-start' : position >= 88 ? 'edge-end' : '';
  const semanticClass = `semantic-${node.semanticKind ?? 'event'}`;
  const importanceClass = `importance-${node.importance ?? 'key'}`;
  const depthClass = `depth-${Math.min(6, semanticDepth)}`;
  return (
    <button
      className={`embedded-node node-${node.kind} ${semanticClass} ${importanceClass} ${depthClass} ${laneClass(y)} ${edgeClass} relation-${relationState}${stagePeer ? ' is-stage-peer' : ''}${selected ? ' is-selected' : ''}${showLabel ? '' : ' is-label-hidden'}${expandable ? ' is-expandable' : ''}`}
      style={{ left: `${position}%`, '--node-y': `${y}px` } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(node);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (expandable) onDrill(node);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(node, event.clientX, event.clientY);
      }}
      aria-label={`${node.label}，${formatSeconds(node.time)}，${node.detail}`}
      aria-pressed={selected}
      title={`${node.label} · ${formatSeconds(node.time)} · ${node.detail}${expandable ? ' · 双击展开下一级' : ''} · 右键打开节点菜单`}
    >
      <span>{node.label}</span>
    </button>
  );
}

function describeNode(node: TimeNode) {
  if (node.label === '引擎启动') return '推理引擎开始初始化。';
  if (node.label === '权重开始') {
    const workers = node.detail.match(/\d+/)?.[0];
    return workers ? `${workers} 个并行 Worker 开始读取模型权重。` : '开始读取模型权重。';
  }
  if (node.kind === 'progress' || node.kind === 'open') return `${node.detail.replace('Safetensors ', '')} 个权重分片已完成读取。`;
  if (node.kind === 'rank') return `${node.label}加载完成，${node.detail.replace('主权重 ', '耗时 ')}。`;
  if (node.kind === 'mtp' && node.label.includes('MTP')) return 'MTP 补充权重加载完成。';
  if (node.kind === 'ready') return '引擎初始化完成，服务进入可用状态。';
  return node.detail;
}

function describeRelations(experiment: RealExperiment, node: TimeNode) {
  const nodeNames = new Map(experiment.nodes.map((item) => [item.id, item.label]));
  const incoming = experiment.links.filter((link) => link.to === node.id);
  const outgoing = experiment.links.filter((link) => link.from === node.id);
  if (!incoming.length && !outgoing.length) return '独立时间段；未确认与相邻节点的衔接关系。';

  const relationMark = (kind: TimeLink['kind']) => kind === 'branch' ? '↗' : kind === 'join' ? '↘' : '→';
  const parts = [
    ...incoming.map((link) => `${nodeNames.get(link.from)} ${relationMark(link.kind)} 当前节点`),
    ...outgoing.map((link) => `当前节点 ${relationMark(link.kind)} ${nodeNames.get(link.to)}`),
  ];
  return `关系：${parts.join('；')}`;
}

function noteRepeatsIdentity(experiment: RealExperiment) {
  const note = experiment.note?.trim().toLocaleLowerCase();
  if (!note) return false;
  return `${experiment.model} ${experiment.shortName}`.toLocaleLowerCase().includes(note);
}

export default function ComparisonWorkbench({ backendExperiments = [], backendEvidenceCount = 0 }: { backendExperiments?: RealExperiment[]; backendEvidenceCount?: number }) {
  const builtInExperiments = useMemo(() => {
    const backend = new Map(backendExperiments.map((item) => [item.id, item]));
    return [
      ...realExperiments.map((item) => backend.get(item.id) ?? item),
      ...backendExperiments.filter((item) => !realExperiments.some((base) => base.id === item.id)),
    ];
  }, [backendExperiments]);
  const [experiments, setExperiments] = useState<RealExperiment[]>(() => builtInExperiments);
  const [visibleIds, setVisibleIds] = useState(() => builtInExperiments.map((item) => item.id));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, RealExperiment>>({});
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [baselineId, setBaselineId] = useState('dtfs-a');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [query, setQuery] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [manageMode, setManageMode] = useState(false);
  const [removeSelection, setRemoveSelection] = useState<string[]>([]);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [editing, setEditing] = useState<RealExperiment | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | undefined>();
  const [currentExperimentId, setCurrentExperimentId] = useState(builtInExperiments[0]?.id ?? '');
  const [labelWidth, setLabelWidth] = useState(162);
  const [hoveredRelation, setHoveredRelation] = useState<RelationTarget | null>(null);
  const [pinnedRelation, setPinnedRelation] = useState<RelationTarget | null>(null);
  const [expandedSegments, setExpandedSegments] = useState<Record<string, ExpandedSegment>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [preferences, setPreferences] = useState<ViewPreferences>(DEFAULT_PREFERENCES);
  const [timelineScale, setTimelineScale] = useState(3);
  const [viewport, setViewport] = useState({ left: 0, width: 100 });
  const [boardWidth, setBoardWidth] = useState(0);
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenu | null>(null);
  const [identityDraft, setIdentityDraft] = useState<{ experimentId: string; field: 'model' | 'shortName'; value: string } | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu | null>(null);
  const [relationContextMenu, setRelationContextMenu] = useState<RelationContextMenu | null>(null);
  const [draggedExperimentId, setDraggedExperimentId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? 'null') as WorkspaceState | null;
        if (stored) {
          const restoredOverrides = stored.overrides ?? {};
          const builtIns = builtInExperiments.map((item) => {
            const override = restoredOverrides[item.id];
            if (!override) return normalizeExperiment(item);
            if (item.source.startsWith('SemanticTimeline') && !override.source.startsWith('SemanticTimeline')) {
              return normalizeExperiment({
                ...item,
                model: override.model || item.model,
                shortName: override.shortName || item.shortName,
                note: override.note,
              });
            }
            return normalizeExperiment(override);
          });
          const imported = (stored.imported ?? []).map((item) => normalizeExperiment(restoredOverrides[item.id] ?? item));
          const restored = [...builtIns, ...imported.filter((item) => !builtIns.some((base) => base.id === item.id))];
          const order = new Map((stored.orderIds ?? []).map((id, index) => [id, index]));
          restored.sort((left, right) => {
            const leftOrder = order.get(left.id);
            const rightOrder = order.get(right.id);
            if (leftOrder === undefined && rightOrder === undefined) return 0;
            if (leftOrder === undefined) return 1;
            if (rightOrder === undefined) return -1;
            return leftOrder - rightOrder;
          });
          setExperiments(restored);
          setOverrides(restoredOverrides);
          const restoredRemovedIds = stored.removedIds ?? [];
          const available = restored.filter((item) => !restoredRemovedIds.includes(item.id));
          setRemovedIds(restoredRemovedIds);
          setVisibleIds(available.map((item) => item.id));
          setBaselineId(available.some((item) => item.id === stored.baselineId)
            ? stored.baselineId!
            : available.find((item) => item.status === 'complete')?.id ?? available[0]?.id ?? '');
        }
      } catch {
        setImportNote('本机修订记录无法读取，已使用原始解析结果');
      }
      try {
        const storedPreferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<ViewPreferences> | null;
        if (storedPreferences) setPreferences({ ...DEFAULT_PREFERENCES, ...storedPreferences });
      } catch {
        setPreferences(DEFAULT_PREFERENCES);
      }
      setWorkspaceReady(true);
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, [builtInExperiments]);

  useEffect(() => {
    const collapseLens = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !Object.keys(expandedSegments).length) return;
      setExpandedSegments({});
      setPinnedRelation(null);
      setHoveredRelation(null);
    };
    window.addEventListener('keydown', collapseLens);
    return () => window.removeEventListener('keydown', collapseLens);
  }, [expandedSegments]);

  useEffect(() => {
    if (!rowContextMenu && !nodeContextMenu && !relationContextMenu) return;
    const close = () => { setRowContextMenu(null); setNodeContextMenu(null); setRelationContextMenu(null); setIdentityDraft(null); };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [nodeContextMenu, relationContextMenu, rowContextMenu]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const update = () => {
      const scrollWidth = Math.max(board.clientWidth, board.scrollWidth);
      setBoardWidth(board.clientWidth);
      setViewport({ left: (board.scrollLeft / scrollWidth) * 100, width: (board.clientWidth / scrollWidth) * 100 });
    };
    update();
    board.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(board);
    return () => {
      board.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const zoomAtPointer = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const next = Math.max(1, Math.min(8, Number((timelineScale * Math.exp(-event.deltaY * .002)).toFixed(1))));
      if (next === timelineScale) return;
      const bounds = board.getBoundingClientRect();
      const pointerX = Math.max(0, Math.min(board.clientWidth, event.clientX - bounds.left));
      const worldAtPointer = (board.scrollLeft + pointerX) / Math.max(board.scrollWidth, 1);
      setTimelineScale(next);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const current = boardRef.current;
        if (!current) return;
        current.scrollLeft = next === 1 ? 0 : Math.max(0, worldAtPointer * current.scrollWidth - pointerX);
      }));
    };
    board.addEventListener('wheel', zoomAtPointer, { passive: false });
    return () => board.removeEventListener('wheel', zoomAtPointer);
  }, [timelineScale]);

  useEffect(() => {
    if (!workspaceReady) return;
    const imported = experiments.filter((item) => !builtInExperiments.some((base) => base.id === item.id));
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ imported, overrides, removedIds, orderIds: experiments.map((item) => item.id), baselineId } satisfies WorkspaceState));
  }, [baselineId, builtInExperiments, experiments, overrides, removedIds, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return;
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences, workspaceReady]);

  const activeExperiments = useMemo(() => experiments.filter((item) => !removedIds.includes(item.id)), [experiments, removedIds]);
  const visibleExperiments = useMemo(() => activeExperiments.filter((item) => visibleIds.includes(item.id)), [activeExperiments, visibleIds]);
  const filteredExperiments = useMemo(() => activeExperiments.filter((item) => {
    const haystack = `${item.model} ${item.shortName} ${item.config} ${item.note ?? ''}`.toLowerCase();
    return (modelFilter === 'all' || item.model === modelFilter)
      && (statusFilter === 'all' || item.status === statusFilter)
      && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [activeExperiments, modelFilter, query, statusFilter]);
  const models = useMemo(() => Array.from(new Set(activeExperiments.map((item) => item.model))), [activeExperiments]);
  const maximumTime = useMemo(() => {
    const longest = Math.max(...visibleExperiments.map((item) => item.total), 300);
    return Math.ceil(longest / 300) * 300;
  }, [visibleExperiments]);
  const tickStep = timelineScale >= 5 ? 60 : timelineScale >= 2.5 ? 120 : 300;
  const ticks = useMemo(() => Array.from({ length: Math.floor(maximumTime / tickStep) + 1 }, (_, index) => index * tickStep), [maximumTime, tickStep]);
  const importedCount = Math.max(0, experiments.length - builtInExperiments.length);
  const logCount = Math.max(realLogCount, backendEvidenceCount) + importedCount;
  const contextExperiment = rowContextMenu ? experiments.find((item) => item.id === rowContextMenu.experimentId) : undefined;
  const metricColumnWidth = 76;
  const timelinePlotWidth = Math.max(1, boardWidth - labelWidth - metricColumnWidth);
  const timelineRowWidth = boardWidth
    ? labelWidth + metricColumnWidth + timelinePlotWidth * timelineScale
    : undefined;

  function toggleExperiment(id: string) {
    const next = visibleIds.includes(id) ? visibleIds.filter((item) => item !== id) : [...visibleIds, id];
    setVisibleIds(next);
    if (baselineId === id && !next.includes(id)) {
      const replacement = experiments.find((item) => next.includes(item.id) && item.status === 'complete')
        ?? experiments.find((item) => next.includes(item.id));
      setBaselineId(replacement?.id ?? '');
    }
  }

  function changeTimelineScale(nextValue: number) {
    const board = boardRef.current;
    const next = Math.max(1, Math.min(8, Number(nextValue.toFixed(1))));
    const center = board ? (board.scrollLeft + board.clientWidth / 2) / Math.max(board.scrollWidth, 1) : 0.5;
    setTimelineScale(next);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const current = boardRef.current;
      if (!current) return;
      current.scrollLeft = Math.max(0, center * current.scrollWidth - current.clientWidth / 2);
      const scrollWidth = Math.max(current.clientWidth, current.scrollWidth);
      setViewport({ left: (current.scrollLeft / scrollWidth) * 100, width: (current.clientWidth / scrollWidth) * 100 });
    }));
  }

  function navigateMinimap(event: ReactPointerEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    const move = (clientX: number) => {
      const board = boardRef.current;
      if (!board) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      board.scrollLeft = Math.max(0, Math.min(board.scrollWidth - board.clientWidth, ratio * board.scrollWidth - board.clientWidth / 2));
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    move(event.clientX);
    const onMove = (pointer: globalThis.PointerEvent) => move(pointer.clientX);
    const onUp = () => {
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
    };
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
  }

  function startColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = labelWidth;
    const move = (moveEvent: globalThis.PointerEvent) => setLabelWidth(Math.max(118, Math.min(300, startWidth + moveEvent.clientX - startX)));
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  }

  async function importLogs(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const parsed = (await Promise.all(files.map(async (file, index) => parseLog(await file.text(), file, index)))).filter((item): item is RealExperiment => Boolean(item));
    if (parsed.length) {
      setExperiments((current) => [...current, ...parsed]);
      setVisibleIds((current) => [...current, ...parsed.map((item) => item.id)]);
      if (!baselineId) setBaselineId(parsed.find((item) => item.status === 'complete')?.id ?? parsed[0].id);
      setImportNote(`已导入 ${parsed.length}/${files.length} 个日志`);
    } else if (files.length) {
      setImportNote('未识别到可定位的加载阶段');
    }
    event.target.value = '';
  }

  function saveExperiment(next: RealExperiment) {
    const normalized = normalizeExperiment(next);
    setExperiments((current) => current.map((item) => item.id === normalized.id ? normalized : item));
    setOverrides((current) => {
      const nextOverrides = { ...current, [normalized.id]: normalized };
      try {
        const stored = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? 'null') as WorkspaceState | null;
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
          imported: stored?.imported ?? [],
          overrides: { ...(stored?.overrides ?? {}), ...nextOverrides },
          removedIds: stored?.removedIds ?? removedIds,
          orderIds: stored?.orderIds ?? experiments.map((item) => item.id),
          baselineId: stored?.baselineId ?? baselineId,
        } satisfies WorkspaceState));
      } catch {
        setImportNote('名称已更新，但本机持久化失败');
      }
      return nextOverrides;
    });
    setEditing(null);
    setEditingNodeId(undefined);
    setSelected(null);
    setImportNote(`已保存 ${normalized.model} · ${normalized.shortName}`);
  }

  function saveNote(experiment: RealExperiment) {
    saveExperiment({ ...experiment, note: noteDraft.trim() });
    setNoteEditingId(null);
  }

  function startIdentityEdit(experiment: RealExperiment, field: 'model' | 'shortName') {
    setIdentityDraft({ experimentId: experiment.id, field, value: experiment[field] });
  }

  function saveIdentityEdit() {
    if (!identityDraft) return;
    const experiment = experiments.find((item) => item.id === identityDraft.experimentId);
    const value = identityDraft.value.trim();
    if (!experiment || !value) {
      setIdentityDraft(null);
      return;
    }
    saveExperiment({ ...experiment, [identityDraft.field]: value });
    setIdentityDraft(null);
  }

  function removeSelectedExperiments() {
    if (!removeSelection.length) return;
    if (removeSelection.includes(baselineId)) {
      const replacement = activeExperiments.find((item) => !removeSelection.includes(item.id) && item.status === 'complete')
        ?? activeExperiments.find((item) => !removeSelection.includes(item.id));
      setBaselineId(replacement?.id ?? '');
    }
    setRemovedIds((current) => Array.from(new Set([...current, ...removeSelection])));
    setVisibleIds((current) => current.filter((id) => !removeSelection.includes(id)));
    setImportNote(`已从工作区移除 ${removeSelection.length} 个实验，可恢复`);
    setRemoveSelection([]);
    setManageMode(false);
  }

  function removeExperiment(id: string) {
    const target = experiments.find((item) => item.id === id);
    if (!target) return;
    setRemovedIds((current) => Array.from(new Set([...current, id])));
    setVisibleIds((current) => current.filter((item) => item !== id));
    if (currentExperimentId === id) {
      setCurrentExperimentId(activeExperiments.find((item) => item.id !== id)?.id ?? '');
    }
    if (baselineId === id) {
      const replacement = activeExperiments.find((item) => item.id !== id && item.status === 'complete')
        ?? activeExperiments.find((item) => item.id !== id);
      setBaselineId(replacement?.id ?? '');
    }
    setRowContextMenu(null);
    setImportNote(`已移除 ${target.model} · ${target.shortName}，可在实验工作区恢复`);
  }

  function openRowContextMenu(experimentId: string, clientX: number, clientY: number) {
    const width = 188;
    const height = 196;
    setCurrentExperimentId(experimentId);
    setNodeContextMenu(null);
    setRelationContextMenu(null);
    setIdentityDraft(null);
    setRowContextMenu({
      experimentId,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, clientX)),
      top: Math.max(8, Math.min(window.innerHeight - height - 8, clientY)),
    });
  }

  function openNodeContextMenu(experiment: RealExperiment, node: TimeNode, clientX: number, clientY: number, expandable: boolean) {
    const width = 238;
    const height = expandable ? 184 : 154;
    setSelected({ experiment, node });
    setCurrentExperimentId(experiment.id);
    setRowContextMenu(null);
    setRelationContextMenu(null);
    setNodeContextMenu({
      experiment,
      node,
      expandable,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, clientX)),
      top: Math.max(8, Math.min(window.innerHeight - height - 8, clientY)),
    });
  }

  function reorderExperiment(sourceId: string, targetId: string, edge: DropTarget['edge']) {
    if (sourceId === targetId) return;
    setExperiments((current) => {
      const source = current.find((item) => item.id === sourceId);
      if (!source) return current;
      const rest = current.filter((item) => item.id !== sourceId);
      const targetIndex = rest.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return current;
      const insertAt = targetIndex + (edge === 'after' ? 1 : 0);
      rest.splice(insertAt, 0, source);
      return rest;
    });
  }

  function restoreRemoved() {
    setRemovedIds([]);
    setImportNote('已恢复全部实验');
  }

  function handleRelationClick(target: RelationTarget) {
    setPinnedRelation((current) => current?.experimentId === target.experimentId && current.linkId === target.linkId ? null : target);
  }

  function toggleRelationExpansion(target: RelationTarget) {
    const experiment = experiments.find((item) => item.id === target.experimentId);
    const canExpand = Boolean(experiment && segmentDetailNodes(experiment, target.linkId).length);
    const isExpanded = expandedSegments[target.experimentId]?.linkId === target.linkId;
    if (!isExpanded && !canExpand) return;
    setExpandedSegments((current) => {
      const next = { ...current };
      if (isExpanded) delete next[target.experimentId];
      else next[target.experimentId] = { linkId: target.linkId, scopeStack: [] };
      return next;
    });
    setPinnedRelation(isExpanded ? null : target);
    setHoveredRelation(null);
    setRelationContextMenu(null);
  }

  function openRelationContextMenu(target: RelationTarget, clientX: number, clientY: number) {
    const experiment = experiments.find((item) => item.id === target.experimentId);
    if (!experiment) return;
    const canExpand = Boolean(segmentDetailNodes(experiment, target.linkId).length);
    const expanded = expandedSegments[target.experimentId]?.linkId === target.linkId;
    setCurrentExperimentId(target.experimentId);
    setPinnedRelation(target);
    setRowContextMenu(null);
    setNodeContextMenu(null);
    setRelationContextMenu({
      ...target,
      canExpand,
      expanded,
      left: Math.max(8, Math.min(window.innerWidth - 238, clientX)),
      top: Math.max(8, Math.min(window.innerHeight - 150, clientY)),
    });
  }

  function drillIntoNode(experimentId: string, node: TimeNode) {
    if (!node.childIds?.length) return;
    setExpandedSegments((current) => {
      const expanded = current[experimentId];
      if (!expanded) return current;
      return { ...current, [experimentId]: { ...expanded, scopeStack: [...expanded.scopeStack, node.id] } };
    });
    setSelected(null);
  }

  function stepOutOfLens(experimentId: string) {
    setExpandedSegments((current) => {
      const expanded = current[experimentId];
      if (!expanded) return current;
      if (!expanded.scopeStack.length) {
        const next = { ...current };
        delete next[experimentId];
        return next;
      }
      return { ...current, [experimentId]: { ...expanded, scopeStack: expanded.scopeStack.slice(0, -1) } };
    });
  }

  function closeLens(experimentId: string) {
    setExpandedSegments((current) => {
      const next = { ...current };
      delete next[experimentId];
      return next;
    });
    setPinnedRelation(null);
    setHoveredRelation(null);
  }

  return (
    <main className="compare-app" style={{ '--run-column': `${labelWidth}px`, '--timeline-width': timelineRowWidth ? `${timelineRowWidth}px` : '100%' } as CSSProperties}>
      <header className="compare-header">
        <div className="compare-title"><span className="mark"><span /></span><h1>模型加载分析</h1></div>
        <div className="header-count"><strong>{visibleExperiments.length}</strong> 个实验<span>{logCount} 个日志</span></div>
      </header>

      <section className="compare-toolbar">
        <div className="mode-title"><strong>实验时间轴</strong>{importNote && <span className="import-note">{importNote}</span>}</div>
        <div className="timeline-navigation" aria-label="时间轴缩放与缩略图">
          <div className="zoom-controls">
            <button aria-label="缩小时间轴" title="缩小" onClick={() => changeTimelineScale(timelineScale - .5)} disabled={timelineScale <= 1}><Minus size={12} /></button>
            <span>{timelineScale.toFixed(1)}×</span>
            <button aria-label="放大时间轴" title="放大" onClick={() => changeTimelineScale(timelineScale + .5)} disabled={timelineScale >= 8}><Plus size={12} /></button>
            <button aria-label="适应全部实验" title="适应全部实验" onClick={() => changeTimelineScale(1)}><Maximize2 size={11} /></button>
          </div>
          <div className="timeline-minimap" onPointerDown={navigateMinimap} role="group" aria-label={`时间轴缩略图，当前窗口起点 ${Math.round(viewport.left)}%`}>
            <div className="minimap-runs">
              {visibleExperiments.map((experiment, index) => <i key={experiment.id} style={{ top: `${((index + .5) / Math.max(1, visibleExperiments.length)) * 100}%`, width: `${(experiment.total / maximumTime) * 100}%` }} />)}
            </div>
            <span className="minimap-window" style={{ left: `${viewport.left}%`, width: `${viewport.width}%` }} />
          </div>
        </div>
        <div className="toolbar-actions">
          <input ref={fileInput} className="file-input" type="file" accept=".log,.txt,text/plain" multiple onChange={importLogs} />
          <button
            className={`tool-button duration-toggle${preferences.showDurations ? ' is-active' : ''}`}
            aria-pressed={preferences.showDurations}
            aria-label={preferences.showDurations ? '隐藏阶段耗时' : '显示阶段耗时'}
            title={preferences.showDurations ? '隐藏阶段耗时' : '显示阶段耗时'}
            onClick={() => setPreferences((current) => ({ ...current, showDurations: !current.showDurations }))}
          >
            <Clock3 size={13} />耗时
          </button>
          <div className="settings-wrap">
            <button className={`tool-button${settingsOpen ? ' is-active' : ''}`} aria-expanded={settingsOpen} onClick={() => { setSettingsOpen((open) => !open); setHelpOpen(false); setPickerOpen(false); }}>
              <Settings2 size={14} />设置
            </button>
            {settingsOpen && (
              <aside className="view-settings" aria-label="时间图显示设置">
                <header>
                  <div><strong>显示设置</strong><small>时间轴显示选项</small></div>
                  <button onClick={() => setSettingsOpen(false)} aria-label="关闭设置"><X size={13} /></button>
                </header>
                <section className="settings-controls">
                  <button
                    className="setting-row"
                    role="switch"
                    aria-checked={preferences.syncStages}
                    onClick={() => setPreferences((current) => ({ ...current, syncStages: !current.syncStages }))}
                  >
                    <span><strong>跨实验联动</strong><small>选中阶段后，突出显示其他实验的对应阶段。</small></span>
                    <i className={preferences.syncStages ? 'switch is-on' : 'switch'}><b /></i>
                  </button>
                  <button
                    className="setting-row"
                    role="switch"
                    aria-checked={preferences.showDurations}
                    onClick={() => setPreferences((current) => ({ ...current, showDurations: !current.showDurations }))}
                  >
                    <span><strong>阶段耗时</strong><small>在线段上显示起点至终点的用时。</small></span>
                    <i className={preferences.showDurations ? 'switch is-on' : 'switch'}><b /></i>
                  </button>
                </section>
              </aside>
            )}
          </div>
          <div className="guide-wrap">
            <button className={`icon-tool-button${helpOpen ? ' is-active' : ''}`} aria-label="打开读图说明" title="读图说明" aria-expanded={helpOpen} onClick={() => { setHelpOpen((open) => !open); setSettingsOpen(false); setPickerOpen(false); }}>
              <CircleHelp size={15} />
            </button>
            {helpOpen && (
              <aside className="timeline-guide" aria-label="时间轴读图说明">
                <header>
                  <div><strong>时间轴图例</strong><small>节点、关系与操作</small></div>
                  <button onClick={() => setHelpOpen(false)} aria-label="关闭说明"><X size={13} /></button>
                </header>
                <section className="relation-guide">
                  <div><i className="guide-line confirmed" /><span><strong>实线</strong><small>日志已确认的流程关系</small></span></div>
                  <div><i className="guide-line inferred" /><span><strong>虚线</strong><small>根据时间与语义推定的关系</small></span></div>
                  <div><i className="guide-node" /><span><strong>灰点</strong><small>未建立直接流程关系的时间点</small></span></div>
                  <div><i className="guide-gap"><b /><b /></i><span><strong>无连线</strong><small>仅保留时间位置</small></span></div>
                </section>
                <section className="guide-actions">
                  <span><b>悬停连线</b> 临时突出阶段</span>
                  <span><b>单击连线</b> 锁定阶段</span>
                  <span><b>双击连线</b> 展开或收起下一级</span>
                  <span><b>单击节点</b> 锁定同阶段节点</span>
                  <span><b>双击节点</b> 进入下一级节点</span>
                  <span><b>上一级／关闭</b> 返回一层或退出细分</span>
                  <span><b>耗时</b> 显示或隐藏阶段用时</span>
                  <span><b>右键节点／连线</b> 打开属性</span>
                  <span><b>右键实验</b> 编辑标签、备注与关系</span>
                  <span><b>Ctrl + 滚轮</b> 围绕鼠标位置缩放</span>
                </section>
              </aside>
            )}
          </div>
          <div className="picker-wrap">
            <button className="tool-button" aria-expanded={pickerOpen} onClick={() => { setPickerOpen((open) => !open); setSettingsOpen(false); setHelpOpen(false); }}>
              <SlidersHorizontal size={14} />实验 {visibleExperiments.length}/{activeExperiments.length}<ChevronDown size={13} />
            </button>
            {pickerOpen && (
              <div className="experiment-picker">
                <div className="picker-head"><div><strong>实验工作区</strong><small>选择、筛选与人工修订</small></div><button onClick={() => setPickerOpen(false)} aria-label="关闭"><X size={13} /></button></div>
                <div className="picker-tools">
                  <button onClick={() => fileInput.current?.click()}><FileUp size={13} />导入 LOG</button>
                  <button className={manageMode ? 'is-active' : ''} onClick={() => { setManageMode((value) => !value); setRemoveSelection([]); }}><Trash2 size={12} />移除</button>
                  {removedIds.length > 0 && <button onClick={restoreRemoved}><RotateCcw size={12} />恢复 {removedIds.length}</button>}
                </div>
                <label className="picker-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型、实验或备注" /></label>
                <div className="picker-filters">
                  <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} aria-label="筛选模型"><option value="all">全部模型</option>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | RunStatus)} aria-label="筛选状态"><option value="all">全部状态</option><option value="complete">已完成</option><option value="partial">未完成</option><option value="evidence-gap">证据残缺</option></select>
                </div>
                <div className="picker-list">
                  {filteredExperiments.map((experiment) => {
                    const checked = visibleIds.includes(experiment.id);
                    const removing = removeSelection.includes(experiment.id);
                    return (
                      <div className={`picker-item${checked ? ' checked' : ''}${removing ? ' removing' : ''}`} key={experiment.id}>
                        <button className="visibility-toggle" onClick={() => toggleExperiment(experiment.id)} aria-label={checked ? '隐藏实验' : '显示实验'}><span className="check-box">{checked && <Check size={11} />}</span></button>
                        <button className="picker-meta" onClick={() => toggleExperiment(experiment.id)}><strong>{experiment.model}</strong><small>{experiment.shortName}</small>{experiment.note && <em>{experiment.note}</em>}</button>
                        {!manageMode && <button className={baselineId === experiment.id ? 'picker-icon is-active' : 'picker-icon'} disabled={experiment.status !== 'complete'} onClick={() => setBaselineId(experiment.id)} title={experiment.status !== 'complete' ? '流程未完成，不能设为基线' : baselineId === experiment.id ? '当前全局对比基线' : '设为全局对比基线'}><Bookmark size={12} /></button>}
                        {manageMode && <button className="remove-check" onClick={() => setRemoveSelection((current) => current.includes(experiment.id) ? current.filter((id) => id !== experiment.id) : [...current, experiment.id])}>{removing ? <Check size={12} /> : <Trash2 size={11} />}</button>}
                      </div>
                    );
                  })}
                  {!filteredExperiments.length && <div className="picker-empty">没有符合条件的实验</div>}
                </div>
                <div className="picker-foot">
                  {manageMode
                    ? <><span>选择要从本机工作区移除的实验</span><button className="danger-action" disabled={!removeSelection.length} onClick={removeSelectedExperiments}>移除 {removeSelection.length || ''}</button></>
                    : <><button onClick={() => setVisibleIds(activeExperiments.map((item) => item.id))}>全选</button><span>基线按模型独立设置</span></>}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="comparison-board" ref={boardRef}>
        <div className="axis-row">
          <span className="axis-label">实验<button className="column-resizer" onPointerDown={startColumnResize} onDoubleClick={() => setLabelWidth(162)} aria-label="调整实验列宽度" title="拖动调整列宽，双击恢复" /></span>
          <div className="shared-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }}>{formatSeconds(tick)}</span>)}</div>
          <span className="axis-metric">全链路</span>
        </div>

        <div className="experiment-list">
          {visibleExperiments.map((experiment) => {
            const width = (experiment.total / maximumTime) * 100;
            const referenceExperiment = activeExperiments.find((item) => item.id === baselineId)
              ?? activeExperiments.find((item) => item.status === 'complete');
            const delta = experiment.status === 'complete' && referenceExperiment?.status === 'complete'
              ? ((experiment.total - referenceExperiment.total) / referenceExperiment.total) * 100
              : undefined;
            const isBaseline = baselineId === experiment.id;
            const experimentNodes = new Map(experiment.nodes.map((node) => [node.id, node]));
            const expanded = expandedSegments[experiment.id];
            const expandedLinkId = expanded?.linkId;
            const expandedLink = expandedLinkId ? experiment.links.find((link) => link.id === expandedLinkId) : undefined;
            const currentScopeId = expanded?.scopeStack.at(-1);
            const semanticNodes = allExperimentNodes(experiment);
            const currentScope = currentScopeId ? semanticNodes.get(currentScopeId) : expandedLink?.scopeNodeId ? semanticNodes.get(expandedLink.scopeNodeId) : undefined;
            const lens = createTimeLens(experiment, expandedLinkId, currentScopeId, width, maximumTime);
            const positionAt = lens?.positionAt ?? ((time: number) => Math.max(0, Math.min(100, (time / experiment.total) * 100)));
            const displayWidth = lens?.displayWidth ?? width;
            const expandedNodes = expandedLinkId ? projectSegmentDetailNodes(experiment, expandedLinkId, currentScopeId) : [];
            const additionalExpandedNodes = expandedNodes.filter((node) => !experimentNodes.has(node.id));
            const expandedNodeIds = new Set(expandedNodes.map((node) => node.id));
            const expandedDetailLinks = expandedLink ? createDetailLinks(expandedLink, expandedNodes) : [];
            const renderExperiment: RealExperiment = expandedNodes.length ? {
              ...experiment,
              nodes: [...experiment.nodes, ...additionalExpandedNodes],
              links: [...experiment.links.filter((link) => link.id !== expandedLinkId), ...expandedDetailLinks],
            } : experiment;
            const renderNodes = new Map(renderExperiment.nodes.map((node) => [node.id, node]));
            const relationFocus = pinnedRelation ?? hoveredRelation;
            const focusApplies = Boolean(relationFocus && (preferences.syncStages || relationFocus.experimentId === experiment.id));
            const focusedLinks = focusApplies && relationFocus
              ? renderExperiment.links.filter((link) => preferences.syncStages ? linkStageKey(link, renderNodes) === relationFocus.stageKey : link.id === relationFocus.linkId)
              : [];
            const laneY = createLaneLayout(renderExperiment);
            const visibleLabels = selectVisibleLabels(renderExperiment.nodes, positionAt, laneY, timelineScale, selected?.experiment.id === experiment.id ? selected.node.id : undefined);
            return (
              <article
                className={`experiment-row${isBaseline ? ' is-baseline' : ''}${currentExperimentId === experiment.id ? ' is-current' : ''}${lens ? ' has-time-lens' : ''}${draggedExperimentId === experiment.id ? ' is-dragging' : ''}${dropTarget?.experimentId === experiment.id ? ` drop-${dropTarget.edge}` : ''}`}
                key={experiment.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openRowContextMenu(experiment.id, event.clientX, event.clientY);
                }}
                onDragOver={(event) => {
                  if (!draggedExperimentId || draggedExperimentId === experiment.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setDropTarget({ experimentId: experiment.id, edge: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedExperimentId && dropTarget?.experimentId === experiment.id) {
                    reorderExperiment(draggedExperimentId, experiment.id, dropTarget.edge);
                  }
                  setDraggedExperimentId(null);
                  setDropTarget(null);
                }}
                title={`${experiment.name} · ${experiment.config}`}
              >
                <div
                  className="experiment-name"
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-pressed={currentExperimentId === experiment.id}
                  aria-label={`选择 ${experiment.model} ${experiment.shortName}；可拖动排序；右键打开属性菜单`}
                  title="单击选择 · 拖动排序 · 右键更多操作"
                  onClick={(event) => { event.stopPropagation(); setCurrentExperimentId(experiment.id); }}
                  onDragStart={(event) => {
                    setDraggedExperimentId(experiment.id);
                    setDropTarget(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', experiment.id);
                  }}
                  onDragEnd={() => { setDraggedExperimentId(null); setDropTarget(null); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setCurrentExperimentId(experiment.id);
                    }
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      openRowContextMenu(experiment.id, bounds.left + 18, bounds.top + 22);
                    }
                  }}
                >
                  <div>
                    {identityDraft?.experimentId === experiment.id && identityDraft.field === 'model'
                      ? <input
                          className="row-identity-input row-model-input"
                          autoFocus
                          aria-label="模型名称"
                          draggable={false}
                          value={identityDraft.value}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setIdentityDraft({ ...identityDraft, value: event.target.value })}
                          onBlur={saveIdentityEdit}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                            if (event.key === 'Escape') { event.preventDefault(); setIdentityDraft(null); }
                          }}
                        />
                      : <strong
                          className="row-model-name"
                          tabIndex={0}
                          title="双击修改模型名称"
                          onDoubleClick={(event) => { event.stopPropagation(); startIdentityEdit(experiment, 'model'); }}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); startIdentityEdit(experiment, 'model'); } }}
                        >{experiment.model}</strong>}
                    {identityDraft?.experimentId === experiment.id && identityDraft.field === 'shortName'
                      ? <input
                          className="row-identity-input"
                          autoFocus
                          aria-label="实验操作"
                          draggable={false}
                          value={identityDraft.value}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setIdentityDraft({ ...identityDraft, value: event.target.value })}
                          onBlur={saveIdentityEdit}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                            if (event.key === 'Escape') { event.preventDefault(); setIdentityDraft(null); }
                          }}
                        />
                      : <span
                          className="row-short-name"
                          tabIndex={0}
                          title="双击修改实验操作"
                          onDoubleClick={(event) => { event.stopPropagation(); startIdentityEdit(experiment, 'shortName'); }}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); startIdentityEdit(experiment, 'shortName'); } }}
                        >{experiment.shortName}</span>}
                    <small className={`run-status status-${experiment.status}`}><i />{experiment.statusLabel}</small>
                    {!lens && (noteEditingId === experiment.id
                      ? <input
                          className="row-note-input"
                          autoFocus
                          aria-label="实验备注"
                          draggable={false}
                          value={noteDraft}
                          placeholder="输入备注"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          onBlur={() => saveNote(experiment)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                            if (event.key === 'Escape') { event.preventDefault(); setNoteDraft(experiment.note ?? ''); event.currentTarget.blur(); }
                          }}
                        />
                      : <small
                          className={experiment.note && !noteRepeatsIdentity(experiment) ? 'human-note row-note-slot' : 'row-note-slot is-empty'}
                          tabIndex={0}
                          title="双击编辑备注"
                          onDoubleClick={(event) => { event.stopPropagation(); setNoteDraft(experiment.note ?? ''); setNoteEditingId(experiment.id); }}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); setNoteDraft(experiment.note ?? ''); setNoteEditingId(experiment.id); } }}
                        >{experiment.note && !noteRepeatsIdentity(experiment) ? <><Pencil size={9} />{experiment.note}</> : '双击添加备注'}</small>)}
                    {lens && (
                      <span className="row-lens-controls" role="group" aria-label={`${currentScope?.label ?? '细分节点'}层级控制`} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          draggable={false}
                          aria-label="返回上一级"
                          title={expanded?.scopeStack.length ? '返回上一级' : '当前已是第一层'}
                          disabled={!expanded?.scopeStack.length}
                          onClick={(event) => { event.stopPropagation(); stepOutOfLens(experiment.id); }}
                        ><ChevronLeft size={9} /><span>上一级</span></button>
                        <button
                          type="button"
                          draggable={false}
                          className={preferences.showDurations ? 'is-active' : ''}
                          aria-pressed={preferences.showDurations}
                          aria-label={preferences.showDurations ? '隐藏阶段耗时' : '显示阶段耗时'}
                          title={preferences.showDurations ? '隐藏阶段耗时' : '显示阶段耗时'}
                          onClick={(event) => { event.stopPropagation(); setPreferences((current) => ({ ...current, showDurations: !current.showDurations })); }}
                        ><Clock3 size={9} /><span>耗时</span></button>
                        <button type="button" draggable={false} aria-label="关闭局部展开" title="关闭局部展开" onClick={(event) => { event.stopPropagation(); closeLens(experiment.id); }}><X size={9} /><span>关闭</span></button>
                      </span>
                    )}
                  </div>
                  <span className="label-actions">
                    <button
                      className={`baseline-toggle${isBaseline ? ' is-active' : ''}`}
                      type="button"
                      draggable={false}
                      disabled={experiment.status !== 'complete'}
                      aria-label={experiment.status !== 'complete' ? '流程未完成，不能设为基线' : isBaseline ? '当前全局对比基线' : `将 ${experiment.model} ${experiment.shortName} 设为全局对比基线`}
                      aria-pressed={isBaseline}
                      title={experiment.status !== 'complete' ? '流程未完成，不能设为基线' : isBaseline ? '当前全局对比基线' : '设为全局对比基线'}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => { event.stopPropagation(); setBaselineId(experiment.id); setCurrentExperimentId(experiment.id); }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    />
                  </span>
                </div>

                <div className="band-column">
                  <div className="band-track">
                    {ticks.map((tick) => <span className="track-grid" key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }} />)}
                    <div
                      className={`jelly-shell status-${experiment.status}`}
                      style={{ width: `${displayWidth}%`, '--band-scale': `${10000 / width}%`, '--mx': '42%', '--my': '8%' } as CSSProperties}
                      onPointerMove={moveJelly}
                      onPointerLeave={resetJelly}
                    >
                      {lens ? (
                        <span className="jelly-color-slices">
                          <i style={{ left: 0, width: `${lens.startX}%`, background: gradientSlice(0, lens.start / maximumTime) }} />
                          <i className="lens-color" style={{ left: `${lens.startX}%`, width: `${lens.endX - lens.startX}%`, background: gradientSlice(lens.start / maximumTime, lens.end / maximumTime) }} />
                          <i style={{ left: `${lens.endX}%`, width: `${100 - lens.endX}%`, background: gradientSlice(lens.end / maximumTime, experiment.total / maximumTime) }} />
                        </span>
                      ) : <span className="jelly-color" />}
                      <span className="jelly-depth" /><span className="jelly-caustic" /><span className="jelly-specular" />
                      {lens && (
                        <span
                          className="time-lens"
                          style={{ left: `${lens.startX}%`, width: `${lens.endX - lens.startX}%` }}
                          title="使用返回或关闭按钮调整细分层级"
                        >
                          <i className="lens-cut cut-start" /><i className="lens-cut cut-end" />
                          <span className="lens-caption">
                            <span className="lens-caption-copy">
                              <strong>{currentScope?.label ?? '细分节点'}</strong>
                              <em>{lens.pointCount} 个节点{lens.factor > 1.05 ? ` · ×${lens.factor.toFixed(1)}` : ''}</em>
                            </span>
                            <span className="lens-caption-actions" role="group" aria-label={`${currentScope?.label ?? '细分节点'}层级控制`}>
                              <button
                                type="button"
                                draggable={false}
                                aria-label="返回上一级"
                                title={expanded?.scopeStack.length ? '返回上一级' : '当前已是第一层'}
                                disabled={!expanded?.scopeStack.length}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => { event.stopPropagation(); stepOutOfLens(experiment.id); }}
                              ><ChevronLeft size={9} /></button>
                              <button
                                type="button"
                                draggable={false}
                                aria-label="关闭局部展开"
                                title="关闭局部展开"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => { event.stopPropagation(); closeLens(experiment.id); }}
                              ><X size={9} /></button>
                            </span>
                          </span>
                        </span>
                      )}
                      <RelationLayer
                        experiment={renderExperiment}
                        selectedNodeId={selected?.experiment.id === experiment.id ? selected.node.id : undefined}
                        focusedStageKey={focusApplies && preferences.syncStages ? relationFocus?.stageKey : undefined}
                        focusedLinkId={focusApplies && !preferences.syncStages ? relationFocus?.linkId : undefined}
                        showDurations={preferences.showDurations}
                        positionAt={positionAt}
                        laneY={laneY}
                        pinnedLinkId={pinnedRelation?.experimentId === experiment.id ? pinnedRelation.linkId : undefined}
                        expandedLinkId={expandedLinkId}
                        onLinkHover={(target) => setHoveredRelation(target ?? null)}
                        onLinkClick={handleRelationClick}
                        onLinkDoubleClick={toggleRelationExpansion}
                        onOpenMenu={openRelationContextMenu}
                      />
                      {renderExperiment.nodes.map((node) => {
                        const hasInteractiveRelation = renderExperiment.links.some((link) => link.interactive !== false && (link.from === node.id || link.to === node.id)) || (expandedNodeIds.has(node.id) && Boolean(node.childIds?.length));
                        const relationState = !hasInteractiveRelation
                          ? 'unlinked'
                          : focusedLinks.length
                            ? focusedLinks.some((link) => link.from === node.id || link.to === node.id) ? 'endpoint' : 'dimmed'
                            : 'idle';
                        const expandable = expandedNodeIds.has(node.id) && Boolean(node.childIds?.length);
                        return <NodeMarker key={node.id} node={node} position={positionAt(node.time)} y={laneY.get(node.id) ?? MAIN_LANE_Y} selected={selected?.experiment.id === experiment.id && selected.node.id === node.id} stagePeer={Boolean(selected && (preferences.syncStages || selected.experiment.id === experiment.id) && nodeStageKey(selected.node) === nodeStageKey(node))} relationState={relationState} showLabel={visibleLabels.has(node.id)} expandable={expandable} semanticDepth={hierarchyDepth(node, semanticNodes)} onToggle={(value) => setSelected((current) => current?.experiment.id === experiment.id && current.node.id === value.id ? null : { experiment: renderExperiment, node: value })} onDrill={(value) => drillIntoNode(experiment.id, value)} onOpenMenu={(value, clientX, clientY) => openNodeContextMenu(experiment, value, clientX, clientY, expandable)} />;
                      })}
                    </div>
                  </div>
                </div>

                <div className="weight-result">
                  <strong>{experiment.status === 'complete' ? formatSeconds(experiment.total) : `T+${formatSeconds(experiment.total)}`}</strong>
                  {delta !== undefined
                    ? <span className={delta <= 0 ? 'faster' : 'slower'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span>
                    : <span className={experiment.status === 'partial' ? 'partial' : 'evidence-gap'}>{experiment.status === 'partial' ? '未完成' : '证据残缺'}</span>}
                </div>
              </article>
            );
          })}
          {!visibleExperiments.length && <div className="empty-state">从“实验”中选择需要对比的记录</div>}
        </div>
      </section>

      {rowContextMenu && contextExperiment && (
        <aside
          className="row-context-menu"
          style={{ left: rowContextMenu.left, top: rowContextMenu.top }}
          role="menu"
          aria-label={`${contextExperiment.model} ${contextExperiment.shortName} 属性菜单`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header><strong>{contextExperiment.model}</strong><span>{contextExperiment.shortName}</span></header>
          <button role="menuitem" onClick={() => { setEditingNodeId(undefined); setEditing(contextExperiment); setRowContextMenu(null); }}><Pencil size={12} /><span>编辑流程</span></button>
          <button role="menuitem" disabled={contextExperiment.status !== 'complete'} onClick={() => { setBaselineId(contextExperiment.id); setRowContextMenu(null); }}><Bookmark size={12} /><span>{contextExperiment.status === 'complete' ? '设为全局基线' : '未完成，不能设为基线'}</span></button>
          <button role="menuitem" onClick={() => { setVisibleIds([contextExperiment.id]); setRowContextMenu(null); }}><Eye size={12} /><span>仅显示此实验</span></button>
          <i />
          <button className="context-danger" role="menuitem" onClick={() => removeExperiment(contextExperiment.id)}><Trash2 size={12} /><span>从工作区移除</span></button>
        </aside>
      )}

      {relationContextMenu && (() => {
        const experiment = experiments.find((item) => item.id === relationContextMenu.experimentId);
        const link = experiment?.links.find((item) => item.id === relationContextMenu.linkId);
        const nodes = new Map(experiment?.nodes.map((node) => [node.id, node]) ?? []);
        const source = link ? nodes.get(link.from) : undefined;
        const target = link ? nodes.get(link.to) : undefined;
        return (
          <aside
            className="node-context-menu relation-context-menu"
            style={{ left: relationContextMenu.left, top: relationContextMenu.top }}
            role="menu"
            aria-label="阶段关系菜单"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header><strong>{source?.label ?? relationContextMenu.sourceLabel} → {target?.label ?? relationContextMenu.targetLabel}</strong><span>{formatSeconds(source && target ? Math.max(0, target.time - source.time) : relationContextMenu.duration)}</span></header>
            <p>{(link?.origin ?? relationContextMenu.origin) === 'declared' ? '日志或配置已确认该流程关系。' : '该关系由现有时间证据推定。'}</p>
            {relationContextMenu.canExpand || relationContextMenu.expanded
              ? <button role="menuitem" onClick={() => toggleRelationExpansion(relationContextMenu)}><ChevronDown size={12} /><span>{relationContextMenu.expanded ? '收起细分节点' : '展开细分节点'}</span></button>
              : <p className="node-context-relation">当前阶段没有可展开的下级节点。</p>}
          </aside>
        );
      })()}

      {nodeContextMenu && (
        <aside
          className="node-context-menu"
          style={{ left: nodeContextMenu.left, top: nodeContextMenu.top }}
          role="menu"
          aria-label={`${nodeContextMenu.node.label} 节点菜单`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header><strong>{nodeContextMenu.node.label}</strong><span>T+{formatSeconds(nodeContextMenu.node.time)}</span></header>
          <p>{describeNode(nodeContextMenu.node)}</p>
          <p className="node-context-relation">{describeRelations(nodeContextMenu.experiment, nodeContextMenu.node)}</p>
          {nodeContextMenu.expandable && <button role="menuitem" onClick={() => { drillIntoNode(nodeContextMenu.experiment.id, nodeContextMenu.node); setNodeContextMenu(null); }}><ChevronDown size={12} /><span>展开下级节点</span></button>}
          {nodeContextMenu.experiment.nodes.some((node) => node.id === nodeContextMenu.node.id) && <button role="menuitem" onClick={() => { setEditingNodeId(nodeContextMenu.node.id); setEditing(nodeContextMenu.experiment); setNodeContextMenu(null); }}><Pencil size={12} /><span>编辑此节点</span></button>}
        </aside>
      )}

      {editing && <ExperimentEditor experiment={editing} initialNodeId={editingNodeId} onCancel={() => { setEditing(null); setEditingNodeId(undefined); }} onSave={saveExperiment} />}

      <footer className="compare-footer">
          <span>数据快照 <code>KeyanHu-workspace</code></span>
        <span>2026-08-25 10:33 · {logCount} logs · {activeExperiments.length} runs</span>
      </footer>
    </main>
  );
}
