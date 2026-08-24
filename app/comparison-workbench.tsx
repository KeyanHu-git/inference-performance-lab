'use client';

import { Database, FileText, RotateCcw } from 'lucide-react';
import { CSSProperties, PointerEvent, useState } from 'react';
import { baselineWeight, formatSeconds, maximumTime, realExperiments, TimeNode } from './comparison-model';

const ticks = [0, 300, 600, 900, 1200, 1500];

function moveJelly(event: PointerEvent<HTMLDivElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width;
  const y = (event.clientY - box.top) / box.height;
  event.currentTarget.style.setProperty('--mx', `${x * 100}%`);
  event.currentTarget.style.setProperty('--my', `${y * 100}%`);
  event.currentTarget.style.setProperty('--ry', `${(x - 0.5) * 5}deg`);
  event.currentTarget.style.setProperty('--rx', `${(0.5 - y) * 7}deg`);
}

function resetJelly(event: PointerEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty('--mx', '50%');
  event.currentTarget.style.setProperty('--my', '15%');
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
  const [selected, setSelected] = useState<{ experiment: string; node: TimeNode } | null>(null);
  const [baseline, setBaseline] = useState('dtfs-a');
  const baselineExperiment = realExperiments.find((item) => item.id === baseline) ?? realExperiments[0];
  const referenceWeight = baselineExperiment.mainWeight ?? baselineWeight;

  return (
    <main className="compare-app">
      <header className="compare-header">
        <div className="compare-title">
          <span className="mark"><span /></span>
          <div><h1>模型加载实验对比</h1><p>DeepSeek-V4-Flash · W8A8</p></div>
        </div>
        <div className="source-state"><Database size={14} /><strong>7 个原始日志</strong><span>最后记录 08-24 11:38</span></div>
      </header>

      <section className="compare-toolbar">
        <div className="mode-title"><strong>权重加载时间线</strong><span>颜色与横轴时间位置一致</span></div>
        <div className="baseline-control">
          <label htmlFor="baseline">对比基线</label>
          <select id="baseline" value={baseline} onChange={(event) => setBaseline(event.target.value)}>
            {realExperiments.filter((item) => item.mainWeight).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button onClick={() => setBaseline('dtfs-a')} title="恢复默认基线"><RotateCcw size={13} /></button>
        </div>
      </section>

      <section className="comparison-board">
        <div className="axis-row">
          <span className="axis-label">实验</span>
          <div className="shared-axis">
            {ticks.map((tick) => <span key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }}>{formatSeconds(tick)}</span>)}
          </div>
          <span className="axis-metric">主权重</span>
        </div>

        <div className="experiment-list">
          {realExperiments.map((experiment) => {
            const width = (experiment.total / maximumTime) * 100;
            const delta = experiment.mainWeight && referenceWeight
              ? ((experiment.mainWeight - referenceWeight) / referenceWeight) * 100
              : undefined;
            return (
              <article className={`experiment-row${baseline === experiment.id ? ' is-baseline' : ''}`} key={experiment.id}>
                <div className="experiment-name">
                  <div><strong>{experiment.name}</strong>{baseline === experiment.id && <span className="base-tag">基线</span>}</div>
                  <p>{experiment.config}</p><time>{experiment.date}</time>
                </div>

                <div className="band-track">
                  {ticks.map((tick) => <span className="track-grid" key={tick} style={{ left: `${(tick / maximumTime) * 100}%` }} />)}
                  <div
                    className={`jelly-shell${experiment.complete ? '' : ' is-open'}`}
                    style={{
                      width: `${width}%`,
                      '--band-scale': `${10000 / width}%`,
                      '--mx': '50%', '--my': '15%', '--rx': '0deg', '--ry': '0deg',
                    } as CSSProperties}
                    onPointerMove={moveJelly}
                    onPointerLeave={resetJelly}
                  >
                    <span className="jelly-color" />
                    <span className="jelly-depth" />
                    <span className="jelly-specular" />
                    {experiment.nodes.map((node) => (
                      <NodeMarker key={node.id} node={node} duration={experiment.total} onSelect={(value) => setSelected({ experiment: experiment.name, node: value })} />
                    ))}
                  </div>
                </div>

                <div className="weight-result">
                  {experiment.mainWeight ? <strong>{formatSeconds(experiment.mainWeight)}</strong> : <strong>12 / 70</strong>}
                  {delta !== undefined ? <span className={delta <= 0 ? 'faster' : 'slower'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span> : <span className="partial">未完成</span>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="compare-footer">
        <span><FileText size={13} /> 数据来自 KeyanHu-workspace 原始 vLLM 日志</span>
        {selected ? (
          <button className="selected-node" onClick={() => setSelected(null)}>
            <strong>{selected.experiment} · {selected.node.label} · {formatSeconds(selected.node.time)}</strong>
            <span>{selected.node.detail} · {selected.node.locator}</span>
          </button>
        ) : <span className="hover-hint">指向或点击色带内节点查看原始位置</span>}
      </footer>
    </main>
  );
}
