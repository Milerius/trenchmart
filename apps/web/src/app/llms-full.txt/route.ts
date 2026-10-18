import { llmsFullTxt } from '@/lib/agent-docs';

export const dynamic = 'force-static';

/** The whole agent API documentation in one plain-text file, served raw. */
export function GET() {
  return new Response(llmsFullTxt(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
      'access-control-allow-origin': '*',
    },
  });
}
