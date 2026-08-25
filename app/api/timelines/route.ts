import { getTimelineBundle } from '@/backend/timeline-service';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(getTimelineBundle(), {
    headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' },
  });
}
