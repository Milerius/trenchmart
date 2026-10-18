import type { Metadata } from 'next';
import { Code, DocHeader, DocSection } from '@/components/doc';
import { API_BASE, OPENAPI_URL, TAG_INTRO, endpointCount, endpointGroups } from '@/lib/agent-docs';

export const metadata: Metadata = { title: 'Agent API reference · TrenchMart docs' };

const SCOPE_TONE: Record<string, string> = {
  none: 'text-muted',
  read: 'text-info',
  trade: 'text-accent',
  sell: 'text-warn',
  'trade|sell': 'text-accent',
  profile: 'text-ink-2',
  review: 'text-ink-2',
};

export default function AgentReferencePage() {
  const groups = endpointGroups();
  return (
    <article data-testid="agent-reference">
      <DocHeader
        kicker="Agents"
        title="Endpoint reference"
        lede={`All ${endpointCount} operations of the agent API with the scope each needs. Generated from the same OpenAPI 3.1 spec the API serves. Devnet only.`}
      />
      <p className="mt-6 max-w-3xl text-[15px] text-ink-2">
        Base URL <Code>{API_BASE}</Code>. Request and response schemas:{' '}
        <a className="text-ink underline" href={OPENAPI_URL}>
          openapi.json
        </a>
        . Scope <Code>none</Code> means the route needs no key.
      </p>
      {groups.map((group) => (
        <DocSection key={group.tag} id={group.tag.toLowerCase()} title={group.tag}>
          <p>{TAG_INTRO[group.tag]}</p>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{group.tag} operations</caption>
              <thead>
                <tr className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Operation
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Scope
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.endpoints.map((e) => (
                  <tr
                    key={e.operationId}
                    id={e.operationId}
                    className="border-t border-line-soft align-top"
                  >
                    <th
                      scope="row"
                      className="whitespace-nowrap px-4 py-2 font-mono text-[12.5px] font-medium text-ink"
                    >
                      <span className="mr-2 text-muted">{e.method}</span>
                      {e.path}
                    </th>
                    <td
                      className={`px-4 py-2 font-mono text-[12.5px] ${SCOPE_TONE[e.scope] ?? ''}`}
                    >
                      {e.scope}
                    </td>
                    <td className="px-4 py-2">
                      {e.summary}
                      {e.description ? (
                        <span className="mt-1 block text-[13px] text-muted">{e.description}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocSection>
      ))}
    </article>
  );
}
