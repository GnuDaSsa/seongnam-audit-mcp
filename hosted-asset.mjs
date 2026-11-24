// The official template places a single public case body inside board-view-content.
// The heading and surrounding navigation/forms are not part of an audit finding.
export function caseMarkup(html) {
  const start = /<div\b[^>]*\bclass=["']board-view-content["'][^>]*>/i.exec(html);
  if (!start) throw new Error('Missing case body');
  const begin = start.index + start[0].length;
  const div = /<\/?div\b[^>]*>/gi;
  div.lastIndex = begin;
  let depth = 1;
  for (let tag; (tag = div.exec(html));) {
    depth += tag[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(begin, tag.index);
  }
  throw new Error('Unclosed case body');
}

export function caseText(markup, entities) {
  // Collector uses BeautifulSoup.get_text('\n', strip=True), preserving internal whitespace.
  const blocks = markup.split(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi);
  return blocks.map(block => block.replace(/&(#x[\da-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gi, (full, entry) => {
    if (entry[0] === '#') {
      const n = entry[1]?.toLowerCase() === 'x' ? parseInt(entry.slice(2), 16) : Number(entry.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full;
    }
    return Object.hasOwn(entities, entry) ? entities[entry] : full;
  }).trim()).filter(Boolean).join('\n');
}

export const sha256Hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');

export async function gunzip(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
