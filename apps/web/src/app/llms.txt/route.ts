import { llmsTxt } from '@/lib/agent-docs';

export const dynamic = 'force-static';

/** https://llmstxt.org index for agents, served raw. */
export function GET() {
  return new Response(llmsTxt(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
      'access-control-allow-origin': '*',
    },
  });
}
