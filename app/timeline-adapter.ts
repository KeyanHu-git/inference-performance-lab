import type { SemanticNode, TimelineBundle, TimelineRun } from '@/backend/semantic-timeline';
import { normalizeExperiment, type NodeKind, type RealExperiment, type TimeNode } from './comparison-model';

function nodeKind(node: SemanticNode): NodeKind {
  if (node.semanticKey === 'service.verified') return 'ready';
  if (node.semanticKey.includes('mtp')) return 'mtp';
  if (node.kind === 'activity' || node.subjectRef.startsWith('dp:') || node.subjectRef.startsWith('node:')) return 'rank';
  return node.semanticKey.includes('progress') ? 'progress' : 'start';
}

function evidenceLocator(node: SemanticNode, bundle: TimelineBundle) {
  return node.evidence.map((reference) => {
    const source = bundle.evidence.find((item) => item.id === reference.evidenceId);
    const lines = reference.lineStart === reference.lineEnd ? `L${reference.lineStart}` : `L${reference.lineStart}–${reference.lineEnd}`;
    return `${source?.relativePath ?? reference.evidenceId} ${lines}`;
  }).join('；');
}

function projectNode(run: TimelineRun, node: SemanticNode, bundle: TimelineBundle): TimeNode {
  return {
    id: `${run.id}:${node.id}`,
    label: node.label,
    time: node.end ?? node.start,
    kind: nodeKind(node),
    detail: node.detail,
    locator: evidenceLocator(node, bundle),
    parentId: node.parentId ? `${run.id}:${node.parentId}` : undefined,
    semanticKey: node.semanticKey,
    subjectRef: node.subjectRef,
    boundary: node.boundary,
  };
}

export function experimentsFromTimelineBundle(bundle: TimelineBundle): RealExperiment[] {
  return bundle.runs.map((run) => {
    const byId = new Map(run.nodes.map((node) => [node.id, node]));
    const projected = new Set(run.projection.nodeIds);
    const relationIds = new Set(run.projection.relationIds);
    const nodes = run.projection.nodeIds.map((id) => byId.get(id)).filter((node): node is SemanticNode => Boolean(node)).map((node) => projectNode(run, node, bundle));
    const detailNodes = run.nodes.filter((node) => !projected.has(node.id) && node.kind !== 'run' && node.kind !== 'phase').map((node) => projectNode(run, node, bundle));
    const links = run.relations.filter((relation) => relationIds.has(relation.id)).map((relation) => ({
      id: `${run.id}:${relation.id}`,
      from: `${run.id}:${relation.from}`,
      to: `${run.id}:${relation.to}`,
      kind: relation.kind,
      origin: relation.origin,
      interactive: true,
      detailNodeIds: relation.detailNodeIds?.map((id) => `${run.id}:${id}`),
    }));
    const detailLinks = links.flatMap((link) => (link.detailNodeIds ?? []).flatMap((detailId, index) => ([
      { id: `${link.id}:detail:${index}:in`, from: link.from, to: detailId, kind: 'branch' as const, origin: 'observed' as const, interactive: true },
      { id: `${link.id}:detail:${index}:out`, from: detailId, to: link.to, kind: 'join' as const, origin: 'observed' as const, interactive: true },
    ])));
    const normalized = normalizeExperiment({
      id: run.id,
      name: run.label,
      model: run.model,
      shortName: run.shortLabel,
      config: run.config,
      date: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(run.startedAt)).replace('/', '-'),
      total: run.totalSeconds,
      mainWeight: run.mainWeightSeconds,
      source: `SemanticTimeline · ${bundle.parser.name}@${bundle.parser.version}`,
      nodes,
      links,
      detailNodes,
      detailLinks,
    });
    return { ...normalized, status: run.status, statusLabel: run.statusLabel };
  });
}
