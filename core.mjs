const sourceSets = ['city', 'foundation', 'province'];
const noMatch = '수록 범위에서 질문과 대조할 공개 사례를 찾지 못했습니다. 공개 사례의 유무만으로 감사 지적 여부를 판단할 수 없습니다.';
const normalize = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const compact = value => normalize(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Offsets refer to JavaScript UTF-16 positions in the supplied text. For verification
// that text is NFC-normalized with runs of whitespace collapsed to a single space.
const decimal = String.raw`\p{Nd}+(?:[,.，．]\p{Nd}+)*`;
const magnitude = String.raw`[십백천만억조]+(?=\s*(?:\p{Nd}|원|달러|건|명|개|톤|$)|[.,;:()\s])`;
const currency = String.raw`(?:원|달러|퍼센트|[%％])(?=$|[^\p{L}\p{N}]|[이가은는을를의에만씩당으로])`;
const articleNumber = `제\\s*(${decimal})(?=\\s*조)`;
const numberExpression = new RegExp(`${articleNumber}|[+＋−－-]?${decimal}(?:\\s*${magnitude}(?:\\s*${decimal})?)*(?:\\s*${currency})?`, 'gu');

function numericSpans(text) {
  return Array.from(text.matchAll(numberExpression), match => {
    const end = match.index + match[0].length;
    // "제12조 3항" refers to two distinct legal provisions, even though 조 is also a monetary scale.
    if (match[1]) return { start: end - match[1].length, end };
    // A dash between digits, as in a year range, does not give the latter year a negative sign.
    const isRange = /^[-－−]/u.test(match[0]) && /\p{Nd}/u.test(text[match.index - 1] ?? '');
    return { start: match.index + (isRange ? 1 : 0), end };
  });
}

export function locateQuote(text, quote) {
  const spans = numericSpans(text);
  let index = text.indexOf(quote);
  if (!quote || index < 0) return {error:'quote_not_in_original'};
  while (index >= 0) {
    const end = index + quote.length;
    const cutsNumber = spans.some(span =>
      (span.start < index && index < span.end) || (span.start < end && end < span.end));
    if (!cutsNumber) return {start:index, end};
    index = text.indexOf(quote, index + 1);
  }
  return {error:'quote_cuts_numeric_expression'};
}

export function excerptBounds(text, start, end, spans = numericSpans(text)) {
  for (const span of spans) {
    if (span.start < start && start < span.end) start = span.end;
    if (span.start < end && end < span.end) end = span.start;
  }
  if (/[\uDC00-\uDFFF]/u.test(text[start] ?? '')) start++;
  if (/[\uD800-\uDBFF]/u.test(text[end-1] ?? '')) end--;
  return {start, end:Math.max(start,end)};
}

export function boundedExcerpt(text, start, end, spans) {
  const bounds = excerptBounds(text,start,end,spans);
  return text.slice(bounds.start, bounds.end).trim();
}
const generalWords = new Set(('내가 저는 제가 저희 우리 해당 업무 경우 관련 사안 처리 내용 사업 감사 감사정보 감사결과 감사사례 사례 지적 질문 ' +
  '걸릴까 걸리는지 걸리나 걸릴까요 봐줘 봐주세요 알려줘 알려주세요 확인 확인해줘 찾아줘 주세요 있는지 있을까 어떻게 이런 이거 했는데 했어 했으면 했어요 했습니다 ' +
  '문제 위험 성남 성남시 성남시청 기관 부서 직원 담당자 대상 당시 진행 대하여 관하여 대한 부적정 소홀 ' +
  '자료 문서 검토 검토해 처리 제출 부탁 부탁해 한번 괜찮은지 정상적 정상적으로 같은 해당 업체 건가요 바랍니다 조금 이게').split(/\s+/u));
const requestVerb = /^(?:(?:확인|처리|검토|진행|판단|문의|작성)(?:해|하|했|할|한|됩|되|됐|된|될|해야|받)|걸리|걸릴|걸렸|봐주|봐달|봐야|있나요|있을지|있을까요|없을지|어떤지)/u;
const unspecifiedSubject = /^(?:이|그|저)?(?:건|것|일)(?:도|만|까지|에서|을|이|은|은요|으로|인가요)?$/u;
const splitPurchase = ['분할구매', '구매분할', '분할계약', '분할수의계약', '단일물품분할'];
// Expressions people use in questions alongside terminology used in Korean audit findings.
const expressions = [
  ['분할발주', '분할계약', '쪼개기', '나눠발주', '나누어발주', '나눠계약', '나누어계약', '분리발주', '분할수의계약'],
  ['수의계약', '수의시담', '1인견적', '단독견적', '한업체와계약'],
  ['견적비교', '비교견적', '복수견적', '두곳견적', '타견적', '2인이상견적'],
  ['업무추진비', '업추비', '기관운영업무추진', '시책추진업무추진'],
  ['법인카드', '공용카드', '업무용카드', '클린카드', '기관카드', '신용카드'],
  ['시간외근무', '초과근무', '연장근로', '연장근무', '야근수당'],
  ['출장여비', '출장비', '여비', '관내출장', '관외출장', '출장경비', '출장'],
  ['수당중복', '중복수령', '이중지급', '중복지급', '이중수령'],
  ['지방보조금', '민간보조', '보조사업', '보조금'],
  ['정산보고', '정산검사', '정산서', '정산'],
  ['증빙서류', '지출증빙', '증빙자료', '영수증', '증빙'],
  ['검사조서', '검수조서', '물품검수', '검수', '준공검사'],
  ['지연배상금', '지체상금', '납품지연', '납기지연'],
  ['사후결재', '사후승인', '나중에결재', '뒤늦게결재', '뒤늦게승인', '사후품의'],
  ['복무관리', '근태관리', '근무상황', '복무'],
  ['채용절차', '직원채용', '공개채용', '채용공고', '채용'],
  ['연가보상비', '연차수당', '미사용연차', '연가보상'],
  ['대관료', '시설사용료', '시설대관', '대관사용료'],
  ['계약보증금', '계약이행보증', '계약보증서'],
  ['하자보수보증', '하자보증금', '하자보증서', '하자검사'],
];

function keywords(query) {
  const terms = new Set();
  for (const token of normalize(query).toLowerCase().match(/[가-힣a-z0-9]{2,}/gu) ?? []) {
    if (requestVerb.test(token) || unspecifiedSubject.test(token)) continue;
    const stem = token.replace(/(?:에서는|으로부터|에게서|에서|으로는|으로|하고|부터|까지|에는|에도|이나|이나요|이라면|처럼|하였는데|했는데|했습니다|했어요|했어|을|를|은|는|에|와|과|로|도|의|만|가)$/u, '');
    const word = stem.length >= 2 ? stem : token;
    if (!generalWords.has(token) && !generalWords.has(word) && !/^\d+(?:년|월|일)?$/u.test(word)) terms.add(word);
  }
  return [...terms];
}

function lexicalProfile(query) {
  const flattened = compact(query);
  const groups = expressions.filter(group => group.some(word => flattened.includes(word)));
  if (splitPurchase.some(word => flattened.includes(word)) ||
      /(?:나눠|나누어|쪼개|나눴|나누었).{0,12}(?:주문|구매|구입|발주|계약|샀)|(?:구매|주문|구입).{0,12}(?:나눠|쪼개|나눴)/u.test(flattened)) {
    groups.push(splitPurchase);
  }
  return { terms: keywords(query), groups };
}

function matchWeight(text, profile) {
  let score = 0;
  for (const term of profile.terms) if (text.includes(term)) score += Math.min(term.length, 7) / 3;
  for (const group of profile.groups) if (group.some(word => text.includes(word))) score += 2;
  return score;
}

function lexicalCandidate(row, profile) {
  const headingWeight = matchWeight(row.heading, profile);
  const bodyWeight = matchWeight(row.body, profile);
  if ((!headingWeight && profile.terms.length > 1) || profile.terms.length >= 3) {
    const appears = word => row.heading.includes(word) || row.body.includes(word);
    const anchors = profile.terms.filter(appears);
    const knownTopic = profile.groups.some(group => group.some(appears));
    // For longer questions a lone short homonym, even in a title, is insufficient.
    // Direct title lookups such as "진동" and longer, specific anchors remain searchable.
    const minimumLength = headingWeight ? 3 : 4;
    if (!knownTopic && anchors.length < 2 && !anchors.some(word => word.length >= minimumLength)) return 0;
    // Common short words can appear together in incidental prose. Require coverage
    // of at least a third of the query when they are the only evidence in the body.
    if (!headingWeight && !knownTopic && anchors.every(word => word.length === 2) &&
        anchors.length * 3 < profile.terms.length) return 0;
  }
  return 3 * headingWeight + bodyWeight;
}

function caseSlice(item, location, page, owners) {
  if (typeof page !== 'string' || !page.trim() || !item.locations.includes(location)) return null;
  const span = item.spans?.[location];
  if (!span) return owners.get(item.source_id)?.get(location)?.length === 1 ? page : null;
  const { start, end } = span;
  const chars = Array.from(page);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > chars.length) return null;
  const others = owners.get(item.source_id)?.get(location)?.filter(other => other.id !== item.id) ?? [];
  for (const other of others) {
    const otherSpan = other.spans?.[location];
    if (!otherSpan || (start < otherSpan.end && otherSpan.start < end)) return null;
  }
  return chars.slice(start, end).join('');
}

// Return an exact contiguous passage. Keeping the original whitespace permits direct verification.
function passage(text, profile) {
  if (text.length <= 520) return { quote: text.trim(), score: matchWeight(compact(text), profile) };
  const spans = numericSpans(text);
  let best = null;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 440, text.length);
    if (end < text.length) {
      const breakAt = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end));
      if (breakAt >= start + 220) end = breakAt + 1;
    }
    const quote = boundedExcerpt(text, start, end, spans);
    const score = matchWeight(compact(quote), profile);
    if (!best || score > best.score) best = { quote, score };
    if (end === text.length) break;
    start = Math.max(start + 1, end - 90);
  }
  return best;
}

function safeSource(source) {
  return {
    source_id: source.id, source_title: source.title, source_url: source.url,
    authority: source.authority, format: source.format,
    publication_url: source.publication_url ?? source.url,
    evidence_kind: source.format === 'html' ? '공식 게시물 본문' : '공식 원문 문서',
    ...(source.attachments?.length ? {
      attachment_links: source.attachments.map(({name, url}) => ({ name, url })),
      citation_scope: '이 사례의 검증 범위는 공식 게시물 본문입니다. 첨부 링크는 해당 게시물이 안내한 위치입니다.',
    } : {}),
  };
}

export async function createAuditCore({ loadSet, ranker, readSource }) {
  const sources = new Map();
  const items = new Map();
  const pages = new Map();
  const owners = new Map();
  const coverage = {};
  for (const set of sourceSets) {
    const data = await loadSet(set);
    if (!data) {
      coverage[set] = { available: false, cases: 0, sources: 0 };
      continue;
    }
    const originalPages = data.pages ?? {};
    for (const source of data.sources) {
      if (sources.has(source.id)) throw new Error('Duplicate audit source: ' + source.id);
      sources.set(source.id, source);
      pages.set(source.id, originalPages[source.id] ?? {});
      owners.set(source.id, new Map());
    }
    for (const item of data.cases) {
      if (items.has(item.id) || !sources.has(item.source_id) || !Array.isArray(item.locations) || !item.locations.length) throw new Error('Invalid audit case: ' + item.id);
      items.set(item.id, item);
      const locationOwners = owners.get(item.source_id);
      for (const loc of item.locations) {
        if (!locationOwners.has(loc)) locationOwners.set(loc, []);
        locationOwners.get(loc).push(item);
      }
    }
    coverage[set] = { ...data.coverage, available: data.cases.length > 0, cases: data.cases.length, sources: data.sources.length };
  }

  const indexes = [];
  for (const item of items.values()) {
    const sourcePages = pages.get(item.source_id);
    const body = item.locations.map(loc => caseSlice(item, loc, sourcePages[loc], owners) ?? '').join('\n').trim();
    if (!body) continue;
    const heading = [item.title, item.category].filter(Boolean).join(' ');
    indexes.push({ id: item.id, text: heading + '\n' + body.slice(0, 2800), item, heading: compact(heading), body: compact(body) });
  }
  const status = () => ({
    case_count: items.size, searchable_cases: indexes.length, source_count: sources.size, coverage,
    semantic_model: ranker ? 'potion (15.5k-token subset)' : null,
    verification: '원본 바이트 SHA-256, 원문 재추출, 처분요구별 인용 범위 대조',
  });

  async function research({ query, year, agency, category, limit = 5 } = {}) {
    const queryText = typeof query === 'string' ? query.slice(0, 1600) : '';
    const profile = lexicalProfile(queryText);
    const eligible = indexes.filter(({item}) =>
      (!year || Number(item.year) === Number(year)) &&
      (!agency || compact(item.agency).includes(compact(agency))) &&
      (!category || compact(item.category).includes(compact(category))));
    const matches = [];
    let semanticUsed = false;
    // Semantic distance orders candidates only if an actual keyword or domain expression also matches.
    if (profile.terms.length || profile.groups.length) {
      const candidates = [];
      for (const row of eligible) {
        const lexical = lexicalCandidate(row, profile);
        if (lexical > 0) candidates.push({ ...row, lexical });
      }
      const cosines = candidates.length && ranker ? await ranker(queryText, candidates) : new Map();
      semanticUsed = cosines instanceof Map && cosines.size > 0;
      for (const row of candidates) {
        const cosine = cosines.get(row.id);
        row.cosine = Number.isFinite(cosine) ? cosine : null;
        row.score = Math.log1p(row.lexical) + 0.65 * (row.cosine ?? 0);
      }
      candidates.sort((a, b) => b.score - a.score || b.item.year - a.item.year || a.id.localeCompare(b.id));
      const count = Number.isInteger(limit) ? Math.min(10, Math.max(1, limit)) : 5;
      for (const {item, cosine} of candidates.slice(0, count)) {
        const source = sources.get(item.source_id);
        const excerpts = item.locations.flatMap(location => {
          const text = caseSlice(item, location, pages.get(item.source_id)[location], owners);
          if (!text || compact(text).length < 12) return [];
          const found = passage(text, profile);
          return compact(found.quote).length >= 10 ? [{location, ...found}] : [];
        }).sort((a, b) => b.score - a.score).slice(0, 2);
        if (!excerpts.length) continue;
        matches.push({
          case_id: item.id, title: item.title, category: item.category, agency: item.agency, year: item.year,
          ...safeSource(source), semantic_similarity: cosine,
          evidence: excerpts.map(({location, quote}) => ({ case_id: item.id, location, quote })),
        });
      }
    }
    return {
      matches, match_status: matches.length ? 'matched' : 'no_match', coverage,
      eligible_cases: eligible.length, requires_verification: true, semantic_used: semanticUsed,
      retrieval_method: semanticUsed ? 'Korean lexical + audit terminology + potion cosine reranking' : 'Korean lexical + audit terminology',
      assessment: matches.length ? '유사 사례 후보입니다. 당사자 업무에 적용할 사실관계와 당시 기준을 대조해야 합니다.' : noMatch,
      ...(matches.length && /계약/.test(queryText) && /금액|보증|확약|면제|이하|이상|미만|초과|원/.test(queryText) ? {
        comparison_checks: ['계약 체결일에 해당 기관이 적용한 규정의 시행본과 예외 조항을 확인하세요.',
          '실제 계약금액과 당시 기준의 이상·이하·초과·미만을 구분하고, 계약서와 보증 또는 면제 증빙을 대조하세요.'],
      } : {}),
      next_action: matches.length ? 'get_audit_original로 지적 사실과 조치 전체를 읽고, 답변 직전에 verify_audit_evidence로 최종 인용과 원문 문맥을 검증하세요.' : '조회 범위와 미확인 사항을 명시하세요.',
    };
  }

  async function readCaseSources(caseIds) {
    const locationsBySource = new Map();
    for (const id of caseIds) {
      const item = items.get(id);
      if (!item) continue;
      if (!locationsBySource.has(item.source_id)) locationsBySource.set(item.source_id, new Set());
      for (const loc of item.locations) locationsBySource.get(item.source_id).add(loc);
    }
    const results = new Map();
    for (const [id, locations] of locationsBySource) {
      const source = sources.get(id);
      try { results.set(id, await readSource(source, [...locations])); }
      catch { results.set(id, { error: 'original_read_failed' }); }
    }
    return results;
  }

  function checkedCase(item, fresh) {
    if (!fresh || fresh.error) return { verified: false, error: fresh?.error ?? 'original_read_failed' };
    const source = sources.get(item.source_id);
    if (!source.sha256 || fresh.sha256 !== source.sha256) return { verified: false, error: 'original_hash_mismatch' };
    if (fresh.title && normalize(fresh.title) !== normalize(item.title)) return { verified: false, error: 'wrong_case_title' };
    const locations = [];
    const indexed = pages.get(item.source_id);
    for (const location of item.locations) {
      const page = fresh.pages?.[location];
      if (typeof page !== 'string' || normalize(page) !== normalize(indexed[location])) return { verified: false, error: 'indexed_text_mismatch' };
      const text = caseSlice(item, location, page, owners);
      if (!text) return { verified: false, error: 'ambiguous_case_boundary' };
      locations.push({ location, text });
    }
    if (source.format === 'pdf' && !compact(locations[0].text).includes(compact(item.title))) {
      return { verified: false, error: 'wrong_case_title' };
    }
    return { verified: true, case_id: item.id, title: item.title, ...safeSource(source), sha256: fresh.sha256, locations };
  }

  async function original({ case_id, location, focus } = {}) {
    const item = items.get(case_id);
    if (!item || (location !== undefined && !item.locations.includes(location))) return { verified: false, error: 'unknown_case_location' };
    const sourcesRead = await readCaseSources([case_id]);
    const result = checkedCase(item, sourcesRead.get(item.source_id));
    if (result.verified && location) result.locations = result.locations.filter(row => row.location === location);
    if (result.verified && focus !== undefined) {
      const target = typeof focus === 'string' ? normalize(focus) : '';
      const matches = result.locations.map(row => locateQuote(normalize(row.text), target));
      if (!matches.some(match => !match.error)) {
        const cutsNumber = matches.some(match => match.error === 'quote_cuts_numeric_expression');
        return { verified: false, error: cutsNumber ? 'focus_cuts_numeric_expression' : 'focus_not_in_original' };
      }
    }
    return result;
  }

  async function verify({ evidence } = {}) {
    if (!Array.isArray(evidence) || !evidence.length || evidence.length > 20) return { verified: false, error: 'invalid_evidence_list', evidence: [] };
    const ids = [...new Set(evidence.map(entry => entry?.case_id))];
    const raw = await readCaseSources(ids);
    const cases = new Map();
    for (const id of ids) {
      const item = items.get(id);
      if (item) cases.set(id, checkedCase(item, raw.get(item.source_id)));
    }
    const findings = evidence.map(entry => {
      const item = cases.get(entry?.case_id);
      if (!item || !item.verified) return { verified: false, error: item?.error ?? 'unknown_case' };
      const loc = item.locations.find(row => row.location === entry.location);
      if (!loc) return { verified: false, error: 'unknown_case_location' };
      const quote = typeof entry.quote === 'string' ? normalize(entry.quote) : '';
      if (!quote || compact(quote).length < 10 || quote.length > 4000) return { verified: false, error: 'invalid_quote' };
      const whole = normalize(loc.text);
      const position = locateQuote(whole, quote);
      if (position.error) return { verified: false, error: position.error };
      const bounds = excerptBounds(whole, Math.max(0, position.start - 500), Math.min(whole.length, position.end + 500));
      const context = whole.slice(bounds.start, bounds.end);
      return {
        verified: true, case_id: item.case_id, title: item.title, source_id: item.source_id, source_url: item.source_url,
        location: loc.location, quote, context, sha256: item.sha256, case_locations: item.locations.map(row => row.location),
        quote_position: { ...position, unit:'utf16', text:'nfc_whitespace_collapsed' },
        quote_start_in_context: position.start - bounds.start,
      };
    });
    const verified = findings.every(entry => entry.verified);
    return {
      verified, evidence: findings,
      // Referenced cases in full give the reader access to qualifications and the final disposition.
      case_contexts: verified ? [...cases.values()] : [],
      verification_scope: '지정 사례의 원문 무결성, 위치, 인용문과 앞뒤 문맥을 확인합니다. 사용자 업무에 관한 사실과 법적 판단은 별도 대조가 필요합니다.',
    };
  }
  return { research, verify, original, status };
}
