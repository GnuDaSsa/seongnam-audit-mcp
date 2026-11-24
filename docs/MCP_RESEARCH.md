# 감사 MCP 검증에 참고한 저장소와 평가 방법

2026년 11월 25일 한국 시각 기준으로 공개 저장소의 릴리스, 프로토콜 원문, 스킬 본문을 확인했다. 감사 MCP에서는 **다른 클라이언트가 도구를 호출할 수 있는지**, **검색이 적절한 사례를 찾는지**, **작성된 답변이 원문의 사실과 예외를 보존하는지**를 각각 평가한다.

| 공개 자료 | 확인한 내용 | 감사 MCP에 적용하는 방법 |
|---|---|---|
| [공식 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [MCP 버전 협상 명세](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) | 공식 SDK의 v2 안정판은 2026-07-28 사양과 클라이언트용 패키지를 제공한다. 기존 v1.x는 별도 브랜치에서 유지한다. | 공개 서버와 실제 클라이언트의 버전 발견, 도구 목록, 구조화된 응답을 연결해 검사한다. 결과에 사용한 SDK와 프로토콜 버전을 남긴다. |
| [MCP Inspector 2.16.0 릴리스](https://github.com/modelcontextprotocol/inspector/releases/tag/2.16.0) · [공식 conformance 검사기](https://github.com/modelcontextprotocol/conformance) | 11월 18일 배포된 Inspector는 CLI에서 운영자의 도구 호출을 재현할 수 있다. 공식 적합성 검사기는 프로토콜 버전·시나리오를 지정해 수행한다. | 연결 회귀를 재현할 때 전송 방식, 호출 이름, 실제 성공한 시나리오를 명시한다. SDK 연결 시험에 합격해도 전체 적합성 시험이나 감사 답변 채점을 통과한 것으로 집계할 수 없다. |
| [Anthropic mcp-builder 스킬](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/SKILL.md) · [평가 지침 원문](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/reference/evaluation.md) | 유지관리자는 여러 번의 읽기 전용 호출이 필요한 독립적인 실무 질문을 내고, 근거로 확인할 수 있는 답을 미리 작성하라고 안내한다. | 사례·당시 조치처럼 고정 가능한 사실은 원문으로 채점한다. 서술형 판단은 이번 건과 다른 점, 적용 시점, 누락 증빙 및 과도한 단정을 개별 평가한다. |
| [Anthropic build-mcp-server 스킬](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/mcp-server-dev/skills/build-mcp-server/SKILL.md) · [공식 MCP 개발 가이드](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/develop/build-with-agent-skills.mdx) | 서버 배포 위치와 사용자가 수행할 작업 수에 맞춰 원격 HTTP·로컬 표준 입출력과 개별 도구 설계를 선택한다. | 검색, 원문 읽기, 인용 검증, 수록 현황의 역할을 도구 설명에서 구분한다. 연속 호출에서는 이전 단계가 반환한 사건 ID와 공식 원문 위치가 이어지는지 검사한다. |
| [BEIR 평가 예제](https://github.com/beir-cellar/beir) · [BEIR 원 논문](https://arxiv.org/abs/2104.08663) · [NIST TREC 보고서](https://trec.nist.gov/pubs/trec29/papers/OVERVIEW.DL.pdf) | 검색 결과를 등록한 관련 문서와 대조해 여러 검색 방법을 같은 질문으로 평가한다. TREC는 관련성 판정이 희소할 때 첫 관련 문서의 역순위를 별도로 보고한다. | 같은 질문·본문 목록으로 키워드 검색과 의미 재정렬을 비교한다. `Hit@k`는 상위 k건 안에 등록 정답이 있는 질문의 비율이고, `MRR@k`는 처음 맞은 순위의 역수 평균이다. 등록하지 않은 사례에도 적절한 근거가 있을 수 있다. |

### 답변 채점에 반영한 사항

[응답자용 질문](../benchmarks/answer/questions.json)은 6개 상황, 7개 사용자 발화로 구성했다. 질문마다 행위 조건, 과거 처분과 현재 건의 차이, 확인할 자료를 미리 기록했다. 금액을 다음 턴에서 정정하는 질문과 사안 정보가 없어 판단을 보류해야 하는 질문도 들어 있다. [정답표](../benchmarks/answer/key.json)와 질문은 답변 작성 전에 각각 [SHA-256으로 고정](../benchmarks/answer/frozen.json)했다.

인용 대조가 참이어도 당시 지적 총액을 지금 한 사람에게 부과할 액수로 읽거나 기관 내부 기준을 일반 규칙으로 쓰면 채점에서 오류가 된다. 입력이 부족한 문항은 추가로 필요한 사실을 짚었는지 확인한다. 자동 도구 실행 결과와 실제 한국어 답변의 평가 대상이 이렇게 다르다. [Anthropic의 에이전트 도구 평가 사례](https://www.anthropic.com/research/writing-tools-for-agents)

### 동향 지표를 읽은 기준

확인 시점에 skills.sh는 `mcp-builder`에 약 14.7만 회의 설치를 표시했고 공식 Inspector 저장소는 약 1.1만 개의 GitHub 별을 표시했다. 이 수치는 어느 도구부터 조사할지 고르는 데 썼다. 감사 답변의 신뢰도는 성남시 사례에서 실제로 기록한 검색 순위, 원문 대조 결과와 독립 채점으로 평가한다. [스킬 디렉터리 집계](https://skills.sh/anthropics/skills/mcp-builder) · [Inspector 저장소](https://github.com/modelcontextprotocol/inspector)
