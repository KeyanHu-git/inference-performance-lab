'use client';

import {
  Activity,
  Braces,
  FileSearch2,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

const SIDEBAR_KEY = 'chronoscope.performance-sidebar.v1';

export default function PerformanceShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarReady, setSidebarReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    const hydrate = window.setTimeout(() => {
      if (stored !== null) setSidebarOpen(stored === 'open');
      setSidebarReady(true);
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, []);

  useEffect(() => {
    if (!sidebarReady) return;
    localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? 'open' : 'closed');
  }, [sidebarOpen, sidebarReady]);

  useEffect(() => {
    const toggleSidebar = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'b') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setSidebarOpen((open) => !open);
    };

    window.addEventListener('keydown', toggleSidebar);
    return () => window.removeEventListener('keydown', toggleSidebar);
  }, []);

  return (
    <div className={`performance-shell${sidebarOpen ? ' sidebar-open' : ' sidebar-closed'}`}>
      <aside className="performance-sidebar" aria-label="性能分析导航" aria-hidden={!sidebarOpen}>
        <header className="performance-brand">
          <span className="brand-symbol"><Activity size={15} /></span>
          <span><strong>推理性能分析</strong><small>PERFORMANCE LAB</small></span>
        </header>

        <nav className="performance-nav">
          <section>
            <h2>离线准备</h2>
            <span className="nav-item is-active" aria-current="page"><Gauge size={14} /><span><strong>Prepare &amp; Load</strong><small>离线准备与模型加载</small></span></span>
          </section>

          <section>
            <h2>在线请求</h2>
            <span className="nav-item nav-muted"><Route size={14} /><span><strong>Request Trace</strong><small>Route → Prefill → KV → Decode → Serve</small></span></span>
          </section>

          <section>
            <h2>横向分析</h2>
            <span className="nav-item nav-muted"><Braces size={14} /><span><strong>Lifecycle</strong><small>运行生命周期</small></span></span>
            <span className="nav-item nav-muted"><FileSearch2 size={14} /><span><strong>Project</strong><small>项目静态检查</small></span></span>
          </section>
        </nav>

        <footer className="performance-sidebar-foot">
          <span><span className="status-dot" />当前模块</span>
          <strong>Prepare &amp; Load</strong>
        </footer>
      </aside>

      <section className="performance-content">
        <button
          className="sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
          aria-expanded={sidebarOpen}
          title={`${sidebarOpen ? '收起' : '展开'}侧栏（Ctrl+B）`}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
        <div className="performance-page">{children}</div>
      </section>
    </div>
  );
}
