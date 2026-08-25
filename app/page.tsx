import ComparisonWorkbench from './comparison-workbench';
import './comparison.css';
import { getTimelineBundle } from '@/backend/timeline-service';
import { experimentsFromTimelineBundle } from './timeline-adapter';

export default function Home() {
  const bundle = getTimelineBundle();
  return <ComparisonWorkbench backendExperiments={experimentsFromTimelineBundle(bundle)} backendEvidenceCount={bundle.evidence.length} />;
}
