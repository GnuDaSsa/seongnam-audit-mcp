import { createHash } from 'node:crypto';

// Fingerprint the searchable cases and extracted text, independent of local
// temporary paths, harvest times, HTTP form tokens and compressed file headers.
export function cityCorpusHash(city, pages) {
  const records=city.cases.map(item=>[item.id,item.title,item.agency,item.category,item.year,pages[item.source_id]]);
  records.sort(([a],[b])=>a.localeCompare(b,'en'));
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}
