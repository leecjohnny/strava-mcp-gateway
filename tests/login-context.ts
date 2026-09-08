import assert from 'node:assert/strict';
import type { LoginContext } from '../web/login.ts';

export async function loginContext(response: { text(): Promise<string> }): Promise<LoginContext> {
  const html = await response.text();
  const attribute = /<main\b[^>]*\bdata-login="([^"]*)"/.exec(html)?.[1];
  assert.ok(attribute, 'Authorization HTML must contain one escaped login context');
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
  };
  const parsed: unknown = JSON.parse(
    attribute.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => entities[entity]),
  );
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  for (const name of ['authorization_url', 'redirect_uri', 'state', 'issuer'])
    assert.ok(name in parsed && typeof parsed[name as keyof typeof parsed] === 'string', name);
  return parsed as LoginContext;
}
