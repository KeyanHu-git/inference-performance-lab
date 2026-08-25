import bundleData from '@/app/generated/timeline-bundle.json';
import type { TimelineBundle } from './semantic-timeline';

const bundle = bundleData as TimelineBundle;

export function getTimelineBundle(): TimelineBundle {
  if (bundle.schemaVersion !== 'semantic-timeline/v1' || !bundle.validation.valid) {
    throw new Error('SemanticTimeline 数据未通过校验');
  }
  return bundle;
}
