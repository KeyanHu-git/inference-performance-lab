export type SemanticNodeKind = 'run' | 'phase' | 'activity' | 'event';
export type EvidenceBoundary = 'observed' | 'derived' | 'declared';

export interface EvidenceRef {
  evidenceId: string;
  lineStart: number;
  lineEnd: number;
}

export interface SemanticNode {
  id: string;
  parentId: string | null;
  semanticKey: string;
  subjectRef: string;
  label: string;
  kind: SemanticNodeKind;
  start: number;
  end?: number;
  boundary: EvidenceBoundary;
  importance: 'key' | 'diagnostic' | 'raw';
  detail: string;
  evidence: EvidenceRef[];
}

export interface SemanticRelation {
  id: string;
  from: string;
  to: string;
  kind: 'sequence' | 'branch' | 'join';
  origin: 'observed' | 'declared' | 'inferred' | 'fallback';
  detailNodeIds?: string[];
}

export interface TimelineRun {
  id: string;
  model: string;
  label: string;
  shortLabel: string;
  config: string;
  startedAt: string;
  totalSeconds: number;
  mainWeightSeconds?: number;
  status: 'complete' | 'partial' | 'evidence-gap';
  statusLabel: string;
  rootNodeId: string;
  nodes: SemanticNode[];
  relations: SemanticRelation[];
  projection: { nodeIds: string[]; relationIds: string[] };
}

export interface TimelineBundle {
  schemaVersion: 'semantic-timeline/v1';
  generatedAt: string;
  parser: { name: string; version: string };
  evidence: Array<{
    id: string;
    relativePath: string;
    sha256: string;
    bytes: number;
    lines: number;
  }>;
  runs: TimelineRun[];
  validation: {
    valid: boolean;
    errors: string[];
    counts: { runs: number; nodes: number; relations: number; evidence: number };
  };
}
