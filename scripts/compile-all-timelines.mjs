import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = process.env.CHRONOSCOPE_EVIDENCE_ROOT;
const output = path.join(project, 'app', 'generated', 'timeline-bundle.json');

if (!evidenceRoot) throw new Error('CHRONOSCOPE_EVIDENCE_ROOT is required');

const { realExperiments } = await import('../app/comparison-model.ts');
const compiled = JSON.parse(await readFile(output, 'utf8'));
const compiledP8 = compiled.runs.find((run) => run.id === 'glm-p8-e2e-20260825');
if (!compiledP8) throw new Error('glm-p8-e2e-20260825 must be compiled first');

const catalog = {
  'dtfs-a': [{ file: 'deepseek-v4-flash-load-20260821/service/rank-000.log', from: 1, to: 1200 }],
  'dtfs-b': [{ file: 'deepseek-v4-flash-load-20260821/service/rank-000.log', from: 1201, to: 2400 }],
  'dtfs-dp1': [{ file: 'dsv4-dp1-load-20260822/service/rank-000.log' }],
  prefetch: [{ file: 'dsv4-dp2-tp8-prefetch-20260822-r2/service/rank-000.log' }],
  'ram-cold': [
    { file: 'dsv4-ramdisk-cold-dp2tp8-20260824/service/rank-000.log' },
    { file: 'dsv4-ramdisk-cold-dp2tp8-20260824/service/rank-001.log' },
  ],
  'ram-warm': [
    { file: 'dsv4-ramdisk-dp2tp8-20260824/service/rank-000.log' },
    { file: 'dsv4-ramdisk-dp2tp8-20260824/service/rank-001.log' },
  ],
  'glm-ram-cold': [
    { file: 'glm52-w8a8-ramdisk-1500g-dp2tp16-20260824/service/rank-000.log' },
    { file: 'glm52-w8a8-ramdisk-1500g-dp2tp16-20260824/service/rank-001.log' },
  ],
  'glm-ram-warm': [
    { file: 'glm52-w8a8-ramdisk-1500g-dp2tp16-warm-20260824/service/rank-000.log' },
    { file: 'glm52-w8a8-ramdisk-1500g-dp2tp16-warm-20260824/service/rank-001.log' },
  ],
};

function epoch(line) {
  const match = line.match(/\b(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\b/);
  if (!match) return undefined;
  return Date.parse(`2026-${match[1]}-${match[2]}T${match[3]}:${match[4]}:${match[5]}+08:00`) / 1000;
}

function nodeKind(node) {
  return node.kind === 'rank' || node.kind === 'mtp' ? 'activity' : 'event';
}

function semanticKey(node) {
  if (node.kind === 'ready') return 'service.verified';
  if (/graph|图捕获/i.test(node.label)) return 'graph.capture.done';
  if (node.kind === 'progress' || node.kind === 'open') return 'weights.progress';
  if (node.kind === 'rank') return 'weights.main.done';
  if (node.kind === 'mtp') return /graph/i.test(node.label) ? 'graph.capture.done' : 'weights.mtp.done';
  if (/权重|load/i.test(node.label)) return 'weights.main.start';
  if (/engine|引擎/i.test(node.label)) return 'engine.start';
  return 'process.start';
}

function parentFor(node) {
  if (node.kind === 'ready') return 'phase-service';
  if (/graph|图捕获/i.test(node.label)) return 'phase-runtime';
  if (node.kind === 'rank') {
    const dp = node.label.match(/DP\s*(\d+)/i)?.[1];
    return dp === undefined ? 'phase-main' : `phase-main-dp${dp}`;
  }
  if (node.kind === 'mtp') {
    const dp = node.label.match(/DP\s*(\d+)/i)?.[1];
    return dp === undefined ? 'phase-mtp' : `phase-mtp-dp${dp}`;
  }
  if (node.kind === 'progress' || node.kind === 'open') return 'phase-progress';
  if (/权重|load/i.test(node.label)) return 'phase-main';
  return 'phase-engine';
}

function phase(id, parentId, label, start, end, detail, importance = 'diagnostic') {
  return {
    id, parentId, semanticKey: id.replaceAll('phase-', '').replaceAll('-', '.'), subjectRef: id,
    label, kind: 'phase', start, end, boundary: 'derived', importance, detail, evidence: [],
  };
}

function unique(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function loadSources(runId, specs) {
  const result = [];
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const buffer = await readFile(path.join(evidenceRoot, spec.file));
    const allLines = buffer.toString('utf8').split(/\r?\n/);
    const from = spec.from ?? 1;
    const to = spec.to ?? allLines.length;
    result.push({
      id: `${runId}-e${index}`,
      relativePath: spec.file.replaceAll('\\', '/'),
      buffer,
      lines: allLines.slice(from - 1, to).map((text, offset) => ({ text, line: from + offset })),
    });
  }
  return result;
}

function compileLegacyRun(experiment, sources) {
  const projected = experiment.nodes;
  const loadNode = projected.find((item) => /权重开始|Worker 权重/i.test(item.label));
  const weightStarts = sources.flatMap((source) => source.lines.flatMap((line) => {
    const match = line.text.match(/Worker_DP(\d+)_TP(\d+)_EP(\d+).*Starting to load model/i);
    const time = epoch(line.text);
    return match && time !== undefined ? [{ source, line, time, dp: Number(match[1]), tp: Number(match[2]), ep: Number(match[3]) }] : [];
  }));
  const origin = weightStarts.length && loadNode
    ? Math.min(...weightStarts.map((item) => item.time)) - loadNode.time
    : Math.min(...sources.flatMap((source) => source.lines.map((line) => epoch(line.text)).filter((value) => value !== undefined)));
  const at = (value) => Number(Math.max(0, value - origin).toFixed(3));
  const evidenceRef = (item) => [{ evidenceId: item.source.id, lineStart: item.line.line, lineEnd: item.line.line }];
  const tpMatch = experiment.config.match(/TP(\d+)/i);
  const tpSize = Number(tpMatch?.[1] ?? 1);
  const detailNodes = [];

  const workerInit = unique(sources.flatMap((source) => source.lines.flatMap((line) => {
    const match = line.text.match(/world_size=(\d+) rank=(\d+) local_rank=(\d+)/i);
    const time = epoch(line.text);
    if (!match || time === undefined) return [];
    const rank = Number(match[2]);
    const dp = Math.floor(rank / tpSize);
    const tp = rank % tpSize;
    return [{ source, line, time, rank, dp, tp }];
  })), (item) => `${item.rank}:${item.time}`);
  workerInit.forEach((item, index) => detailNodes.push({
    id: `worker-init-${index}`, parentId: `phase-workers-dp${item.dp}`, semanticKey: 'worker.initialize.done',
    subjectRef: `dp:${item.dp}/tp:${item.tp}`, label: `TP${item.tp}`, kind: 'event', start: at(item.time),
    boundary: 'observed', importance: 'raw', detail: `全局 Rank ${item.rank} 完成通信初始化`, evidence: evidenceRef(item),
  }));

  unique(weightStarts, (item) => `${item.dp}:${item.tp}:${item.time}`).forEach((item, index) => detailNodes.push({
    id: `weight-start-${index}`, parentId: `phase-main-dp${item.dp}`, semanticKey: 'weights.main.worker.start',
    subjectRef: `dp:${item.dp}/tp:${item.tp}`, label: `TP${item.tp} 开始`, kind: 'event', start: at(item.time),
    boundary: 'observed', importance: 'raw', detail: `EP${item.ep} 开始读取主权重`, evidence: evidenceRef(item),
  }));

  const progressCandidates = sources.flatMap((source) => source.lines.flatMap((line) => {
    if (!weightStarts.length) return [];
    const start = Math.min(...weightStarts.map((item) => item.time));
    return [...line.text.matchAll(/Loading safetensors checkpoint shards:\s*(\d+)% Completed \|\s*(\d+)\/(\d+)\s*\[(\d+):(\d+)/gi)].map((match) => {
      const elapsed = Number(match[4]) * 60 + Number(match[5]);
      return { source, line, time: start + elapsed, elapsed, percent: Number(match[1]), done: Number(match[2]), total: Number(match[3]) };
    });
  }));
  const progressByShard = new Map();
  for (const item of progressCandidates) {
    const previous = progressByShard.get(item.done);
    if (!previous || item.elapsed > previous.elapsed) progressByShard.set(item.done, item);
  }
  const progress = [...progressByShard.values()].sort((left, right) => left.done - right.done);
  progress.forEach((item, index) => detailNodes.push({
    id: `weight-progress-${index}`, parentId: `phase-progress-band${Math.min(3, Math.floor(item.percent / 25))}`, semanticKey: 'weights.progress.shard',
    subjectRef: `shard:${item.done}`, label: `${item.done}/${item.total}`, kind: 'event', start: at(item.time),
    boundary: 'derived', importance: item.done % 10 === 0 || item.done === item.total ? 'diagnostic' : 'raw',
    detail: `主权重读取 ${item.percent}%（可见分支最晚进度）`, evidence: evidenceRef(item),
  }));

  const weightDone = unique(sources.flatMap((source) => source.lines.flatMap((line) => {
    const match = line.text.match(/Worker_DP(\d+)_TP(\d+).*Loading weights took\s+([\d.]+) seconds/i);
    const time = epoch(line.text);
    return match && time !== undefined ? [{ source, line, time, dp: Number(match[1]), tp: Number(match[2]), elapsed: Number(match[3]) }] : [];
  })), (item) => `${item.dp}:${item.tp}:${item.time}:${item.elapsed}`);
  const doneByDp = new Map();
  for (const item of weightDone) doneByDp.set(item.dp, [...(doneByDp.get(item.dp) ?? []), item]);
  for (const [dp, items] of doneByDp) {
    items.sort((left, right) => right.elapsed - left.elapsed);
    items.forEach((item, index) => detailNodes.push({
      id: `weight-done-dp${dp}-${index}`, parentId: index === 0 ? `phase-main-dp${dp}` : `phase-mtp-dp${dp}`,
      semanticKey: index === 0 ? 'weights.main.worker.done' : 'weights.mtp.worker.done', subjectRef: `dp:${dp}/tp:${item.tp}`,
      label: index === 0 ? `DP${dp} 完成` : `MTP · DP${dp}`, kind: 'activity', start: at(item.time),
      boundary: 'observed', importance: 'diagnostic', detail: `耗时 ${item.elapsed.toFixed(2)} s`, evidence: evidenceRef(item),
    }));
  }

  const runtimePatterns = [
    [/torch\.compile took\s+([\d.]+) s/i, 'model.compile.done', '编译完成'],
    [/Available KV cache memory:\s+([\d.]+) GiB/i, 'kv_cache.available', 'KV Cache'],
    [/Graph capturing finished in\s+([\d.]+) secs/i, 'graph.capture.done', 'Graph 完成'],
    [/init engine .* took\s+([\d.]+) s/i, 'engine.done', 'Engine 完成'],
  ];
  sources.forEach((source, sourceIndex) => source.lines.forEach((line) => {
    const time = epoch(line.text);
    if (time === undefined) return;
    for (const [pattern, key, label] of runtimePatterns) {
      const match = line.text.match(pattern);
      if (!match) continue;
      const dp = Number(line.text.match(/(?:EngineCore|Worker)_DP(\d+)/i)?.[1] ?? sourceIndex);
      detailNodes.push({
        id: `runtime-${detailNodes.length}`, parentId: `phase-runtime-dp${dp}`, semanticKey: key,
        subjectRef: `dp:${dp}`, label: `${label} · DP${dp}`, kind: key.includes('done') ? 'activity' : 'event',
        start: at(time), boundary: 'observed', importance: 'diagnostic', detail: `${match[1]}${key.includes('kv_cache') ? ' GiB' : ' s'}`, evidence: [{ evidenceId: source.id, lineStart: line.line, lineEnd: line.line }],
      });
      break;
    }
  }));

  const mainStart = Math.min(loadNode?.time ?? experiment.total, ...weightStarts.map((item) => at(item.time)));
  const mainEnd = Math.max(mainStart, ...projected.filter((item) => item.kind === 'rank').map((item) => item.time));
  const mtpStart = Math.min(mainEnd, ...projected.filter((item) => item.kind === 'mtp').map((item) => item.time));
  const engineEnd = Math.max(mainStart, ...detailNodes.filter((item) => item.semanticKey === 'worker.initialize.done').map((item) => item.start));
  const nodes = [
    { id: 'run', parentId: null, semanticKey: 'run', subjectRef: experiment.id, label: experiment.name, kind: 'run', start: 0, end: experiment.total, boundary: 'declared', importance: 'key', detail: experiment.config, evidence: [] },
    phase('phase-engine', 'run', '引擎与 Worker 初始化', 0, engineEnd, '服务进程、通信域与 Worker 初始化', 'key'),
    phase('phase-workers', 'phase-engine', 'Worker 初始化', 0, engineEnd, `${workerInit.length} 个 Worker 初始化事件`),
    phase('phase-weights', 'run', '权重加载', mainStart, Math.max(mainEnd, mtpStart), '主权重、分片进度与 MTP 权重', 'key'),
    phase('phase-main', 'phase-weights', '主权重加载', mainStart, mainEnd, '各 DP 分支并行加载主权重', 'key'),
    phase('phase-progress', 'phase-main', '权重分片进度', mainStart, mainEnd, `${progress.length} 个分片进度事件`),
    phase('phase-mtp', 'phase-weights', 'MTP 权重', mainEnd, mtpStart, 'MTP 补充权重加载'),
    phase('phase-runtime', 'run', '运行时初始化', mainEnd, experiment.total, '编译、KV Cache、Graph 与 Engine 完成', 'key'),
    phase('phase-service', 'run', '服务验证', experiment.total, experiment.total, '服务是否到达可用终点', 'key'),
  ];
  const dpValues = new Set([
    ...workerInit.map((item) => item.dp), ...weightStarts.map((item) => item.dp), ...weightDone.map((item) => item.dp),
  ]);
  for (const dp of [...dpValues].sort()) {
    nodes.push(
      phase(`phase-workers-dp${dp}`, 'phase-workers', `DP${dp} Worker`, 0, engineEnd, `DP${dp} 的 Worker 初始化分支`),
      phase(`phase-main-dp${dp}`, 'phase-main', `DP${dp} 主权重`, mainStart, mainEnd, `DP${dp} 的主权重加载分支`),
      phase(`phase-mtp-dp${dp}`, 'phase-mtp', `DP${dp} MTP`, mainEnd, mtpStart, `DP${dp} 的 MTP 权重分支`),
      phase(`phase-runtime-dp${dp}`, 'phase-runtime', `DP${dp} 运行时`, mainEnd, experiment.total, `DP${dp} 的编译和图捕获分支`),
    );
  }
  const progressBands = [
    { id: 0, label: '0–25%' }, { id: 1, label: '25–50%' }, { id: 2, label: '50–75%' }, { id: 3, label: '75–100%' },
  ];
  for (const band of progressBands) {
    const children = detailNodes.filter((item) => item.parentId === `phase-progress-band${band.id}`);
    if (!children.length) continue;
    nodes.push(phase(
      `phase-progress-band${band.id}`, 'phase-progress', band.label,
      Math.min(...children.map((item) => item.start)), Math.max(...children.map((item) => item.start)),
      `${children.length} 个分片进度节点`,
    ));
  }

  const projectedNodes = projected.map((item) => ({
    id: item.id, parentId: parentFor(item), semanticKey: semanticKey(item), subjectRef: item.label,
    label: item.label, kind: nodeKind(item), start: item.time, boundary: 'observed', importance: 'key', detail: item.detail,
    evidence: [],
  }));
  nodes.push(...projectedNodes, ...detailNodes);

  const detailIds = (prefix) => detailNodes.filter((item) => item.id.startsWith(prefix)).map((item) => item.id);
  const relations = experiment.links.map((link) => {
    const target = projected.find((item) => item.id === link.to);
    let scopeNodeId;
    let ids = [];
    if (target && /权重开始|Worker 权重/i.test(target.label)) {
      scopeNodeId = 'phase-workers'; ids = detailIds('worker-init-');
    } else if (target && (target.kind === 'progress' || target.kind === 'open')) {
      const percent = Number(target.label.match(/(\d+)%/)?.[1] ?? target.detail.match(/(\d+)\/(\d+)/)?.[1] ?? 100);
      scopeNodeId = 'phase-progress';
      ids = progress.map((item, index) => ({ item, id: `weight-progress-${index}` })).filter(({ item }) => item.percent <= percent).map(({ id }) => id);
    } else if (target?.kind === 'rank') {
      const dp = target.label.match(/DP\s*(\d+)/i)?.[1];
      scopeNodeId = dp === undefined ? 'phase-main' : `phase-main-dp${dp}`;
      ids = detailNodes.filter((item) => item.parentId === scopeNodeId).map((item) => item.id);
    } else if (target && (target.kind === 'ready' || /graph|图捕获|engine 完成/i.test(target.label))) {
      scopeNodeId = 'phase-runtime'; ids = detailIds('runtime-');
    } else if (target?.kind === 'mtp') {
      const dp = target.label.match(/DP\s*(\d+)/i)?.[1];
      scopeNodeId = dp === undefined ? 'phase-mtp' : `phase-mtp-dp${dp}`;
      ids = detailNodes.filter((item) => dp === undefined ? item.parentId?.startsWith('phase-mtp-dp') : item.parentId === scopeNodeId).map((item) => item.id);
    }
    return { id: link.id, from: link.from, to: link.to, kind: link.kind, origin: link.origin, ...(ids.length ? { scopeNodeId, detailNodeIds: ids } : {}) };
  });

  return {
    id: experiment.id, model: experiment.model, label: experiment.name, shortLabel: experiment.shortName, config: experiment.config,
    startedAt: new Date((origin || Date.now() / 1000) * 1000).toISOString(), totalSeconds: experiment.total,
    ...(experiment.mainWeight === undefined ? {} : { mainWeightSeconds: experiment.mainWeight }), status: experiment.status,
    statusLabel: experiment.statusLabel, rootNodeId: 'run', nodes, relations,
    projection: { nodeIds: projected.map((item) => item.id), relationIds: relations.map((item) => item.id) },
  };
}

const p8EvidenceIds = new Set(compiledP8.nodes.flatMap((node) => node.evidence.map((reference) => reference.evidenceId)));
const evidence = compiled.evidence.filter((item, index, items) => p8EvidenceIds.has(item.id) && items.findIndex((candidate) => candidate.id === item.id) === index);
const runs = [];
for (const experiment of realExperiments) {
  if (experiment.id === 'glm-p8-e2e-20260825') {
    runs.push(compiledP8);
    continue;
  }
  const specs = catalog[experiment.id];
  if (!specs) throw new Error(`missing evidence catalog for ${experiment.id}`);
  const sources = await loadSources(experiment.id, specs);
  evidence.push(...sources.map((source) => ({
    id: source.id, relativePath: source.relativePath, sha256: createHash('sha256').update(source.buffer).digest('hex'),
    bytes: source.buffer.byteLength, lines: source.buffer.toString('utf8').split(/\r?\n/).length,
  })));
  runs.push(compileLegacyRun(experiment, sources));
}

const errors = [];
for (const run of runs) {
  const ids = new Set(run.nodes.map((node) => node.id));
  for (const node of run.nodes) if (node.parentId && !ids.has(node.parentId)) errors.push(`${run.id}:${node.id} missing parent ${node.parentId}`);
  for (const relation of run.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) errors.push(`${run.id}:${relation.id} missing endpoint`);
    for (const id of relation.detailNodeIds ?? []) if (!ids.has(id)) errors.push(`${run.id}:${relation.id} missing detail ${id}`);
  }
}

const bundle = {
  schemaVersion: 'semantic-timeline/v1', generatedAt: new Date().toISOString(), parser: { name: 'model-load-log-compiler', version: '0.2.0' },
  evidence, runs, validation: { valid: errors.length === 0, errors, counts: {
    runs: runs.length, nodes: runs.reduce((sum, run) => sum + run.nodes.length, 0),
    relations: runs.reduce((sum, run) => sum + run.relations.length, 0), evidence: evidence.length,
  } },
};
if (errors.length) throw new Error(errors.join('\n'));
await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(bundle.validation));
