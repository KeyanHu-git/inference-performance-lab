'use client';

import { Check, ChevronDown, FileUp, SlidersHorizontal, X } from 'lucide-react';
import { ChangeEvent, CSSProperties, PointerEvent, useMemo, useRef, useState } from 'react';
import { baselineWeight, formatSeconds, RealExperiment, realExperiments, TimeNode } from './comparison-model';

type Selection = { experiment: RealExperiment; node: TimeNode };
type ParsedLine = { line: string; index: number; time?: number };

function lineTime(line: string) {
  const match = line.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  return Date.UTC(2026, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])) / 1000;
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
  const ready = find(/engine core initialization took|init engine.*took|Application startup complete|service.*ready/i);

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
  return {
    id: `local-${Date.now()}-${order}`,
    name: short,
    shortName: short,
    config: `手工导入 · ${file.name}`,
    date: stamp,
    total,
    mainWeight,
    complete: Boolean(ready),
    source: file.name,
    nodes,
  };
}

function moveJelly(event: PointerEvent<HTMLDivElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width;
  const y = (event.clientY - box.top) / box.height;
  event.currentTarget.style.setProperty('--mx', `${x * 100}%`);
  event.currentTarget.style.setProperty('--my', `${y * 100}%`);
  event.currentTarget.style.setProperty('--ry', `${(x - 0.5) * 1.4}deg`);
  event.currentTarget.style.setProperty('--rx', `${(0.5 - y) * 1.8}deg`);
}

function resetJelly(event: PointerEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty('--mx', '42%');
  event.currentTarget.style.setProperty('--my', '8%');
  event.currentTarget.style.setProperty('--ry', '0deg');
  event.currentTarget.style.setProperty('--rx', '0deg');
}

function NodeMarker({ node, duration, onSelect }: { node: TimeNode; duration: number; onSelect: (node: TimeNode) => void }) {
  const position = Math.min(99.4, (node.time / duration) * 100);
  return (
    <button
      className={`embedded-node node-${node.kind} lane-${node.lane ?? 0}`}
      style={{ left: `${position}%` }}
      onClick={(event) => { event.stopPropagation(); onSelect(node); }}
      aria-label={`${node.label}，${formatSeconds(node.time)}，${node.detail}`}
      title={`${node.label} · ${formatSeconds(node.time)} · ${node.detail}`}
    >
      <span>{node.label}</span>
    </button>
  );
}

export default function ComparisonWorkbench() {
  const [experiments, setExperiments] = useState<RealExperiment[]>(realExperiments);
  const [visibleIds, setVisibleIds] = useState(realExperiments.map((item) => item.id));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [baseline, setBaseline] = useState('dtfs-a');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importNote, setImportNote] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const visibleExperiments = useMemo(() => experiments.filter((item) => visibleIds.includes(item.id)), [experiments, visibleIds]);
  const maximumTime = useMemo(() => {
    const longest = Math.max(...visibleExperiments.map((item) => item.total), 300);
    return Math.ceil(longest / 300) * 300;
  }, [visibleExperiments]);
  const ticks = useMemo(() => Array.from({ length: Math.floor(maximumTime / 300) + 1 }, (_, index) => index * 300), [maximumTime]);
  const baselineExperiment = experiments.find((item) => item.id === baseline) ?? experiments[0];
  const referenceWeight = baselineExperiment?.mainWeight ?? baselineWeight;
  const importedCount = Math.max(0, experiments.length - realExperiments.length);

  function toggleExperiment(id: string) {
    const next = visibleIds.includes(id) ? visibleIds.filter((item) => item !== id) : [...visibleIds, id];
    setVisibleIds(next);
    if (baseline === id && !next.includes(id)) {
      setBaseline(experiments.find((item) => next.includes(item.id) && item.mainWeight)?.id ?? '');
    }
  }

  async function importLogs(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const parsed = (await Promise.all(files.map(async (file, index) => parseLog(await file.text(), file, index)))).filter((item): item is RealExperiment => Boolean(item));
    if (parsed.length) {
      setExperiments((current) => [...current, ...parsed]);
      setVisibleIds((current) => [...current, ...parsed.map((item) => item.id)]);
      setImportNote(`已导入 ${parsed.length}/${files.length} 个日志`);
    } else if (files.length) {
      setImportNote('未识别到可定位的加载阶段');
    }
    event.target.value = '';
  }

  const sourceLabel = selected?.experiment.source.includes('/')
    ? `/models/wangakang/KeyanHu-workspace/${selected.experiment.source}`
    : selected?.experiment.source;

  return (
    <main className="compare-app">
      <header className="compare-header">
        <div className="compare-title"><span className="mark"><span /></span><h1>模型加载对比</h1></div>
        <div className="header-count"><strong>{visibleExperiments.length}</strong> 个实验<span>{7 + importedCount} 个日志</span></div>
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
                        <span className="check-box">{checked && <Check size={11} />}</span><span>{experiment.shortName}</span>
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
          <span className="axis-label">RUN</span>
          <div className="shared-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }}>{formatSeconds(tick)}</span>)}</div>
          <span className="axis-metric">权重</span>
        </div>

        <div className="experiment-list">
          {visibleExperiments.map((experiment, index) => {
            const width = (experiment.total / maximumTime) * 100;
            const delta = experiment.mainWeight && referenceWeight ? ((experiment.mainWeight - referenceWeight) / referenceWeight) * 100 : undefined;
            return (
              <article
                className={`experiment-row${baseline === experiment.id ? ' is-baseline' : ''}`}
                key={experiment.id}
                onDoubleClick={() => experiment.mainWeight && setBaseline(experiment.id)}
                title={`${experiment.name} · ${experiment.config} · 双击设为基线`}
              >
                <div className="experiment-name">
                  <span className="run-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{experiment.shortName}</strong>
                  {baseline === experiment.id && <span className="base-dot" title="当前基线" />}
                </div>

                <div className="band-track">
                  {ticks.map((tick) => <span className="track-grid" key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }} />)}
                  <div
                    className={`jelly-shell${experiment.complete ? '' : ' is-open'}`}
                    style={{ width: `${width}%`, '--band-scale': `${10000 / width}%`, '--mx': '42%', '--my': '8%', '--rx': '0deg', '--ry': '0deg' } as CSSProperties}
                    onPointerMove={moveJelly}
                    onPointerLeave={resetJelly}
                  >
                    <span className="jelly-color" /><span className="jelly-depth" /><span className="jelly-specular" />
                    {experiment.nodes.map((node) => <NodeMarker key={node.id} node={node} duration={experiment.total} onSelect={(value) => setSelected({ experiment, node: value })} />)}
                  </div>
                </div>

                <div className="weight-result">
                  {experiment.mainWeight ? <strong>{formatSeconds(experiment.mainWeight)}</strong> : <strong>12/70</strong>}
                  {delta !== undefined ? <span className={delta <= 0 ? 'faster' : 'slower'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span> : <span className="partial">未完成</span>}
                </div>
              </article>
            );
          })}
          {!visibleExperiments.length && <div className="empty-state">从“实验”中选择需要对比的记录</div>}
        </div>
      </section>

      {selected && (
        <aside className="node-popover">
          <button className="popover-close" onClick={() => setSelected(null)} aria-label="关闭"><X size={13} /></button>
          <strong>{selected.node.label}<span>{formatSeconds(selected.node.time)}</span></strong>
          <p>{selected.node.detail}</p>
          <code>{sourceLabel}:{selected.node.locator}</code>
        </aside>
      )}

      <footer className="compare-footer">
        <span>数据快照 <code>/models/wangakang/KeyanHu-workspace</code></span>
        <span>2026-08-24 11:38 · {7 + importedCount} logs · {experiments.length} runs</span>
      </footer>
    </main>
  );
}
