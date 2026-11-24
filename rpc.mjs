const string = (maxLength, minLength = 1) => ({ type: 'string', minLength, maxLength });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const readonly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const evidence = object({ case_id: string(140), location: string(96), quote: string(1800, 12) }, ['case_id', 'location', 'quote']);
const definitions = [
  ['audit_research', 'research', '비식별 업무 요약으로 성남시 공개 감사사례를 검색한다. 검색 결과는 후보이다. 인용을 쓸 때 get_audit_original로 문맥을 읽고 마지막에 verify_audit_evidence로 전부 대조한다.', object({
    query: string(400, 2), year: {type:'integer',minimum:1900,maximum:2100}, agency: string(80), category: string(80), limit: {type:'integer',minimum:1,maximum:10},
  }, ['query'])],
  ['get_audit_original', 'original', '사건과 원문 위치로 해당 공개 감사자료를 다시 읽는다. focus에 검색 후보의 짧은 원문 문구를 넣으면 그 주변 문맥과 공식 원문 링크를 확인할 수 있다.', object({case_id: string(140),location: string(96),focus:string(150)}, ['case_id'])],
  ['verify_audit_evidence', 'verify', '답변 전 마지막 호출. 실제 답변에 인용할 각 사건 ID, 위치, 연속된 원문 문구를 한 번에 대조한다. 전체 verified가 true일 때에만 확인된 근거로 인용한다.', object({evidence: {type:'array',minItems:1,maxItems:8,items:evidence}}, ['evidence'])],
  ['get_audit_status', 'status', '실제 수록·검색 가능한 사례 수, 출처별 수집 상태, 검색 및 검증 범위를 반환한다.', object({})],
];
export const tools = definitions.map(([name,,description,inputSchema]) => ({name,description,inputSchema,annotations:readonly}));
const versions = ['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
const serverInfo = { name:'seongnam-audit', version:'1.0.0' };

function accepts(value, schema) {
  if (schema.type === 'string') return typeof value === 'string' && value.trim().length >= schema.minLength && value.length <= schema.maxLength;
  if (schema.type === 'integer') return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && value.every(v => accepts(v,schema.items));
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    schema.required.every(key => Object.hasOwn(value,key)) &&
    Object.keys(value).every(key => Object.hasOwn(schema.properties,key) && accepts(value[key],schema.properties[key]));
}

function hasIdentifier(text) {
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{6}[- ]?[1-8]\d{6}\b|(?:\+82[- ]?|0)1[016789][- .]?\d{3,4}[- .]?\d{4}|(?:계좌번호|사번|휴대폰|전화번호)\s*[:：]?\s*\d{3,}/iu.test(text);
}

const failTool = message => ({content:[{type:'text',text:message}],isError:true});

export async function dispatch(engine, policy, request) {
  const id = request?.id;
  const fault = (code, message) => ({jsonrpc:'2.0',id:id ?? null,error:{code,message}});
  const ok = result => ({jsonrpc:'2.0',id,result});
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
    (id !== undefined && typeof id !== 'string' && !Number.isInteger(id))) return fault(-32600,'Invalid Request');
  if (id === undefined) return null;
  const instructions = [...policy.privacy_rules,...policy.citation_rules,...policy.research_rules].join('\n');
  if (request.method === 'server/discover') return ok({serverInfo,supportedVersions:versions,capabilities:{tools:{}},instructions});
  if (request.method === 'initialize') return ok({serverInfo,protocolVersion:versions.includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-11-25',capabilities:{tools:{}},instructions});
  if (request.method === 'ping') return ok({});
  if (request.method === 'tools/list') return ok({tools});
  if (request.method !== 'tools/call') return fault(-32601,'Method not found');
  const def = definitions.find(row => row[0] === request.params?.name);
  if (!def) return fault(-32602,'Unknown tool');
  const args = request.params.arguments ?? {};
  if (!accepts(args,def[3])) return ok(failTool('입력 항목 또는 길이가 올바르지 않습니다. tools/list에 표시된 형식을 확인하세요.'));
  if (def[1] === 'research' && [args.query,args.agency,args.category].some(s => typeof s === 'string' && hasIdentifier(s))) {
    return ok(failTool('개인 식별정보를 제거하고 업무 유형·날짜·처리 순서만 요약해 주세요.'));
  }
  try {
    const data = await engine[def[1]](args);
    return ok({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false});
  } catch {
    return ok(failTool('감사자료를 조회할 수 없습니다. 수록 상태와 원문을 확인하세요.'));
  }
}
