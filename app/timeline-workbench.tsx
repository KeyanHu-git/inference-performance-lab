'use client';

import {
  AlertTriangle,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Command,
  Crosshair,
  Database,
  FileCode2,
  FileText,
  GitCompareArrows,
  Maximize2,
  Minus,
  PanelRightClose,
  Plus,
  Search,
  TerminalSquare,
} from 'lucide-react';
import { CSSProperties, useMemo, useRef, useState } from 'react';
import {
  experimentRuns,
  findNode,
  flattenVisibleRows,
  formatTime,
  timelineDomain,
  TimelineNode,
  TimelineState,
} from './timeline-model';

type Alignment = 'run' | 'absolute' | 'anchor';

const stateLabel: Record<TimelineState, string> = {
  confirmed: '已确认',
  inferred: '解释提案',
  partial: '证据不完整',
  conflict: '存在冲突',
};

const ticks = Array.from({ length: 12 }, (_, index) => index * 120);

function StateMark({ state, compact = false }: { state: TimelineState; compact?: boolean }) {
  return (
    <span className={`state-mark state-${state}${compact ? ' compact' : ''}`}>
      {state === 'confirmed' ? <Check size={11} /> : <CircleDot size={11} />}
      {!compact && stateLabel[state]}
    </span>
  );
}

function rowPosition(node: TimelineNode): CSSProperties {
  if (node.start === undefined) return {};
  const span = timelineDomain[1] - timelineDomain[0];
  const left = ((node.start - timelineDomain[0]) / span) * 100;
  const duration = Math.max((node.end ?? node.start) - node.start, 3);
  const width = Math.max((duration / span) * 100, node.kind === 'milestone' ? 0.7 : 1.1);
  return { left: `${left}%`, width: `${width}%` };
}

function TimelineGlyph({ node, selected, onSelect }: { node: TimelineNode; selected: boolean; onSelect: () => void }) {
  const label = `${node.label}，${formatTime(node.start)} 至 ${node.kind === 'open' ? '开放边界' : formatTime(node.end)}`;

  if (node.kind === 'unlocated') {
    return (
      <button className={`unlocated-glyph${selected ? ' selected' : ''}`} onClick={onSelect} aria-label={`${node.label}，未定位`}>
        <AlertTriangle size={12} /> 未定位
      </button>
    );
  }

  if (node.kind === 'milestone') {
    return (
      <button className={`milestone-glyph state-${node.state}${selected ? ' selected' : ''}`} style={rowPosition(node)} onClick={onSelect} aria-label={label}>
        <span />
      </button>
    );
  }

  if (node.kind === 'extent') {
    return (
      <button className={`extent-glyph${selected ? ' selected' : ''}`} style={rowPosition(node)} onClick={onSelect} aria-label={label}>
        <span className="extent-caption">3 个并行分支</span>
      </button>
    );
  }

  if (node.kind === 'open') {
    return (
      <button className={`open-glyph${selected ? ' selected' : ''}`} style={rowPosition(node)} onClick={onSelect} aria-label={label}>
        <span className="bar-gradient" />
        <span className="open-fade" />
        <span className="open-tag">开放至数据水位</span>
      </button>
    );
  }

  return (
    <button className={`activity-glyph state-${node.state}${selected ? ' selected' : ''}`} style={rowPosition(node)} onClick={onSelect} aria-label={label}>
      <span className="bar-gradient" />
      <span className="duration-label">{formatTime((node.end ?? node.start ?? 0) - (node.start ?? 0))}</span>
    </button>
  );
}

export default function TimelineWorkbench() {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['run-baseline', 'run-prefetch', 'run-ramdisk', 'baseline-load']),
  );
  const [selectedId, setSelectedId] = useState('baseline-load');
  const [alignment, setAlignment] = useState<Alignment>('run');
  const [zoom, setZoom] = useState(1);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hierarchyRowsRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => flattenVisibleRows(experimentRuns, expanded), [expanded]);
  const selected = findNode(selectedId) ?? findNode('baseline-load')!;

  const toggle = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fitTimeline = () => {
    setZoom(1);
    if (scrollRef.current) scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
  };

  return (
    <main className={`workbench${inspectorOpen ? '' : ' inspector-closed'}`}>
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-orbit"><span /></span>
          <div>
            <strong>ChronoScope</strong>
            <small>MODEL LOAD LAB</small>
          </div>
        </div>

        <div className="project-crumb">
          <span>河套集群</span><ChevronRight size={13} /><strong>DeepSeek-V4-Flash</strong>
          <span className="demo-badge">演示数据</span>
        </div>

        <div className="header-actions">
          <button className="icon-button" title="搜索事件"><Search size={16} /></button>
          <button className="cli-button"><TerminalSquare size={15} /> Agent CLI <Command size={12} /></button>
          <span className="sync-state"><span /> 已编译 · v12</span>
        </div>
      </header>

      <section className="context-rail">
        <div className="rail-heading">
          <span className="eyebrow">ACTIVE PROJECT</span>
          <h1>模型加载全链路</h1>
          <p>证据驱动的实验时间图谱</p>
        </div>

        <nav className="run-nav" aria-label="实验版本">
          <span className="rail-section-label">实验版本 · 3</span>
          {experimentRuns.map((run, index) => (
            <button
              key={run.id}
              className={`run-nav-item${selected.run.id === run.id ? ' active' : ''}`}
              onClick={() => {
                setSelectedId(run.nodes[0].id);
                document.getElementById(`row-${run.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <span className="run-index">0{index + 1}</span>
              <span className="run-copy"><strong>{run.name}</strong><small>{run.subtitle}</small></span>
              <span className={`run-dot state-${run.state}`} />
            </button>
          ))}
        </nav>

        <div className="rail-footer">
          <div className="coverage-ring" style={{ '--coverage': '86%' } as CSSProperties}><span>86</span></div>
          <div><strong>证据覆盖率</strong><small>29 / 34 个边界可追溯</small></div>
        </div>
      </section>

      <section className="main-surface">
        <div className="surface-header">
          <div>
            <span className="eyebrow">TIMELINE WORKBENCH</span>
            <h2>启动链路对齐</h2>
            <p>以 Run 起点为零，比较阶段位置、重叠关系与证据边界。</p>
          </div>

          <div className="surface-controls">
            <div className="segmented" aria-label="对齐方式">
              {([
                ['run', 'Run 起点'],
                ['absolute', '绝对时间'],
                ['anchor', '语义锚点'],
              ] as [Alignment, string][]).map(([value, label]) => (
                <button key={value} className={alignment === value ? 'active' : ''} onClick={() => setAlignment(value)}>{label}</button>
              ))}
            </div>
            <div className="zoom-controls">
              <button title="缩小" onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}><Minus size={14} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button title="放大" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}><Plus size={14} /></button>
              <button title="适配全部" onClick={fitTimeline}><Maximize2 size={14} /></button>
            </div>
          </div>
        </div>

        <div className="scope-note">
          <Crosshair size={14} />
          <span><strong>当前坐标：</strong>{alignment === 'run' ? '距各 Run 起点的相对时间' : alignment === 'absolute' ? '采集时钟的绝对时间' : '距“开始加载权重”语义锚点'}</span>
          <span className="scope-divider" />
          <span>光谱细带仅表示单条活动内部的时间推进</span>
        </div>

        <div className="timeline-frame">
          <div className="hierarchy-pane">
            <div className="pane-axis-title"><Braces size={14} /> 语义层级</div>
            <div className="hierarchy-rows" ref={hierarchyRowsRef}>
              {rows.map((row) => (
                <div key={row.key} id={row.type === 'run' ? `row-${row.run.id}` : undefined} className={`hierarchy-row row-${row.type}`}>
                  <button
                    className="tree-toggle"
                    disabled={!row.hasChildren}
                    onClick={() => toggle(row.type === 'run' ? row.run.id : row.node!.id)}
                    aria-label={row.expanded ? '折叠' : '展开'}
                    style={{ marginLeft: `${row.type === 'node' ? (row.depth - 1) * 18 : 0}px` }}
                  >
                    {row.hasChildren ? row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="leaf-joint" />}
                  </button>
                  {row.type === 'run' ? (
                    <div className="hierarchy-copy run-copy"><strong>{row.run.name}</strong><small>{row.run.subtitle}</small></div>
                  ) : (
                    <button className={`hierarchy-copy node-copy${selectedId === row.node!.id ? ' selected' : ''}`} onClick={() => setSelectedId(row.node!.id)}>
                      <span>{row.node!.label}</span>
                      <small>{row.node!.kind === 'extent' ? `${row.node!.children?.length ?? 0} 个并行分支` : formatTime((row.node!.end ?? row.node!.start ?? 0) - (row.node!.start ?? 0))}</small>
                    </button>
                  )}
                  {row.type === 'node' && <StateMark state={row.node!.state} compact />}
                </div>
              ))}
            </div>
          </div>

          <div
            className="timeline-scroll"
            ref={scrollRef}
            onScroll={(event) => {
              if (hierarchyRowsRef.current) {
                hierarchyRowsRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
              }
            }}
          >
            <div className="timeline-content" style={{ width: `${Math.round(1780 * zoom)}px` }}>
              <div className="time-axis">
                <span className="axis-unit">T + 秒</span>
                {ticks.map((tick) => (
                  <span key={tick} className="tick-label" style={{ left: `${(tick / timelineDomain[1]) * 100}%` }}>{tick === 0 ? '00:00' : formatTime(tick)}</span>
                ))}
              </div>

              <div className="timeline-rows">
                {rows.map((row) => (
                  <div key={row.key} className={`timeline-row row-${row.type}`}>
                    {ticks.map((tick) => <span key={tick} className="grid-line" style={{ left: `${(tick / timelineDomain[1]) * 100}%` }} />)}
                    {row.type === 'run' ? (
                      <>
                        <span className="run-baseline" style={{ width: `${(((row.run.duration ?? 1094) / timelineDomain[1]) * 100)}%` }} />
                        <span className="run-total">{row.run.duration ? formatTime(row.run.duration) : '开放区间'} · {row.run.completeness}% 证据覆盖</span>
                      </>
                    ) : (
                      <TimelineGlyph node={row.node!} selected={selectedId === row.node!.id} onSelect={() => setSelectedId(row.node!.id)} />
                    )}
                  </div>
                ))}
              </div>

              <div className="minimap">
                <span className="minimap-window" style={{ width: `${Math.max(15, 100 / zoom)}%` }} />
                <span className="mini-bar bar-a" /><span className="mini-bar bar-b" /><span className="mini-bar bar-c" />
                <span className="minimap-label">全局视图 · 拖动时间轴横向浏览</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="evidence-inspector" aria-label="证据详情">
        <div className="inspector-head">
          <div><span className="eyebrow">EVIDENCE TRACE</span><h2>证据追溯</h2></div>
          <button className="icon-button" title="收起详情" onClick={() => setInspectorOpen(false)}><PanelRightClose size={16} /></button>
        </div>

        <div className="selected-summary">
          <div className="summary-line"><StateMark state={selected.node.state} /><span>{selected.node.evidence.length} 条证据</span></div>
          <h3>{selected.node.label}</h3>
          <p>{selected.node.detail}</p>
          <dl className="time-facts">
            <div><dt>开始</dt><dd>{formatTime(selected.node.start)}</dd></div>
            <div><dt>结束</dt><dd>{selected.node.kind === 'open' ? '开放边界' : formatTime(selected.node.end)}</dd></div>
            <div><dt>跨度</dt><dd>{selected.node.start === undefined ? '—' : formatTime((selected.node.end ?? selected.node.start) - selected.node.start)}</dd></div>
          </dl>
        </div>

        <div className="trace-chain">
          <span className="trace-title">追溯链</span>
          <div className="trace-step active"><CircleDot size={14} /><span><strong>语义节点</strong><small>{selected.node.id}</small></span></div>
          <div className="trace-step"><GitCompareArrows size={14} /><span><strong>事件决策</strong><small>{selected.node.state === 'inferred' ? 'proposed · 待确认' : 'confirmed'}</small></span></div>
          <div className="trace-step"><FileCode2 size={14} /><span><strong>提取事件</strong><small>{selected.node.evidence[0]?.id ?? '无直接事件'}</small></span></div>
          <div className="trace-step"><Database size={14} /><span><strong>原始证据</strong><small>{selected.node.evidence[0]?.source ?? '无'}</small></span></div>
        </div>

        {selected.node.evidence.map((item) => (
          <article className="evidence-card" key={item.id}>
            <div className="evidence-card-head"><FileText size={14} /><strong>{item.source}</strong><span>{item.locator}</span></div>
            <code>{item.excerpt}</code>
            <dl><div><dt>采集时间</dt><dd>{item.observedAt}</dd></div><div><dt>解析器</dt><dd>{item.parser}</dd></div></dl>
          </article>
        ))}

        <div className="inspector-foot"><AlertTriangle size={14} /><span>解释提案不会自动覆盖已确认事实。</span></div>
      </aside>

      {!inspectorOpen && (
        <button className="reopen-inspector" onClick={() => setInspectorOpen(true)}><FileText size={15} /> 查看证据</button>
      )}
    </main>
  );
}
