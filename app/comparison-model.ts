export type NodeKind = 'start' | 'progress' | 'rank' | 'mtp' | 'ready' | 'open';
export type LinkKind = 'sequence' | 'branch' | 'join';
export type LinkOrigin = 'observed' | 'declared' | 'inferred' | 'fallback';
export type RunStatus = 'complete' | 'partial' | 'evidence-gap';

export interface TimeNode {
  id: string;
  label: string;
  time: number;
  kind: NodeKind;
  lane?: 0 | 1;
  detail: string;
  locator: string;
}

export interface TimeLink {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  origin: LinkOrigin;
  interactive?: boolean;
}

export interface RealExperiment {
  id: string;
  name: string;
  model: string;
  shortName: string;
  config: string;
  date: string;
  total: number;
  mainWeight?: number;
  status: RunStatus;
  statusLabel: string;
  note?: string;
  source: string;
  nodes: TimeNode[];
  links: TimeLink[];
}

export type ExperimentEvidence = Omit<RealExperiment, 'status' | 'statusLabel'>;

export const maximumTime = 1500;
export const baselineWeight = 1163.48;
export const realLogCount = 17;

function relation(id: string, from: string, to: string, kind: LinkKind = 'sequence', origin: LinkOrigin = 'observed', interactive = true): TimeLink {
  return { id, from, to, kind, origin, interactive };
}

const experimentEvidence: ExperimentEvidence[] = [
  {
    id: 'dtfs-a',
    name: 'DTFS · DP2 / 第一次',
    model: 'DeepSeek-V4',
    shortName: 'DTFS · DP2-A',
    config: 'TP8 · DP2 · EP · vLLM 0.25.1',
    date: '08-21 15:29',
    total: 1500,
    mainWeight: 1163.48,
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
    links: [
      relation('a-r1', 'a-engine', 'a-load'),
      relation('a-r2', 'a-load', 'a-17'),
      relation('a-r3', 'a-17', 'a-dp0', 'branch'),
      relation('a-r4', 'a-17', 'a-dp1', 'branch'),
      relation('a-r5', 'a-dp0', 'a-mtp', 'join'),
      relation('a-r6', 'a-dp1', 'a-mtp', 'join'),
      relation('a-r7', 'a-mtp', 'a-ready'),
    ],
  },
  {
    id: 'dtfs-b',
    name: 'DTFS · DP2 / 第二次',
    model: 'DeepSeek-V4',
    shortName: 'DTFS · DP2-B',
    config: 'TP8 · DP2 · EP · vLLM 0.25.1',
    date: '08-21 19:48',
    total: 1437,
    mainWeight: 1177.04,
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
    links: [
      relation('b-r1', 'b-engine', 'b-load'),
      relation('b-r2', 'b-load', 'b-17'),
      relation('b-r3', 'b-17', 'b-dp0', 'branch'),
      relation('b-r4', 'b-17', 'b-dp1', 'branch'),
      relation('b-r5', 'b-dp0', 'b-mtp', 'join'),
      relation('b-r6', 'b-dp1', 'b-mtp', 'join'),
      relation('b-r7', 'b-mtp', 'b-ready'),
    ],
  },
  {
    id: 'dtfs-dp1',
    name: 'DTFS · DP1',
    model: 'DeepSeek-V4',
    shortName: 'DTFS · DP1',
    config: 'TP8 · DP1 · EP · vLLM 0.13.0',
    date: '08-22 15:40',
    total: 367,
    mainWeight: 238.27,
    source: 'deepseek-load-analysis/runs/dsv4-dp1-load-20260822/service/rank-000.log',
    nodes: [
      { id: 'd-engine', label: '引擎启动', time: 0, kind: 'start', detail: 'EngineCore 开始初始化', locator: 'L37' },
      { id: 'd-load', label: '权重开始', time: 81, kind: 'start', detail: '8 个 Worker 开始加载模型', locator: 'L205–213' },
      { id: 'd-17', label: '权重 17%', time: 119, kind: 'progress', detail: 'Safetensors 12/70', locator: 'L290' },
      { id: 'd-main', label: '主权重', time: 339, kind: 'rank', lane: 1, detail: '主权重 238.27 s', locator: 'L351' },
      { id: 'd-mtp', label: 'MTP 权重', time: 367, kind: 'mtp', detail: 'MTP 权重完成；日志未记录服务就绪', locator: 'L438' },
    ],
    links: [
      relation('d-r1', 'd-engine', 'd-load'),
      relation('d-r2', 'd-load', 'd-17'),
      relation('d-r3', 'd-17', 'd-main'),
      relation('d-r4', 'd-main', 'd-mtp'),
    ],
  },
  {
    id: 'prefetch',
    name: 'DTFS · Prefetch',
    model: 'DeepSeek-V4',
    shortName: 'DTFS · Prefetch',
    config: 'TP8 · DP2 · EP · 运行未完成',
    date: '08-22 16:57',
    total: 280,
    source: 'deepseek-load-analysis/runs/dsv4-dp2-tp8-prefetch-20260822-r2/service/rank-000.log',
    nodes: [
      { id: 'p-engine', label: '引擎启动', time: 0, kind: 'start', detail: 'EngineCore 开始初始化', locator: 'L63' },
      { id: 'p-load', label: '权重开始', time: 88, kind: 'start', detail: '16 个 Worker 开始加载模型', locator: 'L336–415' },
      { id: 'p-17', label: '权重 12/70', time: 280, kind: 'open', detail: '192 s 到达 12/70，实验在此终止', locator: 'L556' },
    ],
    links: [
      relation('p-r1', 'p-engine', 'p-load'),
      relation('p-r2', 'p-load', 'p-17'),
    ],
  },
  {
    id: 'ram-cold',
    name: 'RAM Disk · 冷缓存',
    model: 'DeepSeek-V4',
    shortName: 'RAM · 冷缓存',
    config: 'TP8 · DP2 · EP · 双节点关键路径',
    date: '08-24 11:33',
    total: 310,
    mainWeight: 53.31,
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
    links: [
      relation('c-r1', 'c-engine', 'c-load'),
      relation('c-r2', 'c-load', 'c-17'),
      relation('c-r3', 'c-17', 'c-dp0', 'branch'),
      relation('c-r4', 'c-17', 'c-dp1', 'branch'),
      relation('c-r5', 'c-dp0', 'c-mtp', 'join'),
      relation('c-r6', 'c-dp1', 'c-mtp', 'join'),
      relation('c-r7', 'c-mtp', 'c-ready'),
    ],
  },
  {
    id: 'ram-warm',
    name: 'RAM Disk · 热缓存',
    model: 'DeepSeek-V4',
    shortName: 'RAM · 热缓存',
    config: 'TP8 · DP2 · EP · 双节点关键路径',
    date: '08-24 10:42',
    total: 314,
    mainWeight: 51.75,
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
    links: [
      relation('w-r1', 'w-engine', 'w-load'),
      relation('w-r2', 'w-load', 'w-17'),
      relation('w-r3', 'w-17', 'w-dp1', 'branch'),
      relation('w-r4', 'w-17', 'w-dp0', 'branch'),
      relation('w-r5', 'w-dp1', 'w-mtp', 'join'),
      relation('w-r6', 'w-dp0', 'w-mtp', 'join'),
      relation('w-r7', 'w-mtp', 'w-ready'),
    ],
  },
  {
    id: 'glm-ram-cold',
    name: 'RAM Disk · 冷启动',
    model: 'GLM-5.2 W8A8',
    shortName: 'RAM · 冷启动',
    config: 'TP16 · DP2 · EP · 32 NPU · 冷预置全链路',
    date: '08-24 13:08',
    total: 1447,
    mainWeight: 72.71,
    source: 'deepseek-load-analysis/runs/{stage-glm52-w8a8-ramdisk-1500g-cold,glm52-w8a8-ramdisk-1500g-dp2tp16}-20260824',
    nodes: [
      { id: 'gc-stage-start', label: '预置开始', time: 0, kind: 'start', detail: '两个节点从 DTFS 冷读模型并写入 RAM Disk', locator: 'stage rank-000 L1' },
      { id: 'gc-stage-end', label: '预置完成', time: 752, kind: 'start', detail: '关键路径节点完成 743.10 GiB 模型预置', locator: 'stage rank-000 L3' },
      { id: 'gc-vllm', label: 'vLLM 启动', time: 861, kind: 'start', detail: '跨节点 vLLM 服务开始启动', locator: '模型加载速度实验 L198–200' },
      { id: 'gc-engine', label: '引擎初始化', time: 930, kind: 'start', detail: '两个 DP 实例开始建立 EngineCore', locator: 'service rank-{000,001} L63/L49' },
      { id: 'gc-load', label: '权重开始', time: 1113, kind: 'start', detail: '32 个 Worker 从 RAM Disk 开始加载主权重', locator: 'service rank-{000,001} L572/L484' },
      { id: 'gc-dp0', label: 'DP0 权重', time: 1196, kind: 'rank', lane: 0, detail: 'DP0 主权重 65.72 s', locator: 'service rank-000 L802' },
      { id: 'gc-dp1', label: 'DP1 权重', time: 1203, kind: 'rank', lane: 1, detail: 'DP1 主权重 72.71 s', locator: 'service rank-001 L537' },
      { id: 'gc-mtp0', label: 'MTP · DP0', time: 1218, kind: 'mtp', lane: 0, detail: 'DP0 MTP 权重 1.12 s', locator: 'service rank-000 L920' },
      { id: 'gc-mtp1', label: 'MTP · DP1', time: 1224, kind: 'mtp', lane: 1, detail: 'DP1 MTP 权重 1.52 s', locator: 'service rank-001 L637' },
      { id: 'gc-graph', label: '图捕获', time: 1411, kind: 'mtp', detail: '两个节点完成 NPU Graph 捕获，均耗时 137 s', locator: 'service rank-{000,001} L1076/L784' },
      { id: 'gc-ready', label: '服务就绪', time: 1447, kind: 'ready', detail: 'API 就绪；健康检查与模型列表验证通过', locator: '模型加载速度实验 L198–201' },
    ],
    links: [
      relation('gc-r1', 'gc-stage-start', 'gc-stage-end'),
      relation('gc-r2', 'gc-vllm', 'gc-engine'),
      relation('gc-r3', 'gc-engine', 'gc-load'),
      relation('gc-r4', 'gc-load', 'gc-dp0', 'branch'),
      relation('gc-r5', 'gc-load', 'gc-dp1', 'branch'),
      relation('gc-r6', 'gc-dp0', 'gc-mtp0'),
      relation('gc-r7', 'gc-dp1', 'gc-mtp1'),
      relation('gc-r8', 'gc-mtp0', 'gc-graph', 'join'),
      relation('gc-r9', 'gc-mtp1', 'gc-graph', 'join'),
      relation('gc-r10', 'gc-graph', 'gc-ready'),
    ],
  },
  {
    id: 'glm-ram-warm',
    name: 'RAM Disk · 热启动',
    model: 'GLM-5.2 W8A8',
    shortName: 'RAM · 热启动',
    config: 'TP16 · DP2 · EP · 32 NPU · 已预置',
    date: '08-24 13:41',
    total: 484,
    mainWeight: 40,
    source: 'deepseek-load-analysis/runs/glm52-w8a8-ramdisk-1500g-dp2tp16-warm-20260824/service/rank-{000,001}.log',
    nodes: [
      { id: 'gw-vllm', label: 'vLLM 启动', time: 0, kind: 'start', detail: '复用 RAM Disk 模型副本，重新启动 vLLM', locator: '模型加载速度实验 L210–222' },
      { id: 'gw-engine', label: '引擎初始化', time: 38, kind: 'start', detail: '两个 DP 实例开始建立 EngineCore', locator: 'service rank-{000,001} L63/L49' },
      { id: 'gw-load', label: '权重开始', time: 215, kind: 'start', detail: '32 个 Worker 从 RAM Disk 开始加载主权重', locator: 'service rank-{000,001} L570/L481' },
      { id: 'gw-dp0', label: 'DP0 权重', time: 271, kind: 'rank', lane: 0, detail: 'DP0 主权重 39.73 s', locator: 'service rank-000 L801' },
      { id: 'gw-dp1', label: 'DP1 权重', time: 271, kind: 'rank', lane: 1, detail: 'DP1 主权重 40.00 s', locator: 'service rank-001 L537' },
      { id: 'gw-mtp0', label: 'MTP · DP0', time: 293, kind: 'mtp', lane: 0, detail: 'DP0 MTP 权重 0.39 s', locator: 'service rank-000 L926' },
      { id: 'gw-mtp1', label: 'MTP · DP1', time: 289, kind: 'mtp', lane: 1, detail: 'DP1 MTP 权重 0.33 s', locator: 'service rank-001 L641' },
      { id: 'gw-graph', label: '图捕获', time: 448, kind: 'mtp', detail: '两个节点完成 NPU Graph 捕获，均耗时 120 s', locator: 'service rank-{000,001} L1080/L812' },
      { id: 'gw-ready', label: '服务就绪', time: 484, kind: 'ready', detail: 'API 就绪；健康检查与模型列表验证通过', locator: '模型加载速度实验 L222' },
    ],
    links: [
      relation('gw-r1', 'gw-vllm', 'gw-engine'),
      relation('gw-r2', 'gw-engine', 'gw-load'),
      relation('gw-r3', 'gw-load', 'gw-dp0', 'branch'),
      relation('gw-r4', 'gw-load', 'gw-dp1', 'branch'),
      relation('gw-r5', 'gw-dp0', 'gw-mtp0'),
      relation('gw-r6', 'gw-dp1', 'gw-mtp1'),
      relation('gw-r7', 'gw-mtp0', 'gw-graph', 'join'),
      relation('gw-r8', 'gw-mtp1', 'gw-graph', 'join'),
      relation('gw-r9', 'gw-graph', 'gw-ready'),
    ],
  },
  {
    id: 'glm-p8-e2e-20260825',
    name: 'P=8 预置 · 完整流程',
    model: 'GLM-5.2 W8A8',
    shortName: 'P=8 · 完整流程',
    config: 'TP16 · DP2 · EP · 32 NPU · 双节点 P=8 预置',
    date: '08-25 10:23',
    total: 566.54,
    mainWeight: 49.6,
    source: 'worker-fork-test/runs/{glm52-minimal-stage-20260825-01/prestage,glm52-minimal-service-20260825-01/service}/rank-{000,001}.log',
    nodes: [
      { id: 'gp-stage-start', label: 'P=8 预置', time: 0, kind: 'start', detail: '两个节点同时从共享存储预置模型，单节点并行度 P=8', locator: 'prestage rank-{000,001} L1' },
      { id: 'gp-stage-dp1', label: '节点1预置', time: 143.37, kind: 'rank', lane: 1, detail: '节点1完成 743.10 GiB 预置，耗时 143.37 s', locator: 'prestage rank-001 L1' },
      { id: 'gp-stage-dp0', label: '节点0预置', time: 156.95, kind: 'rank', lane: 0, detail: '节点0完成 743.10 GiB 预置；关键路径 156.95 s', locator: 'prestage rank-000 L1' },
      { id: 'gp-vllm', label: 'vLLM 启动', time: 187.54, kind: 'start', detail: '预置结束约 31 s 后，两节点启动原 GLM-5.2 推理配置', locator: 'service rank-{000,001} L2' },
      { id: 'gp-engine', label: 'Engine 初始化', time: 232.54, kind: 'start', detail: 'DP0、DP1 同时建立 EngineCore；TP16、DP2、EP', locator: 'service rank-000 L49 / rank-001 L40' },
      { id: 'gp-load', label: '32 Worker 权重', time: 255.54, kind: 'start', detail: '32 个 Worker 进入模型加载，最早与最晚 Rank 相差约 1 s', locator: 'service rank-000 L292–333 / rank-001 L222–250' },
      { id: 'gp-dp0', label: 'DP0 主权重', time: 319.54, kind: 'rank', lane: 0, detail: 'DP0 主权重读取耗时 47.10 s', locator: 'service rank-000 L533' },
      { id: 'gp-dp1', label: 'DP1 主权重', time: 322.54, kind: 'rank', lane: 1, detail: 'DP1 主权重读取耗时 49.60 s', locator: 'service rank-001 L272' },
      { id: 'gp-mtp0', label: 'MTP · DP0', time: 337.54, kind: 'mtp', lane: 0, detail: 'DP0 MTP 权重读取耗时 0.91 s', locator: 'service rank-000 L665' },
      { id: 'gp-mtp1', label: 'MTP · DP1', time: 343.54, kind: 'mtp', lane: 1, detail: 'DP1 MTP 权重读取耗时 2.83 s', locator: 'service rank-001 L398' },
      { id: 'gp-graph-start', label: 'Graph 开始', time: 389.54, kind: 'start', detail: '由 Graph 完成时间与日志记录的 138 s 耗时回推', locator: 'service rank-000 L808 / rank-001 L535' },
      { id: 'gp-graph-end', label: 'Graph 完成', time: 527.54, kind: 'mtp', detail: '两个节点完成 NPU Graph 捕获，均耗时 138 s', locator: 'service rank-000 L808 / rank-001 L535' },
      { id: 'gp-engine-ready', label: 'Engine 完成', time: 545.54, kind: 'mtp', detail: '较慢 DP0 的 Engine 初始化子流程耗时 206.13 s；两节点 KV Cache 均为 27.93 GiB', locator: 'service rank-000 L773/L876 / rank-001 L505/L607' },
      { id: 'gp-ready', label: '首次 HTTP 200', time: 566.54, kind: 'ready', detail: '/health、/v1/models 与真实生成均验证为 HTTP 200；system_fingerprint 为 TP16-DP2-EP', locator: 'service rank-000 L955–960' },
    ],
    links: [
      relation('gp-r1', 'gp-stage-start', 'gp-stage-dp0', 'branch'),
      relation('gp-r2', 'gp-stage-start', 'gp-stage-dp1', 'branch'),
      relation('gp-r3', 'gp-vllm', 'gp-engine'),
      relation('gp-r4', 'gp-engine', 'gp-load'),
      relation('gp-r5', 'gp-load', 'gp-dp0', 'branch'),
      relation('gp-r6', 'gp-load', 'gp-dp1', 'branch'),
      relation('gp-r7', 'gp-dp0', 'gp-mtp0'),
      relation('gp-r8', 'gp-dp1', 'gp-mtp1'),
      relation('gp-r9', 'gp-mtp0', 'gp-graph-start', 'join'),
      relation('gp-r10', 'gp-mtp1', 'gp-graph-start', 'join'),
      relation('gp-r11', 'gp-graph-start', 'gp-graph-end', 'sequence', 'inferred'),
      relation('gp-r12', 'gp-graph-end', 'gp-engine-ready'),
      relation('gp-r13', 'gp-engine-ready', 'gp-ready'),
    ],
  },
];

export function deriveRunState(experiment: Pick<ExperimentEvidence, 'nodes'>): Pick<RealExperiment, 'status' | 'statusLabel'> {
  const nodes = [...experiment.nodes].sort((a, b) => a.time - b.time);
  const ready = [...nodes].reverse().find((node) => node.kind === 'ready');
  if (ready) {
    const proof = `${ready.label} ${ready.detail}`;
    if (/真实生成|generation|首次\s*HTTP/i.test(proof)) return { status: 'complete', statusLabel: '已完成 · 生成验证' };
    if (/API|health|models|HTTP/i.test(proof)) return { status: 'complete', statusLabel: '已完成 · API 验证' };
    if (/两节点|较慢节点/i.test(proof)) return { status: 'complete', statusLabel: '已完成 · 两节点就绪' };
    return { status: 'complete', statusLabel: '已完成 · 服务就绪' };
  }

  const open = [...nodes].reverse().find((node) => node.kind === 'open');
  if (open) {
    const checkpoint = `${open.label} ${open.detail}`.match(/\b\d+\s*\/\s*\d+\b|\b\d+(?:\.\d+)?%/)?.[0]?.replace(/\s/g, '');
    return { status: 'partial', statusLabel: `未完成 · 停于 ${checkpoint ?? open.label}` };
  }
  return { status: 'evidence-gap', statusLabel: '证据残缺 · 缺服务终点' };
}

export function normalizeExperiment(experiment: ExperimentEvidence | RealExperiment): RealExperiment {
  const nodes = [...experiment.nodes].sort((a, b) => a.time - b.time);
  const total = Math.max(1, experiment.total, ...nodes.map((node) => node.time));
  return { ...experiment, nodes, total, ...deriveRunState({ nodes }) };
}

export const realExperiments: RealExperiment[] = experimentEvidence.map(normalizeExperiment);

export function formatSeconds(value: number) {
  if (value < 60) return `${value.toFixed(value % 1 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}
