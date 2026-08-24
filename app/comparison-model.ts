export type NodeKind = 'start' | 'progress' | 'rank' | 'mtp' | 'ready' | 'open';

export interface TimeNode {
  id: string;
  label: string;
  time: number;
  kind: NodeKind;
  lane?: 0 | 1;
  detail: string;
  locator: string;
}

export interface RealExperiment {
  id: string;
  name: string;
  shortName: string;
  config: string;
  date: string;
  total: number;
  mainWeight?: number;
  complete: boolean;
  source: string;
  nodes: TimeNode[];
}

export const maximumTime = 1500;
export const baselineWeight = 1163.48;

export const realExperiments: RealExperiment[] = [
  {
    id: 'dtfs-a',
    name: 'DTFS · DP2 / 第一次',
    shortName: 'DTFS · DP2-A',
    config: 'TP8 · DP2 · EP · vLLM 0.25.1',
    date: '08-21 15:29',
    total: 1500,
    mainWeight: 1163.48,
    complete: true,
    source: 'model-load-benchmark/runs/deepseek-v4-flash-load-20260821/service/rank-000.log',
    nodes: [
      { id: 'a-engine', label: '引擎启动', time: 0, kind: 'start', detail: 'EngineCore 开始初始化', locator: 'L103' },
      { id: 'a-load', label: '权重开始', time: 100, kind: 'start', detail: '16 个 Worker 开始加载模型', locator: 'L431–474' },
      { id: 'a-17', label: '权重 17%', time: 299, kind: 'progress', detail: 'Safetensors 12/70', locator: 'L513' },
      { id: 'a-dp0', label: 'DP0 权重', time: 1343, kind: 'rank', lane: 0, detail: '主权重 1163.06 s', locator: 'L575' },
      { id: 'a-dp1', label: 'DP1 权重', time: 1343, kind: 'rank', lane: 1, detail: '主权重 1163.48 s', locator: 'L574' },
      { id: 'a-mtp', label: 'MTP 权重', time: 1366, kind: 'mtp', detail: 'MTP 权重完成', locator: 'L788–852' },
      { id: 'a-ready', label: '服务就绪', time: 1500, kind: 'ready', detail: 'Engine 初始化完成', locator: 'L1075–1076' },
    ],
  },
  {
    id: 'dtfs-b',
    name: 'DTFS · DP2 / 第二次',
    shortName: 'DTFS · DP2-B',
    config: 'TP8 · DP2 · EP · vLLM 0.25.1',
    date: '08-21 19:48',
    total: 1437,
    mainWeight: 1177.04,
    complete: true,
    source: 'model-load-benchmark/runs/deepseek-v4-flash-load-20260821/service/rank-000.log',
    nodes: [
      { id: 'b-engine', label: '引擎启动', time: 0, kind: 'start', detail: 'EngineCore 开始初始化', locator: 'L1275' },
      { id: 'b-load', label: '权重开始', time: 102, kind: 'start', detail: '16 个 Worker 开始加载模型', locator: 'L1611–1648' },
      { id: 'b-17', label: '权重 17%', time: 301, kind: 'progress', detail: 'Safetensors 12/70', locator: 'L1686' },
      { id: 'b-dp0', label: 'DP0 权重', time: 1337, kind: 'rank', lane: 0, detail: '主权重 1177.04 s', locator: 'L1748' },
      { id: 'b-dp1', label: 'DP1 权重', time: 1337, kind: 'rank', lane: 1, detail: '主权重 1176.96 s', locator: 'L1747' },
      { id: 'b-mtp', label: 'MTP 权重', time: 1362, kind: 'mtp', detail: 'MTP 权重完成', locator: 'L2020–2025' },
      { id: 'b-ready', label: '服务就绪', time: 1437, kind: 'ready', detail: 'Engine 初始化完成', locator: 'L2281–2282' },
    ],
  },
  {
    id: 'dtfs-dp1',
    name: 'DTFS · DP1',
    shortName: 'DTFS · DP1',
    config: 'TP8 · DP1 · EP · vLLM 0.13.0',
    date: '08-22 15:40',
    total: 367,
    mainWeight: 238.27,
    complete: false,
    source: 'deepseek-load-analysis/runs/dsv4-dp1-load-20260822/service/rank-000.log',
    nodes: [
      { id: 'd-engine', label: '引擎启动', time: 0, kind: 'start', detail: 'EngineCore 开始初始化', locator: 'L37' },
      { id: 'd-load', label: '权重开始', time: 81, kind: 'start', detail: '8 个 Worker 开始加载模型', locator: 'L205–213' },
      { id: 'd-17', label: '权重 17%', time: 119, kind: 'progress', detail: 'Safetensors 12/70', locator: 'L290' },
      { id: 'd-main', label: '主权重', time: 339, kind: 'rank', lane: 1, detail: '主权重 238.27 s', locator: 'L351' },
      { id: 'd-mtp', label: 'MTP 权重', time: 367, kind: 'mtp', detail: 'MTP 权重完成；日志未记录服务就绪', locator: 'L438' },
    ],
  },
  {
    id: 'prefetch',
    name: 'DTFS · Prefetch',
    shortName: 'DTFS · Prefetch',
    config: 'TP8 · DP2 · EP · 运行未完成',
    date: '08-22 16:57',
    total: 280,
    complete: false,
    source: 'deepseek-load-analysis/runs/dsv4-dp2-tp8-prefetch-20260822-r2/service/rank-000.log',
    nodes: [
      { id: 'p-engine', label: '引擎启动', time: 0, kind: 'start', detail: 'EngineCore 开始初始化', locator: 'L63' },
      { id: 'p-load', label: '权重开始', time: 88, kind: 'start', detail: '16 个 Worker 开始加载模型', locator: 'L336–415' },
      { id: 'p-17', label: '权重 12/70', time: 280, kind: 'open', detail: '192 s 到达 12/70，实验在此终止', locator: 'L556' },
    ],
  },
  {
    id: 'ram-cold',
    name: 'RAM Disk · 冷缓存',
    shortName: 'RAM · 冷缓存',
    config: 'TP8 · DP2 · EP · 双节点关键路径',
    date: '08-24 11:33',
    total: 310,
    mainWeight: 53.31,
    complete: true,
    source: 'deepseek-load-analysis/runs/dsv4-ramdisk-cold-dp2tp8-20260824/service/rank-{000,001}.log',
    nodes: [
      { id: 'c-engine', label: '引擎启动', time: 0, kind: 'start', detail: '两个节点开始 EngineCore 初始化', locator: 'L48' },
      { id: 'c-load', label: '权重开始', time: 87, kind: 'start', detail: '从 /dev/shm 开始加载模型', locator: 'L327–400' },
      { id: 'c-17', label: '权重 17%', time: 93, kind: 'progress', detail: 'Safetensors 12/70', locator: 'L538' },
      { id: 'c-dp0', label: 'DP0 权重', time: 149, kind: 'rank', lane: 0, detail: '节点0主权重 44.71 s', locator: 'rank-000 L599–600' },
      { id: 'c-dp1', label: 'DP1 权重', time: 158, kind: 'rank', lane: 1, detail: '节点1主权重 53.31 s', locator: 'rank-001 L599–600' },
      { id: 'c-mtp', label: 'MTP 权重', time: 186, kind: 'mtp', detail: '较慢节点MTP完成', locator: 'rank-001 L735–736' },
      { id: 'c-ready', label: '服务就绪', time: 310, kind: 'ready', detail: '较慢节点 Engine 初始化完成', locator: 'rank-001 L818–819' },
    ],
  },
  {
    id: 'ram-warm',
    name: 'RAM Disk · 热缓存',
    shortName: 'RAM · 热缓存',
    config: 'TP8 · DP2 · EP · 双节点关键路径',
    date: '08-24 10:42',
    total: 314,
    mainWeight: 51.75,
    complete: true,
    source: 'deepseek-load-analysis/runs/dsv4-ramdisk-dp2tp8-20260824/service/rank-{000,001}.log',
    nodes: [
      { id: 'w-engine', label: '引擎启动', time: 0, kind: 'start', detail: '两个节点开始 EngineCore 初始化', locator: 'L48' },
      { id: 'w-load', label: '权重开始', time: 88, kind: 'start', detail: '从 /dev/shm 开始加载模型', locator: 'L319–400' },
      { id: 'w-17', label: '权重 17%', time: 92, kind: 'progress', detail: 'Safetensors 12/70', locator: 'L538–539' },
      { id: 'w-dp1', label: 'DP1 权重', time: 139, kind: 'rank', lane: 0, detail: '节点1主权重 34.12 s', locator: 'rank-001 L597–601' },
      { id: 'w-dp0', label: 'DP0 权重', time: 158, kind: 'rank', lane: 1, detail: '节点0主权重 51.75 s', locator: 'rank-000 L596–600' },
      { id: 'w-mtp', label: 'MTP 权重', time: 190, kind: 'mtp', detail: '较慢节点MTP完成', locator: 'L735–737' },
      { id: 'w-ready', label: '服务就绪', time: 314, kind: 'ready', detail: '较慢节点 Engine 初始化完成', locator: 'rank-000 L817–819' },
    ],
  },
];

export function formatSeconds(value: number) {
  if (value < 60) return `${value.toFixed(value % 1 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}
