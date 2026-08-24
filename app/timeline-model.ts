export type TimelineKind = 'activity' | 'extent' | 'milestone' | 'open' | 'unlocated';
export type TimelineState = 'confirmed' | 'inferred' | 'partial' | 'conflict';

export interface EvidenceRef {
  id: string;
  source: string;
  locator: string;
  excerpt: string;
  observedAt: string;
  parser: string;
}

export interface TimelineNode {
  id: string;
  label: string;
  detail: string;
  kind: TimelineKind;
  state: TimelineState;
  start?: number;
  end?: number;
  evidence: EvidenceRef[];
  children?: TimelineNode[];
}

export interface ExperimentRun {
  id: string;
  name: string;
  subtitle: string;
  duration?: number;
  completeness: number;
  state: TimelineState;
  nodes: TimelineNode[];
}

export interface VisibleRow {
  key: string;
  runId: string;
  type: 'run' | 'node';
  depth: number;
  run: ExperimentRun;
  node?: TimelineNode;
  hasChildren: boolean;
  expanded: boolean;
}

const evidence = (
  id: string,
  source: string,
  locator: string,
  excerpt: string,
  observedAt = '2026-08-24 18:42:16',
): EvidenceRef => ({ id, source, locator, excerpt, observedAt, parser: 'load-event-parser@0.3.1' });

export const experimentRuns: ExperimentRun[] = [
  {
    id: 'run-baseline', name: 'V0 · DTFS 基线', subtitle: 'TP8 · DP2 · EP · 16 NPU',
    duration: 1268, completeness: 92, state: 'confirmed',
    nodes: [
      {
        id: 'baseline-prepare', label: '准备资源', detail: 'Pod 调度、运行目录与通信环境完成',
        kind: 'activity', state: 'confirmed', start: 0, end: 74,
        evidence: [evidence('ev-001', 'scheduler.log', 'L18–L31', '16 devices visible; world_size=16')],
      },
      {
        id: 'baseline-load', label: '加载模型权重', detail: '折叠时展示子阶段时间包络，不将并行耗时相加',
        kind: 'extent', state: 'confirmed', start: 92, end: 1177,
        evidence: [evidence('ev-014', 'worker_0.log', 'L904', 'Loading weights took 1084.88 seconds')],
        children: [
          {
            id: 'baseline-dp0', label: 'DP0 · 主权重', detail: 'Rank 0–7 从共享 DTFS 读取并装载负责的权重',
            kind: 'activity', state: 'confirmed', start: 92, end: 1156,
            evidence: [evidence('ev-021', 'worker_0.log', 'L511–L904', 'rank=0 loading safetensors shards 1/70 ... 70/70')],
          },
          {
            id: 'baseline-dp1', label: 'DP1 · 主权重', detail: 'Rank 8–15 与 DP0 重叠读取；轨道只在本阶段分配',
            kind: 'activity', state: 'confirmed', start: 108, end: 1177,
            evidence: [evidence('ev-022', 'worker_8.log', 'L492–L887', 'rank=8 loading safetensors shards 1/70 ... 70/70')],
          },
          {
            id: 'baseline-mtp', label: 'MTP 权重处理', detail: '与主权重后段交叠，时间来自日志语义节点',
            kind: 'activity', state: 'inferred', start: 1018, end: 1168,
            evidence: [evidence('ev-023', 'worker_0.log', 'L836–L872', 'initializing MTP layer weights')],
          },
        ],
      },
      {
        id: 'baseline-engine', label: '初始化推理引擎', detail: '权重装载完成后的引擎初始化阶段',
        kind: 'activity', state: 'confirmed', start: 1177, end: 1241,
        evidence: [evidence('ev-031', 'engine.log', 'L1042–L1085', 'engine core initialization completed')],
      },
      {
        id: 'baseline-health', label: '服务可用验证', detail: '健康检查通过，完成时间单独表达',
        kind: 'milestone', state: 'confirmed', start: 1268, end: 1268,
        evidence: [evidence('ev-034', 'probe.log', 'L12', 'GET /health 200 OK')],
      },
    ],
  },
  {
    id: 'run-prefetch', name: 'V1 · Prefetch', subtitle: '同镜像 · 同拓扑 · 数据不完整',
    completeness: 61, state: 'partial',
    nodes: [
      {
        id: 'prefetch-prepare', label: '准备资源', detail: '已定位开始与结束',
        kind: 'activity', state: 'confirmed', start: 0, end: 79,
        evidence: [evidence('ev-101', 'scheduler.log', 'L16–L27', 'allocated 16 NPU devices')],
      },
      {
        id: 'prefetch-load', label: '加载模型权重', detail: '仅定位开始边界；开放端延伸至最后数据水位',
        kind: 'open', state: 'partial', start: 96, end: 1094,
        evidence: [evidence('ev-114', 'worker_0.log', 'L488', 'begin loading model weights')],
      },
      {
        id: 'prefetch-missing', label: '完成验证', detail: '缺少可定位时间，不生成虚假坐标',
        kind: 'unlocated', state: 'partial',
        evidence: [evidence('ev-129', 'collector.json', '$.warnings[2]', 'remote stream ended before service probe')],
      },
    ],
  },
  {
    id: 'run-ramdisk', name: 'V2 · RAM Disk', subtitle: 'DTFS → /dev/shm → vLLM',
    duration: 734, completeness: 86, state: 'inferred',
    nodes: [
      {
        id: 'ram-copy', label: '复制模型至内存盘', detail: '从共享 DTFS 复制到节点 CPU 内存中的 tmpfs',
        kind: 'activity', state: 'confirmed', start: 0, end: 236,
        evidence: [evidence('ev-201', 'stage-model.log', 'L3–L21', 'copy complete: /models/share → /dev/shm')],
      },
      {
        id: 'ram-load', label: '从 tmpfs 加载权重', detail: '当前为解释提案，需人工确认边界',
        kind: 'activity', state: 'inferred', start: 251, end: 674,
        evidence: [evidence('ev-214', 'worker_0.log', 'L501–L792', 'model path: /dev/shm/DeepSeek-V4-Flash-w8a8-mtp')],
      },
      {
        id: 'ram-health', label: '服务可用验证', detail: '健康检查通过',
        kind: 'milestone', state: 'confirmed', start: 734, end: 734,
        evidence: [evidence('ev-227', 'probe.log', 'L19', 'GET /health 200 OK')],
      },
    ],
  },
];

export const timelineDomain: [number, number] = [0, 1320];

export function flattenVisibleRows(runs: ExperimentRun[], expanded: Set<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const appendNodes = (run: ExperimentRun, nodes: TimelineNode[], depth: number) => {
    nodes.forEach((node) => {
      const hasChildren = Boolean(node.children?.length);
      const isExpanded = hasChildren && expanded.has(node.id);
      rows.push({ key: `${run.id}:${node.id}`, runId: run.id, type: 'node', depth, run, node, hasChildren, expanded: isExpanded });
      if (isExpanded && node.children) appendNodes(run, node.children, depth + 1);
    });
  };
  runs.forEach((run) => {
    rows.push({ key: run.id, runId: run.id, type: 'run', depth: 0, run, hasChildren: true, expanded: expanded.has(run.id) });
    if (expanded.has(run.id)) appendNodes(run, run.nodes, 1);
  });
  return rows;
}

export function formatTime(seconds?: number) {
  if (seconds === undefined) return '未定位';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${rest.toString().padStart(2, '0')}s` : `${rest}s`;
}

export function findNode(id: string) {
  for (const run of experimentRuns) {
    const stack = [...run.nodes];
    while (stack.length) {
      const node = stack.shift()!;
      if (node.id === id) return { node, run };
      if (node.children) stack.unshift(...node.children);
    }
  }
  return undefined;
}
