'use client';

import { Check, ChevronDown, FileUp, SlidersHorizontal, X } from 'lucide-react';
import { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import { formatSeconds, RealExperiment, realExperiments, realLogCount, RunStatus, TimeLink, TimeNode } from './comparison-model';

type Selection = { experiment: RealExperiment; node: TimeNode; anchor: { left: number; top: number; above: boolean } };
type RelationFocus = { experimentId: string; linkId: string } | null;
type ParsedLine = { line: string; index: number; time?: number };

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
  if (progress) add(progress.item, `权重 ${progress.done}/${progress.total}`, 'progress', `Safetensors ${progress.percent}%`);
  const mainWeight = Number(main?.line.match(/Loading weights took\s+([\d.]+)/i)?.[1] ?? 0) || undefined;
  add(main, '主权重', 'rank', mainWeight ? `主权重 ${mainWeight.toFixed(2)} s` : '主权重完成');
  add(mtp, 'MTP 权重', 'mtp', 'MTP 权重完成');
  add(ready, '服务就绪', 'ready', '服务初始化完成');
  nodes.sort((a, b) => a.time - b.time);
  if (nodes.length < 2) return null;

  const total = Math.max(1, nodes.at(-1)?.time ?? mainWeight ?? 1);
  const short = file.name.replace(/\.(log|txt)$/i, '').slice(0, 20);
  const stamp = engine.line.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})/)?.[1] ?? '本地导入';
  const status: RunStatus = ready ? 'complete' : main ? 'evidence-gap' : progress ? 'partial' : 'evidence-gap';
  const statusLabel = status === 'complete'
    ? '已完成 · 服务就绪'
    : status === 'partial'
      ? `未完成 · 停于 ${progress?.done ?? '?'}\/${progress?.total ?? '?'}`
      : '证据残缺 · 缺服务终点';
  return {
    id: `local-${Date.now()}-${order}`,
    name: short,
    model: detectModel(text, file.name),
    shortName: short,
    config: `手工导入 · ${file.name}`,
    date: stamp,
    total,
    mainWeight,
    status,
    statusLabel,
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

function nodeLaneY(node: TimeNode) {
  if (node.lane === 0) return 14;
  if (node.lane === 1) return 36;
  return 25;
}

function relationPath(link: TimeLink, nodes: Map<string, TimeNode>, duration: number) {
  const source = nodes.get(link.from);
  const target = nodes.get(link.to);
  if (!source || !target) return '';
  const x1 = Math.min(99.4, (source.time / duration) * 100);
  const x2 = Math.min(99.4, (target.time / duration) * 100);
  const y1 = nodeLaneY(source);
  const y2 = nodeLaneY(target);
  if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const bend = Math.max(0.8, Math.min(3.2, (x2 - x1) * 0.28));
  if (link.kind === 'branch') return `M ${x1} ${y1} L ${x1 + bend} ${y1} C ${x1 + bend * 1.35} ${y1} ${x2 - bend * 0.7} ${y2} ${x2} ${y2}`;
  return `M ${x1} ${y1} C ${x1 + bend * 0.7} ${y1} ${x2 - bend * 1.35} ${y2} ${x2 - bend} ${y2} L ${x2} ${y2}`;
}

function RelationLayer({
  experiment,
  selectedNodeId,
  focusedLinkId,
  onLinkFocus,
}: {
  experiment: RealExperiment;
  selectedNodeId?: string;
  focusedLinkId?: string;
  onLinkFocus: (linkId?: string) => void;
}) {
  const nodes = new Map(experiment.nodes.map((node) => [node.id, node]));
  return (
    <svg className="relation-layer" viewBox="0 0 100 50" preserveAspectRatio="none" role="group" aria-label={`${experiment.shortName} 阶段关系`}>
      {experiment.links.map((link) => {
        const interactive = link.interactive !== false;
        const active = interactive && (focusedLinkId ? focusedLinkId === link.id : selectedNodeId === link.from || selectedNodeId === link.to);
        const dimmed = interactive && Boolean(focusedLinkId || selectedNodeId) && !active;
        const path = relationPath(link, nodes, experiment.total);
        const source = nodes.get(link.from)?.label ?? link.from;
        const target = nodes.get(link.to)?.label ?? link.to;
        return (
          <g key={link.id}>
            <path
              className={`relation-link relation-${link.kind} origin-${link.origin}${interactive ? ' is-interactive' : ' is-static'}${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`}
              d={path}
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
            {interactive && (
              <path
                className="relation-hit"
                d={path}
                vectorEffect="non-scaling-stroke"
                tabIndex={0}
                role="button"
                aria-label={`${source} 至 ${target} 的时间关系`}
                onPointerEnter={() => onLinkFocus(link.id)}
                onPointerLeave={(event) => {
                  if (document.activeElement !== event.currentTarget) onLinkFocus();
                }}
                onFocus={() => onLinkFocus(link.id)}
                onBlur={() => onLinkFocus()}
                onClick={(event) => {
                  event.stopPropagation();
                  event.currentTarget.focus();
                  onLinkFocus(link.id);
                }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function NodeMarker({
  node,
  duration,
  selected,
  relationState,
  onSelect,
}: {
  node: TimeNode;
  duration: number;
  selected: boolean;
  relationState: 'idle' | 'endpoint' | 'dimmed' | 'unlinked';
  onSelect: (node: TimeNode, anchor: Selection['anchor']) => void;
}) {
  const position = Math.min(99.4, (node.time / duration) * 100);
  const laneClass = node.lane === undefined ? 'lane-main' : `lane-${node.lane}`;
  return (
    <button
      className={`embedded-node node-${node.kind} ${laneClass} relation-${relationState}${selected ? ' is-selected' : ''}`}
      style={{ left: `${position}%`, '--node-y': `${nodeLaneY(node)}px` } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const tooltipWidth = 248;
        const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, rect.left + rect.width / 2 - tooltipWidth / 2));
        const above = rect.top > 150;
        onSelect(node, { left, top: above ? rect.top - 7 : rect.bottom + 7, above });
      }}
      aria-label={`${node.label}，${formatSeconds(node.time)}，${node.detail}`}
      title={`${node.label} · ${formatSeconds(node.time)} · ${node.detail}`}
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

export default function ComparisonWorkbench() {
  const [experiments, setExperiments] = useState<RealExperiment[]>(realExperiments);
  const [visibleIds, setVisibleIds] = useState(realExperiments.map((item) => item.id));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [baselines, setBaselines] = useState<Record<string, string>>({
    'DeepSeek-V4': 'dtfs-a',
    'GLM-5.2 W8A8': 'glm-ram-cold',
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [labelWidth, setLabelWidth] = useState(162);
  const [relationFocus, setRelationFocus] = useState<RelationFocus>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const visibleExperiments = useMemo(() => experiments.filter((item) => visibleIds.includes(item.id)), [experiments, visibleIds]);
  const maximumTime = useMemo(() => {
    const longest = Math.max(...visibleExperiments.map((item) => item.total), 300);
    return Math.ceil(longest / 300) * 300;
  }, [visibleExperiments]);
  const ticks = useMemo(() => Array.from({ length: Math.floor(maximumTime / 300) + 1 }, (_, index) => index * 300), [maximumTime]);
  const importedCount = Math.max(0, experiments.length - realExperiments.length);
  const logCount = realLogCount + importedCount;

  function toggleExperiment(id: string) {
    const next = visibleIds.includes(id) ? visibleIds.filter((item) => item !== id) : [...visibleIds, id];
    setVisibleIds(next);
    const target = experiments.find((item) => item.id === id);
    if (target && baselines[target.model] === id && !next.includes(id)) {
      const replacement = experiments.find((item) => item.model === target.model && next.includes(item.id) && item.mainWeight);
      setBaselines((current) => ({ ...current, [target.model]: replacement?.id ?? '' }));
    }
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
      setBaselines((current) => {
        const next = { ...current };
        parsed.forEach((item) => {
          if (!next[item.model] && item.mainWeight) next[item.model] = item.id;
        });
        return next;
      });
      setImportNote(`已导入 ${parsed.length}/${files.length} 个日志`);
    } else if (files.length) {
      setImportNote('未识别到可定位的加载阶段');
    }
    event.target.value = '';
  }

  return (
    <main className="compare-app" style={{ '--run-column': `${labelWidth}px` } as CSSProperties}>
      <header className="compare-header">
        <div className="compare-title"><span className="mark"><span /></span><h1>模型加载对比</h1></div>
        <div className="header-count"><strong>{visibleExperiments.length}</strong> 个实验<span>{logCount} 个日志</span></div>
      </header>

      <section className="compare-toolbar">
        <div className="mode-title"><strong>实验时间轴</strong>{importNote && <span className="import-note">{importNote}</span>}</div>
        <div className="toolbar-actions">
          <input ref={fileInput} className="file-input" type="file" accept=".log,.txt,text/plain" multiple onChange={importLogs} />
          <button className="tool-button" onClick={() => fileInput.current?.click()}><FileUp size={14} />导入 LOG</button>
          <div className="picker-wrap">
            <button className="tool-button" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
              <SlidersHorizontal size={14} />实验 {visibleExperiments.length}/{experiments.length}<ChevronDown size={13} />
            </button>
            {pickerOpen && (
              <div className="experiment-picker">
                <div className="picker-head"><strong>选择对比实验</strong><button onClick={() => setPickerOpen(false)} aria-label="关闭"><X size={13} /></button></div>
                <div className="picker-list">
                  {experiments.map((experiment) => {
                    const checked = visibleIds.includes(experiment.id);
                    return (
                      <button className={checked ? 'picker-item checked' : 'picker-item'} key={experiment.id} onClick={() => toggleExperiment(experiment.id)}>
                        <span className="check-box">{checked && <Check size={11} />}</span><span><strong>{experiment.model}</strong><small>{experiment.shortName}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div className="picker-foot"><button onClick={() => setVisibleIds(experiments.map((item) => item.id))}>全选</button><span>双击实验设为基线</span></div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="comparison-board">
        <div className="axis-row">
          <span className="axis-label">实验<button className="column-resizer" onPointerDown={startColumnResize} onDoubleClick={() => setLabelWidth(162)} aria-label="调整实验列宽度" title="拖动调整列宽，双击恢复" /></span>
          <div className="shared-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }}>{formatSeconds(tick)}</span>)}</div>
          <span className="axis-metric">全链路</span>
        </div>

        <div className="experiment-list">
          {visibleExperiments.map((experiment) => {
            const width = (experiment.total / maximumTime) * 100;
            const referenceExperiment = experiments.find((item) => item.id === baselines[experiment.model])
              ?? experiments.find((item) => item.model === experiment.model && item.status === 'complete');
            const delta = experiment.status === 'complete' && referenceExperiment?.status === 'complete'
              ? ((experiment.total - referenceExperiment.total) / referenceExperiment.total) * 100
              : undefined;
            const isBaseline = baselines[experiment.model] === experiment.id;
            const focusedLink = relationFocus?.experimentId === experiment.id
              ? experiment.links.find((link) => link.id === relationFocus.linkId)
              : undefined;
            return (
              <article
                className={`experiment-row${isBaseline ? ' is-baseline' : ''}`}
                key={experiment.id}
                onDoubleClick={() => experiment.status === 'complete' && setBaselines((current) => ({ ...current, [experiment.model]: experiment.id }))}
                title={`${experiment.name} · ${experiment.config}${experiment.status === 'complete' ? ' · 双击设为该模型基线' : ''}`}
              >
                <div className="experiment-name">
                  <div><strong>{experiment.model}</strong><span>{experiment.shortName}</span><small className={`run-status status-${experiment.status}`}><i />{experiment.statusLabel}</small></div>
                  {isBaseline && <span className="base-dot" title="当前模型基线" />}
                </div>

                <div className="band-track">
                  {ticks.map((tick) => <span className="track-grid" key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }} />)}
                  <div
                    className={`jelly-shell status-${experiment.status}`}
                    style={{ width: `${width}%`, '--band-scale': `${10000 / width}%`, '--mx': '42%', '--my': '8%' } as CSSProperties}
                    onPointerMove={moveJelly}
                    onPointerLeave={resetJelly}
                  >
                    <span className="jelly-color" /><span className="jelly-depth" /><span className="jelly-specular" />
                    <RelationLayer
                      experiment={experiment}
                      selectedNodeId={selected?.experiment.id === experiment.id ? selected.node.id : undefined}
                      focusedLinkId={focusedLink?.id}
                      onLinkFocus={(linkId) => setRelationFocus(linkId ? { experimentId: experiment.id, linkId } : null)}
                    />
                    {experiment.nodes.map((node) => {
                      const hasInteractiveRelation = experiment.links.some((link) => link.interactive !== false && (link.from === node.id || link.to === node.id));
                      const relationState = !hasInteractiveRelation
                        ? 'unlinked'
                        : focusedLink
                          ? focusedLink.from === node.id || focusedLink.to === node.id ? 'endpoint' : 'dimmed'
                          : 'idle';
                      return <NodeMarker key={node.id} node={node} duration={experiment.total} selected={selected?.experiment.id === experiment.id && selected.node.id === node.id} relationState={relationState} onSelect={(value, anchor) => setSelected({ experiment, node: value, anchor })} />;
                    })}
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

      {selected && (
        <aside
          className={`node-popover ${selected.anchor.above ? 'popover-above' : 'popover-below'}`}
          style={{ left: selected.anchor.left, top: selected.anchor.top, transform: selected.anchor.above ? 'translateY(-100%)' : undefined }}
        >
          <button className="popover-close" onClick={() => setSelected(null)} aria-label="关闭"><X size={13} /></button>
          <strong>{selected.node.label}<span>T+{formatSeconds(selected.node.time)}</span></strong>
          <p>{describeNode(selected.node)}</p>
          <p className="popover-relation">{describeRelations(selected.experiment, selected.node)}</p>
        </aside>
      )}

      <footer className="compare-footer">
        <span>数据快照 <code>/models/wangakang/KeyanHu-workspace</code></span>
        <span>2026-08-25 10:33 · {logCount} logs · {experiments.length} runs</span>
      </footer>
    </main>
  );
}
