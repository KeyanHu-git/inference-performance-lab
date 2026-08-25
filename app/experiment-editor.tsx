'use client';

import { GripHorizontal, Plus, Save, Trash2, X } from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { formatSeconds, normalizeExperiment, RealExperiment, TimeNode } from './comparison-model';

export function ExperimentEditor({ experiment, onCancel, onSave }: {
  experiment: RealExperiment;
  onCancel: () => void;
  onSave: (experiment: RealExperiment) => void;
}) {
  const [draft, setDraft] = useState(experiment);
  const [selectedId, setSelectedId] = useState(experiment.nodes[0]?.id ?? '');
  const rail = useRef<HTMLDivElement>(null);
  const selected = draft.nodes.find((node) => node.id === selectedId);

  function updateNode(id: string, patch: Partial<TimeNode>) {
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }));
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, node: TimeNode) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(node.id);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const bounds = rail.current?.getBoundingClientRect();
      if (!bounds) return;
      const ratio = Math.max(0, Math.min(1, (moveEvent.clientX - bounds.left) / bounds.width));
      updateNode(node.id, { time: Number((ratio * draft.total).toFixed(2)) });
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
    const node: TimeNode = {
      id,
      label: '人工节点',
      time: Number((draft.total / 2).toFixed(2)),
      kind: 'progress',
      detail: '人工补充；尚未声明时间关系',
      locator: 'human',
    };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(id);
  }

  function deleteNode() {
    if (!selected) return;
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selected.id),
      links: current.links.filter((link) => link.from !== selected.id && link.to !== selected.id),
    }));
    setSelectedId('');
  }

  return (
    <aside className="experiment-editor" aria-label="编辑实验标注">
      <header><div><small>人工修订层</small><strong>{draft.model}</strong></div><button onClick={onCancel} aria-label="关闭"><X size={14} /></button></header>
      <label>实验标签<input value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} /></label>
      <label>备注<textarea rows={2} placeholder="写入左侧标签列；不改变自动判定状态" value={draft.note ?? ''} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>

      <div className="editor-section-head"><span>时间节点</span><button onClick={addNode}><Plus size={12} />新增</button></div>
      <div className="editor-rail" ref={rail}>
        <span className="editor-rail-line" />
        {draft.nodes.map((node) => (
          <button
            key={node.id}
            className={node.id === selectedId ? 'is-selected' : ''}
            style={{ left: `${Math.min(100, (node.time / draft.total) * 100)}%` }}
            onPointerDown={(event) => startDrag(event, node)}
            title={`${node.label} · ${formatSeconds(node.time)}`}
          ><GripHorizontal size={10} /></button>
        ))}
      </div>
      <small className="editor-hint">拖动只改变时间位置；新增节点默认无关系，避免制造不存在的因果链。</small>

      {selected && <div className="node-fields">
        <label>名称<input value={selected.label} onChange={(event) => updateNode(selected.id, { label: event.target.value })} /></label>
        <div className="field-pair">
          <label>时间（秒）<input type="number" min="0" max={draft.total} step="0.1" value={selected.time} onChange={(event) => updateNode(selected.id, { time: Math.max(0, Math.min(draft.total, Number(event.target.value))) })} /></label>
          <label>侧轴<select value={selected.lane ?? 'main'} onChange={(event) => updateNode(selected.id, { lane: event.target.value === 'main' ? undefined : Number(event.target.value) as 0 | 1 })}><option value="main">主轴</option><option value="0">侧轴 A</option><option value="1">侧轴 B</option></select></label>
        </div>
        <label>说明<input value={selected.detail} onChange={(event) => updateNode(selected.id, { detail: event.target.value })} /></label>
        <button className="editor-delete" onClick={deleteNode}><Trash2 size={12} />删除节点及其关系</button>
      </div>}

      <footer><button onClick={onCancel}>取消</button><button className="editor-save" onClick={() => onSave(normalizeExperiment(draft))}><Save size={12} />保存修订</button></footer>
    </aside>
  );
}
