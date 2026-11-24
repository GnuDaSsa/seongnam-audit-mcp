# 성남시 감사정보 MCP

“병가를 근무일에 포함해 연가일수를 산정했는데, 비슷한 감사 지적이 있나요?”처럼 업무 상황을 적으면 성남시가 공개한 유사 사례와 당시 지적 이유를 찾는다. 답변하기 전에는 사건별로 원문을 다시 읽고 실제 인용할 문구와 위치를 대조한다.

## 공개 MCP 연결

MCP 클라이언트의 원격 서버 주소에 `https://seongnam-audit.gnudas0923.chatgpt.site/public-mcp`를 입력하고 Streamable HTTP를 선택한다. API 키는 필요 없다. 브라우저에서도 자료를 검색하고 공식 출처를 열 수 있다. [검색 화면](https://seongnam-audit.gnudas0923.chatgpt.site) · [운영 수록 현황](https://seongnam-audit.gnudas0923.chatgpt.site/api/status)

JSON으로 설정하는 클라이언트는 예시 파일에서 공개 서버 또는 로컬 서버 항목을 골라 사용한다. 로컬 항목의 예시 경로를 실제 `server.mjs` 절대 경로로 바꾼다. 클라이언트별 설정 키가 다르면 원격 URL 또는 로컬 명령과 인자를 해당 입력란에 옮긴다. [클라이언트 설정 예시](config/clients.example.json)

## 공개 서비스와 로컬 자료

2026년 11월 24일 수집분 기준이다. 최신 범위는 각 서버의 `get_audit_status`에서 확인한다.

| 공식 자료 | 공개 MCP | 로컬 전체 자료 | 확인한 범위 |
| --- | ---: | ---: | --- |
| 성남시청 분야별 감사사례 | 1,717건 | 1,717건 | 2017~2026년 게시물 1,718건 중 사실관계를 확인할 수 있는 본문을 수록했다. 1건은 본문이 부족해 제외했다. |
| 성남시청소년재단 2018년도 정기감사 결과보고 | 0건 | 8건 | 공개 PDF 20쪽 중 처분요구서 8~20쪽을 지적 단위로 나눴다. |
| 경기도감사위원회 2024년 성남시 종합감사 | 0건 | 0건 | 공식 게시물은 확인했다. 첨부 2건 요청에 보안 정책 안내문이 반환되어 본문을 수록하지 않았다. |
| **검색 가능한 사례** | **1,717건** | **1,725건** | 도시 전체의 모든 감사 건수를 뜻하지 않는다. |

공개 MCP는 시청 게시물의 짧은 인용과 공식 링크를 반환한다. 로컬 서버는 재단 PDF의 처분요구서에 해당하는 쪽도 열 수 있다. [성남시청 사례 목록](https://www.seongnam.go.kr/pm030305) · [청소년재단 감사결과 게시물](https://www.snyouth.or.kr/fmcs/286?action=read&action-value=71983f59f30497a3969ba7ad535394b5&page=2) · [경기도감사위원회 게시물](https://www.gg.go.kr/audit/bbs/boardView.do?bIdx=110888636&bcIdx=533&bsIdx=886&menuId=4272&page=1)

## 답변에 근거를 붙이는 순서

1. 질문이나 첨부 문서에서 업무 유형·행위일·처리 순서를 뽑는다. 개인 이름·계좌·연락처를 뺀 요약을 `audit_research`에 보내고 기관·감사 연도·분야 조건을 적용한다.
2. `get_audit_original`로 후보의 `case_id`와 `location`을 조회한다. 시청 게시물은 `html:body`, PDF는 `p:14`처럼 실제 쪽을 가리킨다. 공개 MCP에서 검색 인용 주변을 보려면 `focus`에 해당 문구를 넣는다.
3. 답변에 인용할 모든 문구를 `case_id`, `location`, `quote`로 묶어 마지막에 `verify_audit_evidence`로 대조한다. 전체 `verified`가 참이어야 쓸 수 있다. 이후 공식 출처와 당시 조치, 현재 사안의 공통점과 차이점, 추가 확인 자료를 적는다. 검색 결과가 없으면 조회 범위를 밝힌다. [답변 정책](POLICY.md)

## 로컬에서 실행

아래 명령은 저장소 최상위에서 실행한다. Node.js 24, Python 3.13, curl을 기준으로 검증했다. Beautiful Soup 4는 시청 HTML 본문을, PyMuPDF는 PDF의 쪽별 텍스트를 추출한다. Node 서버가 사용할 Python의 경로는 `AUDIT_PYTHON`으로 지정할 수 있다.

```sh
npm ci
python -m pip install -r requirements.txt
python pipeline/city.py
python pipeline/reports.py --set all --refresh
```

자료와 모델을 포함한 로컬 묶음이 있으면 해당 폴더에서 바로 서버를 실행할 수 있다. 소스만 복제한 환경에서는 위 수집 명령으로 `snapshot/`과 `originals/`를 만든다. 로컬 HTTP는 기본 `http://127.0.0.1:8788/public-mcp`에서 대기하며 포트는 `AUDIT_PORT`로 바꿀 수 있다.

```sh
# 표준 입출력 서버
node server.mjs
# 또는 로컬 HTTP 서버
node server.mjs --http
```

### 검색 모델 준비

공개 MCP에는 검색 모델이 포함되어 있어 별도 설치가 필요 없다. 로컬 서버는 모델이 없으면 한국어 어휘와 감사 용어로 검색한다. `get_audit_status`의 `semantic_model`과 검색 응답의 `semantic_used`로 현재 검색 방식을 확인한다.

공개 서비스와 같은 모델을 로컬에 쓰려면 성남 예산 MCP의 `snapshot/semantic/` 디렉터리를 준비한다. 예산 프로젝트를 새로 복제한 경우 해당 저장소의 `npm run snapshot:download`로 배포 스냅샷을 복원할 수 있다. 이미 복원한 디렉터리나 그 안의 `common.bin.gz`와 `vocab.bin.gz` 두 파일이 있으면 인터넷 없이 변환한다. 아래 예시는 두 프로젝트를 같은 상위 폴더에 둔 경우다. [예산 MCP 스냅샷 복원 안내](https://github.com/GnuDaSsa/seongnam-budget-mcp#github-소스와-검색-데이터)

```sh
python pipeline/prepare_model.py ../seongnam-budget-mcp/snapshot/semantic
```

변환기는 두 입력의 고정 SHA-256을 확인하고 `model/common.bin.gz`와 `model/words.json.gz`를 만든다. 같은 원본 가중치를 사용하더라도 어휘 부분집합과 행 순서가 달라지면 호환되지 않는다. 원 모델, 고정 리비전, 라이선스는 출처 고지에서 확인할 수 있다. [모델·자료 출처](licenses/THIRD_PARTY_NOTICES.md)

## 검증과 유지관리

| 명령 | 확인하는 범위 |
| --- | --- |
| `npm run test:ci` | 수집한 자료나 모델 없이 합성 자료로 검색, MCP 요청, 원문 대조, 개인정보 입력 처리를 재현한다. |
| `python -m unittest discover -s tests -p test_report_source.py` | PDF 대신 안내문을 받아도 기존 원본을 보존하고 수록 건수를 올리지 않는지 확인한다. |
| `npm test` | 실제 시청·재단 자료가 준비된 환경에서 고정 사례의 검색, 원문, 최종 인용 검증과 자료 변조·무관한 질문을 검사한다. |
| `npm run build` | 시청 원문, 수록 현황, 모델 체크섬을 확인한 뒤 공개 HTTP 서비스용 `dist/`를 생성한다. |
| `npm run test:live` | 배포된 운영 서버의 실제 MCP 연결과 근거 대조를 확인한다. |
| `npm run test:protocol` | 공식 SDK 구·신버전과 HTTP 요청을 검사한다. `AUDIT_PROTOCOL_URL`을 설정하면 공식 SDK가 지정된 원격 서버를 호출한다. |
| `node benchmark.mjs --mode live --suite reserve-v1 --output reserve-results.json` | 공개 서버에서 16개 예비 문항의 첫 검색 순위, 답변 보류, 공식 원문과 걸린 시간을 기록한다. 기본 평가군 40문항은 `--suite reserve-v1`을 생략해 실행한다. |
| `node answer-benchmark.mjs --output answer-results.json` | 첫 한국어 답변의 채점표를 확인하고 운영 원문을 다시 대조한다. 설정한 정확성·유용성 기준에 미달하면 종료 코드 1을 반환한다. |
| `node benchmark.mjs --mode live --suite final-v1` · `node answer-benchmark.mjs --suite final-v1` | 최종 수정 후 새로 동결한 검색 14문항과 한국어 답변 6개 대화의 기준 충족 여부를 각각 확인한다. |

1.1.0의 실측 성적과 예산 MCP에서 이어받은 검사 범위를 공개했다. GitHub Actions의 ‘공개 MCP 벤치마크’는 수동 실행 시 운영 주소를 호출하고 문항별 보고서를 보관한다. [운영 검증 결과](docs/VALIDATION.md) · [검색 평가와 최초 실패 기록](docs/BENCHMARK.md) · [한국어 답변 채점](docs/ANSWERS.md) · [참고한 MCP 저장소와 스킬](docs/MCP_RESEARCH.md)

오류를 제보할 때는 공개 가능한 재현 질문과 사례 ID 또는 공식 원문 위치를 남긴다. 전체 원문, 검색 스냅샷, 모델 가중치와 이용자 내부 문서는 공개 Git에 올리지 않는다. [기여 방법](CONTRIBUTING.md) · [이슈 목록](https://github.com/GnuDaSsa/seongnam-audit-mcp/issues)
