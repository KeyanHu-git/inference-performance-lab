import ComparisonWorkbench from './comparison-workbench';
import PerformanceShell from './performance-shell';
import './comparison.css';
import './performance-shell.css';
import { getTimelineBundle } from '@/backend/timeline-service';
import { experimentsFromTimelineBundle } from './timeline-adapter';

export default function Home() {
  const bundle = getTimelineBundle();
  return (
    <PerformanceShell>
      <ComparisonWorkbench backendExperiments={experimentsFromTimelineBundle(bundle)} backendEvidenceCount={bundle.evidence.length} />
    </PerformanceShell>
  );
}
