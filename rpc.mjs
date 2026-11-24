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
// Publish the stable fields clients need to distinguish candidate evidence from verified evidence.
// The engines supply additional provenance and coverage details.
const resultObject = (properties, required = Object.keys(properties)) => ({type:'object',properties,required});
const items = schema => ({type:'array',items:schema});
const textField = {type:'string'};
const booleanField = {type:'boolean'};
const count = {type:'integer',minimum:0};
const coverage = {type:'object'};
const citation = resultObject({case_id:textField,location:textField,quote:textField});
const match = resultObject({case_id:textField,title:textField,source_url:textField,evidence:items(citation)});
const location = resultObject({location:textField,text:textField});
const outputSchemas = {
  research:resultObject({
    matches:items(match),match_status:{enum:['matched','no_match']},requires_verification:{const:true},
    coverage,eligible_cases:count,semantic_used:booleanField,
  }),
  original:resultObject({verified:booleanField,error:textField,case_id:textField,locations:items(location)},['verified']),
  verify:resultObject({verified:booleanField,evidence:items(resultObject({verified:booleanField})),error:textField},['verified','evidence']),
  status:resultObject({case_count:count,searchable_cases:count,source_count:count,coverage}),
};
export const tools = definitions.map(([name,method,description,inputSchema]) => ({
  name,description,inputSchema,outputSchema:outputSchemas[method],annotations:readonly,
}));
const versions = ['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
const modernVersion = versions[0];
const serverInfo = { name:'seongnam-audit', version:'1.1.0' };
const versionKey = 'io.modelcontextprotocol/protocolVersion';
const capabilitiesKey = 'io.modelcontextprotocol/clientCapabilities';
const serverKey = 'io.modelcontextprotocol/serverInfo';
const catalogCache = {cacheScope:'public',ttlMs:0};
const fault = (id,code,message,data) => ({
  jsonrpc:'2.0', id:id ?? null, error:data === undefined ? {code,message} : {code,message,data},
});
const unsupported = (id,requested) => fault(id,-32022,'Unsupported protocol version',{supported:versions,requested});

function decodedHeader(value) {
  if (!value?.startsWith('=?base64?') || !value.endsWith('?=')) return value;
  try {
    return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.slice(9,-2)),c=>c.charCodeAt(0)));
  } catch { return undefined; }
}

export async function dispatchHttp(engine,policy,request,headers) {
  const bodyVersion = request?.params?._meta?.[versionKey];
  const headerVersion = headers.get('mcp-protocol-version');
  const modern = bodyVersion !== undefined || headerVersion === modernVersion;
  if (modern) {
    const method = request?.method;
    const needsName = ['tools/call','prompts/get','resources/read'].includes(method);
    const name = method === 'resources/read' ? request?.params?.uri : request?.params?.name;
    if (!headerVersion || headerVersion !== bodyVersion || headers.get('mcp-method') !== method ||
        (needsName && (typeof name !== 'string' || decodedHeader(headers.get('mcp-name')) !== name))) {
      return {status:400,body:fault(request?.id,-32020,'MCP request headers do not match the message fields')};
    }
  }
  if (headerVersion && !versions.includes(headerVersion)) return {status:400,body:unsupported(request?.id,headerVersion)};
  const body = await dispatch(engine,policy,request);
  let status = body === null ? 202 : 200;
  if (modern && body?.error) status = body.error.code === -32601 ? 404 : 400;
  return {status,body};
}

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
  const meta = request?.params?._meta;
  const version = meta?.[versionKey];
  const modern = version === modernVersion;
  const ok = result => ({jsonrpc:'2.0',id,result:modern
    ? {...result,resultType:'complete',_meta:{[serverKey]:serverInfo}}
    : result});
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
    (id !== undefined && typeof id !== 'string' && !Number.isInteger(id))) return fault(id,-32600,'Invalid Request');
  if (id === undefined) return null;
  if (version !== undefined && !versions.includes(version)) return unsupported(id,version);
  if (modern && (!meta[capabilitiesKey] || typeof meta[capabilitiesKey] !== 'object' || Array.isArray(meta[capabilitiesKey]))) {
    return fault(id,-32602,'Client capabilities are required for this protocol version');
  }
  const instructions = [...policy.privacy_rules,...policy.citation_rules,...policy.research_rules].join('\n');
  if (request.method === 'server/discover') return ok({...catalogCache,serverInfo,supportedVersions:versions,capabilities:{tools:{}},instructions});
  if (request.method === 'initialize' && !modern) {
    const requested = request.params?.protocolVersion;
    const protocolVersion = versions.slice(1).includes(requested) ? requested : '2025-11-25';
    return ok({serverInfo,protocolVersion,capabilities:{tools:{}},instructions});
  }
  if (request.method === 'ping') return ok({});
  if (request.method === 'tools/list') return ok(modern ? {...catalogCache,tools} : {tools});
  if (request.method !== 'tools/call') return fault(id,-32601,'Method not found');
  const def = definitions.find(row => row[0] === request.params?.name);
  if (!def) return fault(id,-32602,'Unknown tool');
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
