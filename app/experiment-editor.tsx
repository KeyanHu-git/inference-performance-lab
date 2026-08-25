'use client';

import { Check, Link2, Plus, Save, Trash2, X } from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { formatSeconds, normalizeExperiment, RealExperiment, TimeLink, TimeNode } from './comparison-model';

const laneY = (node: TimeNode) => node.lane === 0 ? 24 : node.lane === 1 ? 76 : 50;

export function ExperimentEditor({ experiment, onCancel, onSave }: {
  experiment: RealExperiment;
  onCancel: () => void;
  onSave: (experiment: RealExperiment) => void;
}) {
  const [draft, setDraft] = useState(experiment);
  const [selectedId, setSelectedId] = useState(experiment.nodes[0]?.id ?? '');
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const selected = draft.nodes.find((node) => node.id === selectedId);
  const nodeMap = useMemo(() => new Map(draft.nodes.map((node) => [node.id, node])), [draft.nodes]);

  function updateNode(id: string, patch: Partial<TimeNode>) {
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }));
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, node: TimeNode) {
    if ((event.target as HTMLElement).closest('.graph-port')) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(node.id);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const bounds = stage.current?.getBoundingClientRect();
      if (!bounds) return;
      const ratioX = Math.max(0, Math.min(1, (moveEvent.clientX - bounds.left) / bounds.width));
      const ratioY = Math.max(0, Math.min(1, (moveEvent.clientY - bounds.top) / bounds.height));
      const lane = ratioY < .38 ? 0 : ratioY > .62 ? 1 : undefined;
      updateNode(node.id, { time: Number((ratioX * draft.total).toFixed(2)), lane });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function addNode() {
    const id = `human-${Date.now()}`;
    const node: TimeNode = { id, label: '新节点', time: Number((draft.total / 2).toFixed(2)), kind: 'progress', detail: '待补充说明', locator: 'human' };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(id);
  }

  function deleteNode(id = selectedId) {
    if (!id) return;
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      links: current.links.filter((link) => link.from !== id && link.to !== id),
    }));
    if (selectedId === id) setSelectedId('');
    if (linkingFrom === id) setLinkingFrom(null);
  }

  function connectTo(targetId: string) {
    if (!linkingFrom || linkingFrom === targetId) return;
    const source = nodeMap.get(linkingFrom);
    const target = nodeMap.get(targetId);
    if (!source || !target) return;
    const exists = draft.links.some((link) => link.from === source.id && link.to === target.id);
    if (!exists) {
      const kind: TimeLink['kind'] = source.lane === undefined && target.lane !== undefined
        ? 'branch'
        : source.lane !== undefined && target.lane === undefined ? 'join' : 'sequence';
      setDraft((current) => ({ ...current, links: [...current.links, {
        id: `human-link-${Date.now()}`,
        from: source.id,
        to: target.id,
        kind,
        origin: 'declared',
        interactive: true,
      }] }));
    }
    setSelectedId(targetId);
    setLinkingFrom(null);
  }

  function deleteLink(id: string) {
    setDraft((current) => ({ ...current, links: current.links.filter((link) => link.id !== id) }));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input, textarea, select')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) deleteNode(selectedId);
      if (event.key === 'Escape') {
        if (linkingFrom) setLinkingFrom(null);
        else onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="graph-editor-backdrop" role="dialog" aria-modal="true" aria-label="时间关系编辑器">
      <section className="graph-editor">
        <header className="graph-editor-head">
          <div><small>时间关系编辑器</small><strong>{draft.model}</strong></div>
          <div className="graph-title-fields">
            <input aria-label="实验标签" value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} />
            <input aria-label="实验备注" placeholder="添加实验备注" value={draft.note ?? ''} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
          </div>
          <div className="graph-head-actions"><button onClick={onCancel}>取消</button><button className="graph-save" onClick={() => onSave(normalizeExperiment(draft))}><Save size={12} />保存</button><button className="graph-close" onClick={onCancel} aria-label="关闭"><X size={15} /></button></div>
        </header>

        <div className="graph-toolbar">
          <button onClick={addNode}><Plus size={13} />新增节点</button>
          <span className={linkingFrom ? 'linking-active' : ''}><Link2 size={12} />{linkingFrom ? `正在连接：${nodeMap.get(linkingFrom)?.label} → 请选择目标端口` : '点击节点右端口，再选择目标节点左端口'}</span>
          <span className="graph-legend"><i />主轴 <i />侧轴 A <i />侧轴 B</span>
        </div>

        <div className="graph-canvas" onPointerDown={(event) => { if (event.target === event.currentTarget) { setSelectedId(''); setLinkingFrom(null); } }}>
          <div className="graph-stage" ref={stage}>
            <div className="graph-time-axis"><span>0s</span><span>{formatSeconds(draft.total / 2)}</span><span>{formatSeconds(draft.total)}</span></div>
            <div className="graph-lane lane-a"><span>侧轴 A</span></div>
            <div className="graph-lane lane-main"><span>主轴</span></div>
            <div className="graph-lane lane-b"><span>侧轴 B</span></div>
            <svg className="graph-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {draft.links.map((link) => {
                const from = nodeMap.get(link.from);
                const to = nodeMap.get(link.to);
                if (!from || !to) return null;
                const x1 = Math.max(1, Math.min(99, (from.time / draft.total) * 100));
                const x2 = Math.max(1, Math.min(99, (to.time / draft.total) * 100));
                const y1 = laneY(from);
                const y2 = laneY(to);
                const curve = Math.max(2, Math.abs(x2 - x1) * .42);
                return <path key={link.id} className={`graph-link origin-${link.origin}`} d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`} vectorEffect="non-scaling-stroke" />;
              })}
            </svg>
            {draft.nodes.map((node) => {
              const x = Math.max(1, Math.min(99, (node.time / draft.total) * 100));
              const selectedNode = node.id === selectedId;
              return (
                <article
                  key={node.id}
                  className={`graph-node kind-${node.kind}${selectedNode ? ' is-selected' : ''}${linkingFrom === node.id ? ' is-linking' : ''}`}
                  style={{ left: `${x}%`, top: `${laneY(node)}%` }}
                  onPointerDown={(event) => startDrag(event, node)}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(node.id); }}
                >
                  <button className="graph-port port-in" onClick={(event) => { event.stopPropagation(); connectTo(node.id); }} aria-label={`连接到 ${node.label}`} />
                  <div className="graph-node-head"><span>{node.label}</span><small>T+{formatSeconds(node.time)}</small></div>
                  <p>{node.detail}</p>
                  <button className="graph-port port-out" onClick={(event) => { event.stopPropagation(); setLinkingFrom(node.id); setSelectedId(node.id); }} aria-label={`从 ${node.label} 开始连接`} />
                </article>
              );
            })}
          </div>
        </div>

        {selected && <aside className="graph-inspector">
          <div className="graph-inspector-head"><strong>{selected.label}</strong><button onClick={() => deleteNode()} title="删除节点"><Trash2 size={12} /></button></div>
          <label>名称<input value={selected.label} onChange={(event) => updateNode(selected.id, { label: event.target.value })} /></label>
          <div className="graph-field-pair">
            <label>时间（秒）<input type="number" min="0" max={draft.total} step="0.1" value={selected.time} onChange={(event) => updateNode(selected.id, { time: Math.max(0, Math.min(draft.total, Number(event.target.value))) })} /></label>
            <label>类型<select value={selected.kind} onChange={(event) => updateNode(selected.id, { kind: event.target.value as TimeNode['kind'] })}><option value="start">起点</option><option value="progress">进度</option><option value="rank">分支</option><option value="mtp">阶段</option><option value="ready">完成</option><option value="open">未闭合</option></select></label>
          </div>
          <label>说明<textarea rows={2} value={selected.detail} onChange={(event) => updateNode(selected.id, { detail: event.target.value })} /></label>
          <div className="graph-relations"><span>关系</span>{draft.links.filter((link) => link.from === selected.id || link.to === selected.id).map((link) => <button key={link.id} onClick={() => deleteLink(link.id)}><span>{nodeMap.get(link.from)?.label} → {nodeMap.get(link.to)?.label}</span><X size={10} /></button>)}{!draft.links.some((link) => link.from === selected.id || link.to === selected.id) && <small>暂无关系</small>}</div>
        </aside>}

        <div className="graph-status"><Check size={11} />拖动节点改变时间与主/侧轴；端口建立关系；Delete 删除选中节点。</div>
      </section>
    </div>
  );
}
