import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(project, '..', '..');
const defaultRunRoot = path.join(workspace, 'Worker启动Fork实验', 'results', 'glm52-minimal-e2e-20260825-01');
const runRoot = path.resolve(process.env.CHRONOSCOPE_GLM52_RUN ?? defaultRunRoot);
const output = path.join(project, 'app', 'generated', 'timeline-bundle.json');

const files = {
  prestage0: 'glm52-minimal-stage-20260825-01/prestage/rank-000.log',
  prestage1: 'glm52-minimal-stage-20260825-01/prestage/rank-001.log',
  service0: 'glm52-minimal-service-20260825-01/service/rank-000.log',
  service1: 'glm52-minimal-service-20260825-01/service/rank-001.log',
  result: '结果.md',
};

const loaded = {};
for (const [id, relativePath] of Object.entries(files)) {
  const buffer = await readFile(path.join(runRoot, relativePath));
  const text = buffer.toString('utf8');
  loaded[id] = { id, relativePath: relativePath.replaceAll('\\', '/'), buffer, text, lines: text.split(/\r?\n/) };
}

const prestage = [JSON.parse(loaded.prestage0.text), JSON.parse(loaded.prestage1.text)];
const rootEpoch = Math.min(...prestage.map((item) => Number(item.wall_start_ns) / 1e9));
const at = (epoch) => Number((epoch - rootEpoch).toFixed(3));
const localEpoch = (month, day, hour, minute, second) => Date.parse(`2026-${month}-${day}T${hour}:${minute}:${second}+08:00`) / 1000;
const timestamp = (line) => {
  const iso = line.match(/timestamp=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/)?.[1];
  if (iso) return Date.parse(iso) / 1000;
  const match = line.match(/\b(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\b/);
  return match ? localEpoch(...match.slice(1)) : undefined;
};
const findAll = (sourceId, pattern) => loaded[sourceId].lines.flatMap((line, index) => {
  const match = line.match(pattern);
  const epoch = timestamp(line);
  return match && epoch !== undefined ? [{ sourceId, line: index + 1, text: line, match, time: at(epoch) }] : [];
});
const findOne = (sourceId, pattern, pick = 'first') => {
  const matches = findAll(sourceId, pattern);
  return pick === 'last' ? matches.at(-1) : matches[0];
};
const ref = (event, lineEnd = event?.line) => event ? [{ evidenceId: event.sourceId, lineStart: event.line, lineEnd }] : [];
const summaryRef = (line) => [{ evidenceId: 'result', lineStart: line, lineEnd: line }];

const serviceStart0 = findOne('service0', /GLM52_FORK_START/);
const serviceStart1 = findOne('service1', /GLM52_FORK_START/);
const engineStart0 = findOne('service0', /EngineCore_DP0.*initializing/i);
const engineStart1 = findOne('service1', /EngineCore_DP1.*initializing/i);
const workerInit = [
  ...findAll('service0', /world_size=32 rank=(\d+) local_rank=(\d+) distributed_init_method/i),
  ...findAll('service1', /world_size=32 rank=(\d+) local_rank=(\d+) distributed_init_method/i),
];
const weightStarts = [
  ...findAll('service0', /Worker_DP0_TP(\d+)_EP(\d+).*Starting to load model .*\/main/i),
  ...findAll('service1', /Worker_DP1_TP(\d+)_EP(\d+).*Starting to load model .*\/main/i),
];
const mainDone0 = findOne('service0', /Loading weights took\s+47\.10 seconds/i);
const mainDone1 = findOne('service1', /Loading weights took\s+49\.60 seconds/i);
const mtpStart0 = findOne('service0', /Loading drafter model/i);
const mtpStart1 = findOne('service1', /Loading drafter model/i);
const mtpDone0 = findOne('service0', /Loading weights took\s+0\.91 seconds/i);
const mtpDone1 = findOne('service1', /Loading weights took\s+2\.83 seconds/i);
const compileDone = [
  ...findAll('service0', /torch\.compile took\s+([\d.]+) s/i),
  ...findAll('service1', /torch\.compile took\s+([\d.]+) s/i),
];
const kv0 = findOne('service0', /Available KV cache memory:\s+([\d.]+) GiB/i);
const kv1 = findOne('service1', /Available KV cache memory:\s+([\d.]+) GiB/i);
const graph0 = findOne('service0', /Graph capturing finished in\s+(\d+) secs/i);
const graph1 = findOne('service1', /Graph capturing finished in\s+(\d+) secs/i);
const engineDone0 = findOne('service0', /init engine .* took\s+([\d.]+) s/i);
const engineDone1 = findOne('service1', /init engine .* took\s+([\d.]+) s/i);

const required = { serviceStart0, serviceStart1, engineStart0, engineStart1, mainDone0, mainDone1, mtpStart0, mtpStart1, mtpDone0, mtpDone1, kv0, kv1, graph0, graph1, engineDone0, engineDone1 };
for (const [name, value] of Object.entries(required)) if (!value) throw new Error(`required event not found: ${name}`);
if (workerInit.length !== 32) throw new Error(`expected 32 worker init events, found ${workerInit.length}`);
if (weightStarts.length !== 32) throw new Error(`expected 32 weight start events, found ${weightStarts.length}`);

const runId = 'glm-p8-e2e-20260825';
const nodes = [];
const node = (id, parentId, semanticKey, subjectRef, label, kind, start, detail, evidence, options = {}) => {
  const value = {
    id, parentId, semanticKey, subjectRef, label, kind,
    start: Number(start.toFixed(3)),
    ...(options.end === undefined ? {} : { end: Number(options.end.toFixed(3)) }),
    boundary: options.boundary ?? 'observed',
    importance: options.importance ?? 'diagnostic',
    detail, evidence,
  };
  nodes.push(value);
  return value;
};

node('run', null, 'run', runId, 'GLM-5.2 P=8 完整流程', 'run', 0, '双节点预置、推理启动与接口验证', [...ref({ sourceId: 'prestage0', line: 1 }), ...summaryRef(26)], { end: 566.54, importance: 'key' });
node('phase-prestage', 'run', 'prestage', 'cluster', 'P=8 模型预置', 'phase', 0, '两个节点从共享存储并行复制模型到 RAM Disk', [...ref({ sourceId: 'prestage0', line: 1 }), ...ref({ sourceId: 'prestage1', line: 1 })], { end: 156.951, importance: 'key' });
prestage.forEach((item, rank) => node(`prestage-node-${rank}`, 'phase-prestage', 'prestage.node', `node:${rank}`, `节点${rank}预置完成`, 'activity', at(Number(item.wall_start_ns) / 1e9), `复制 ${(item.copied_bytes / 1024 ** 3).toFixed(2)} GiB，耗时 ${item.elapsed_seconds.toFixed(2)} s`, [{ evidenceId: `prestage${rank}`, lineStart: 1, lineEnd: 1 }], { end: at(Number(item.wall_end_ns) / 1e9), importance: 'key' }));

const serviceStart = Math.min(serviceStart0.time, serviceStart1.time);
node('phase-service', 'run', 'service.startup', 'service', '推理服务启动', 'phase', serviceStart, '保持原 GLM-5.2 TP16、DP2、EP、MTP 参数', [...ref(serviceStart0), ...ref(serviceStart1)], { end: 566.54, importance: 'key' });
node('service-start', 'phase-service', 'service.process.start', 'service', 'vLLM 启动', 'event', serviceStart, '两节点服务进程开始启动', [...ref(serviceStart0), ...ref(serviceStart1)], { importance: 'key' });
node('phase-engine', 'phase-service', 'engine.initialize', 'engine', 'Engine 初始化', 'phase', Math.min(engineStart0.time, engineStart1.time), '两个数据并行实例开始建立 EngineCore', [...ref(engineStart0), ...ref(engineStart1)], { end: Math.max(engineDone0.time, engineDone1.time), importance: 'key' });
node('engine-start', 'phase-engine', 'engine.start', 'engine', 'Engine 初始化开始', 'event', Math.min(engineStart0.time, engineStart1.time), 'DP0 与 DP1 在同一秒开始初始化', [...ref(engineStart0), ...ref(engineStart1)], { importance: 'key' });

node('phase-workers', 'phase-engine', 'worker.initialize', 'workers', 'Worker 初始化', 'phase', Math.min(...workerInit.map((event) => event.time)), '32 个 Worker 完成分布式环境初始化', workerInit.flatMap((event) => ref(event)), { end: Math.max(...workerInit.map((event) => event.time)) });
[0, 1].forEach((dp) => {
  const events = workerInit.filter((event) => event.sourceId === `service${dp}`);
  node(`phase-workers-dp${dp}`, 'phase-workers', 'worker.initialize.dp', `dp:${dp}`, `DP${dp} Worker 初始化`, 'phase', Math.min(...events.map((event) => event.time)), '16 个 TP Worker 完成分布式环境初始化', events.flatMap((event) => ref(event)), { end: Math.max(...events.map((event) => event.time)) });
});
workerInit.forEach((event, index) => {
  const dp = event.sourceId === 'service0' ? 0 : 1;
  const worker = event.text.match(/world_size=32 rank=(\d+) local_rank=(\d+)/);
  node(`worker-init-${index}`, `phase-workers-dp${dp}`, 'worker.initialize.done', `dp:${dp}/tp:${worker?.[2] ?? index}`, `DP${dp} · TP${worker?.[2] ?? '?'}`, 'event', event.time, `全局 Rank ${worker?.[1] ?? '?'} 完成分布式环境初始化`, ref(event), { importance: 'raw' });
});

const earliestWeight = Math.min(...weightStarts.map((event) => event.time));
node('phase-weights', 'phase-engine', 'weights.load', 'model:main+mtp', '权重加载', 'phase', earliestWeight, '32 个 Worker 加载主权重，随后加载 MTP 权重', weightStarts.flatMap((event) => ref(event)), { end: Math.max(mtpDone0.time, mtpDone1.time), importance: 'key' });
node('phase-main-weights', 'phase-weights', 'weights.main', 'model:main', '主权重加载', 'phase', earliestWeight, '两个 DP 分支并行加载主模型权重', weightStarts.flatMap((event) => ref(event)), { end: Math.max(mainDone0.time, mainDone1.time), importance: 'key' });
[0, 1].forEach((dp) => {
  const events = weightStarts.filter((event) => event.sourceId === `service${dp}`);
  const done = dp === 0 ? mainDone0 : mainDone1;
  node(`phase-main-dp${dp}`, 'phase-main-weights', 'weights.main.dp', `dp:${dp}`, `DP${dp} 主权重加载`, 'phase', Math.min(...events.map((event) => event.time)), `16 个 TP Worker 并行加载主权重`, events.flatMap((event) => ref(event)), { end: done.time });
});
node('weight-start', 'phase-main-weights', 'weights.main.start', 'model:main', '32 Worker 权重开始', 'event', earliestWeight, `32 个 Worker 在 ${(Math.max(...weightStarts.map((event) => event.time)) - earliestWeight).toFixed(2)} s 内进入主权重加载`, weightStarts.flatMap((event) => ref(event)), { importance: 'key' });
weightStarts.forEach((event, index) => {
  const parsed = event.text.match(/Worker_DP(\d+)_TP(\d+)_EP(\d+)/);
  node(`weight-worker-${index}`, `phase-main-dp${parsed?.[1]}`, 'weights.main.worker.start', `dp:${parsed?.[1]}/tp:${parsed?.[2]}`, `DP${parsed?.[1]} · TP${parsed?.[2]}`, 'event', event.time, '开始加载主模型权重', ref(event), { importance: 'raw' });
});
node('main-dp0', 'phase-main-dp0', 'weights.main.done', 'dp:0', 'DP0 主权重', 'activity', mainDone0.time, '主权重加载耗时 47.10 s', ref(mainDone0), { importance: 'key' });
node('main-dp1', 'phase-main-dp1', 'weights.main.done', 'dp:1', 'DP1 主权重', 'activity', mainDone1.time, '主权重加载耗时 49.60 s', ref(mainDone1), { importance: 'key' });
node('phase-mtp-weights', 'phase-weights', 'weights.mtp', 'model:mtp', 'MTP 权重加载', 'phase', Math.min(mtpStart0.time, mtpStart1.time), '两个 DP 分支加载 MTP 补充权重', [...ref(mtpStart0), ...ref(mtpStart1)], { end: Math.max(mtpDone0.time, mtpDone1.time), importance: 'key' });
node('phase-mtp-dp0', 'phase-mtp-weights', 'weights.mtp.dp', 'dp:0', 'DP0 MTP 权重', 'phase', mtpStart0.time, 'DP0 加载 MTP 补充权重', ref(mtpStart0), { end: mtpDone0.time });
node('phase-mtp-dp1', 'phase-mtp-weights', 'weights.mtp.dp', 'dp:1', 'DP1 MTP 权重', 'phase', mtpStart1.time, 'DP1 加载 MTP 补充权重', ref(mtpStart1), { end: mtpDone1.time });
node('mtp-start-dp0', 'phase-mtp-dp0', 'weights.mtp.start', 'dp:0', 'DP0 MTP 开始', 'event', mtpStart0.time, '开始加载 MTP 补充权重', ref(mtpStart0));
node('mtp-start-dp1', 'phase-mtp-dp1', 'weights.mtp.start', 'dp:1', 'DP1 MTP 开始', 'event', mtpStart1.time, '开始加载 MTP 补充权重', ref(mtpStart1));
node('mtp-dp0', 'phase-mtp-dp0', 'weights.mtp.done', 'dp:0', 'MTP · DP0', 'activity', mtpDone0.time, 'MTP 权重加载耗时 0.91 s', ref(mtpDone0), { importance: 'key' });
node('mtp-dp1', 'phase-mtp-dp1', 'weights.mtp.done', 'dp:1', 'MTP · DP1', 'activity', mtpDone1.time, 'MTP 权重加载耗时 2.83 s', ref(mtpDone1), { importance: 'key' });

node('phase-compile', 'phase-engine', 'model.compile', 'dp:0+1', '模型编译', 'phase', Math.min(...compileDone.map((event) => event.time - Number(event.match[1]))), '记录两轮 torch.compile 完成点', compileDone.flatMap((event) => ref(event)), { end: Math.max(...compileDone.map((event) => event.time)), boundary: 'derived' });
compileDone.forEach((event, index) => node(`compile-${index}`, 'phase-compile', 'model.compile.done', event.sourceId === 'service0' ? 'dp:0' : 'dp:1', `${event.sourceId === 'service0' ? 'DP0' : 'DP1'} 编译 ${index % 2 + 1}`, 'event', event.time, `该轮 torch.compile 耗时 ${event.match[1]} s`, ref(event)));
node('phase-kv', 'phase-engine', 'kv_cache.allocate', 'dp:0+1', 'KV Cache 分配', 'phase', Math.min(kv0.time, kv1.time), '两节点可用 KV Cache 均为 27.93 GiB', [...ref(kv0), ...ref(kv1)], { end: Math.max(kv0.time, kv1.time) });
node('kv-dp0', 'phase-kv', 'kv_cache.available', 'dp:0', 'DP0 KV Cache', 'event', kv0.time, '可用 27.93 GiB', ref(kv0));
node('kv-dp1', 'phase-kv', 'kv_cache.available', 'dp:1', 'DP1 KV Cache', 'event', kv1.time, '可用 27.93 GiB', ref(kv1));
const graphStart0 = graph0.time - Number(graph0.match[1]);
const graphStart1 = graph1.time - Number(graph1.match[1]);
node('phase-graph', 'phase-engine', 'graph.capture', 'dp:0+1', 'Graph 捕获', 'phase', Math.min(graphStart0, graphStart1), '两个数据并行实例分别捕获 NPU Graph', [...ref(graph0), ...ref(graph1)], { end: Math.max(graph0.time, graph1.time), boundary: 'derived', importance: 'key' });
node('graph-start', 'phase-graph', 'graph.capture.start', 'dp:0+1', 'Graph 开始', 'event', Math.min(graphStart0, graphStart1), '依据完成时间和 138 s 耗时回推', [...ref(graph0), ...ref(graph1)], { boundary: 'derived', importance: 'key' });
node('graph-dp1', 'phase-graph', 'graph.capture.done', 'dp:1', 'Graph · DP1', 'activity', graph1.time, 'Graph 捕获耗时 138 s', ref(graph1));
node('graph-dp0', 'phase-graph', 'graph.capture.done', 'dp:0', 'Graph 完成', 'activity', graph0.time, 'Graph 捕获耗时 138 s', ref(graph0), { importance: 'key' });
node('engine-dp1', 'phase-engine', 'engine.done', 'dp:1', 'Engine · DP1', 'activity', engineDone1.time, 'Engine 初始化耗时 198.11 s', ref(engineDone1));
node('engine-dp0', 'phase-engine', 'engine.done', 'dp:0', 'Engine 完成', 'activity', engineDone0.time, 'Engine 初始化耗时 206.13 s', ref(engineDone0), { importance: 'key' });
node('service-ready', 'phase-service', 'service.verified', 'api', '首次 HTTP 200', 'event', 566.54, '/health、/v1/models 与真实生成请求均为 HTTP 200', [...ref({ sourceId: 'service0', line: 957 }, 960), ...summaryRef(25), ...summaryRef(26)], { importance: 'key' });

const defaultNodeIds = ['prestage-node-1', 'prestage-node-0', 'service-start', 'engine-start', 'weight-start', 'main-dp0', 'main-dp1', 'mtp-dp0', 'mtp-dp1', 'graph-start', 'graph-dp1', 'graph-dp0', 'engine-dp1', 'engine-dp0', 'service-ready'];
const relations = [];
const relation = (id, from, to, kind = 'sequence', origin = 'observed', explicitDetails) => {
  const source = nodes.find((item) => item.id === from);
  const target = nodes.find((item) => item.id === to);
  const detailNodeIds = (explicitDetails ?? nodes
    .filter((item) => !defaultNodeIds.includes(item.id) && item.kind !== 'run' && item.kind !== 'phase' && item.start > source.start && item.start < target.start)
    .sort((left, right) => left.start - right.start || left.subjectRef.localeCompare(right.subjectRef))
    .map((item) => item.id));
  relations.push({ id, from, to, kind, origin, ...(detailNodeIds.length ? { detailNodeIds } : {}) });
};
const detailIds = (predicate) => nodes.filter((item) => predicate(item)).sort((left, right) => left.start - right.start || left.subjectRef.localeCompare(right.subjectRef)).map((item) => item.id);
relation('r-prestage-0', 'prestage-node-1', 'prestage-node-0');
relation('r-service-engine', 'service-start', 'engine-start');
relation('r-engine-workers', 'engine-start', 'weight-start', 'sequence', 'observed', detailIds((item) => item.id.startsWith('worker-init-')));
relation('r-weight-dp0', 'weight-start', 'main-dp0', 'branch', 'observed', detailIds((item) => item.id.startsWith('weight-worker-') && item.subjectRef.startsWith('dp:0/')));
relation('r-weight-dp1', 'weight-start', 'main-dp1', 'branch', 'observed', detailIds((item) => item.id.startsWith('weight-worker-') && item.subjectRef.startsWith('dp:1/')));
relation('r-dp0-mtp', 'main-dp0', 'mtp-dp0', 'sequence', 'observed', ['mtp-start-dp0']);
relation('r-dp1-mtp', 'main-dp1', 'mtp-dp1', 'sequence', 'observed', ['mtp-start-dp1']);
relation('r-mtp0-graph', 'mtp-dp0', 'graph-start', 'join', 'observed', detailIds((item) => (item.id.startsWith('compile-') || item.id === 'kv-dp0') && item.subjectRef === 'dp:0'));
relation('r-mtp1-graph', 'mtp-dp1', 'graph-start', 'join', 'observed', detailIds((item) => (item.id.startsWith('compile-') || item.id === 'kv-dp1') && item.subjectRef === 'dp:1'));
relation('r-graph-dp0', 'graph-start', 'graph-dp0', 'branch', 'inferred');
relation('r-graph-dp1', 'graph-start', 'graph-dp1', 'branch', 'inferred');
relation('r-graph-engine', 'graph-dp0', 'engine-dp0', 'join');
relation('r-engine-ready', 'engine-dp0', 'service-ready');

const errors = [];
const ids = new Set(nodes.map((item) => item.id));
for (const item of nodes) {
  if (item.parentId && !ids.has(item.parentId)) errors.push(`node ${item.id}: missing parent ${item.parentId}`);
  if (item.end !== undefined && item.end < item.start) errors.push(`node ${item.id}: end before start`);
  for (const evidence of item.evidence) if (!loaded[evidence.evidenceId]) errors.push(`node ${item.id}: missing evidence ${evidence.evidenceId}`);
}
for (const item of relations) if (!ids.has(item.from) || !ids.has(item.to)) errors.push(`relation ${item.id}: missing endpoint`);

const evidence = Object.values(loaded).map((item) => ({
  id: item.id,
  relativePath: item.relativePath,
  sha256: createHash('sha256').update(item.buffer).digest('hex'),
  bytes: item.buffer.byteLength,
  lines: item.lines.length,
}));
const bundle = {
  schemaVersion: 'semantic-timeline/v1',
  generatedAt: new Date().toISOString(),
  parser: { name: 'glm52-minimal-e2e', version: '0.1.0' },
  evidence,
  runs: [{
    id: runId,
    model: 'GLM-5.2 W8A8',
    label: 'P=8 预置 · 完整流程',
    shortLabel: 'P=8 · 完整流程',
    config: 'TP16 · DP2 · EP · 32 NPU · 双节点 P=8 预置',
    startedAt: new Date(rootEpoch * 1000).toISOString(),
    totalSeconds: 566.54,
    mainWeightSeconds: 49.60,
    status: 'complete',
    statusLabel: '已完成 · 生成验证',
    rootNodeId: 'run',
    nodes,
    relations,
    projection: { nodeIds: defaultNodeIds, relationIds: relations.map((item) => item.id) },
  }],
  validation: { valid: errors.length === 0, errors, counts: { runs: 1, nodes: nodes.length, relations: relations.length, evidence: evidence.length } },
};

if (errors.length) throw new Error(`timeline validation failed:\n${errors.join('\n')}`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, ...bundle.validation.counts, valid: true }));
