# Windows에서 첨부자료 처리 검증하기

가상 구매 검토서 한 장을 PNG, 텍스트 PDF, 스캔 PDF로 만들어 첨부자료를 읽는 호스트의 역할을 재현한다. 세 파일에서 업무 유형과 구매 횟수를 확인하고, 가상 관리번호를 뺀 검색어로 공개 감사사례를 찾아 원문 인용을 대조한다. 가상 문서는 스크립트에서 생성한다.

## 실행

Windows PowerShell 5.1과 한국어 OCR 언어 팩, 맑은 고딕, Poppler의 `pdftoppm`, Python과 Node.js 22 이상이 필요하다. Python에 PyMuPDF와 Pillow를 설치한다. 저장소 루트에서 `npm ci`를 실행하면 시험용 공식 MCP 클라이언트도 설치된다. 시험에 사용한 환경은 Python 3.13, PyMuPDF 1.26.4, Pillow 11.2.1, Node.js 24다.

저장소 루트에서 다음을 실행한다.

```powershell
python examples/attachment-smoke/host.py
if ($LASTEXITCODE -eq 0) { node examples/attachment-smoke/verify-public.mjs }
```

첫 명령은 로컬에서 문서를 읽는다. PNG는 Windows 한국어 OCR, 텍스트 PDF는 PyMuPDF로 읽고, 스캔 PDF는 텍스트층이 비어 있는지 확인한 후 Poppler로 그려서 OCR한다. '물품구매', '분할계약', '구매 횟수', '2회'를 확인하고 기대한 값과 달라지면 중단한다.

둘째 명령은 배포된 감사 MCP에 두 검색어를 보낸다. 각 형식마다 `audit_research`, `get_audit_original`, `verify_audit_evidence` 순서로 공개 사례를 다시 읽어 같은 인용과 SHA-256이 돌아오는지 확인한다. 발신 요청에 검색어 외의 첨부자료 내용이나 관리번호가 포함되면 검사에서 중단한다.

로컬 결과·공개 대조 결과는 이 폴더의 `.work/local-results.json`과 `.work/public-results.json`에 생성된다. PDF 렌더링 미리보기도 `.work`에서 볼 수 있다. 이 디렉터리는 Git에서 제외된다.

## 확인 범위

시험에 사용한 문서는 인쇄체 한글 1쪽이다. 2026년 11월 25일 세 형식 모두 성남시 공개 사례 ‘물품구매 분할계약’의 인용문을 수집 시점의 공식 게시물 HTML과 대조했다. [성남시 공식 게시물](https://www.seongnam.go.kr/pm030305/2136)

첫 시험에서 Windows OCR은 '두 차례'를 '두 사례'로 읽어 업무 사실 대조가 중단됐다. 이 예시의 두 검색어는 합성 문서 전용이다. 실제 문서에서는 첨부파일을 읽을 수 있는 호스트가 숫자·날짜와 처리 순서를 확인하고 비식별 요약을 작성해야 한다. 이번 검증 범위에는 ChatGPT 첨부 화면, 손글씨, 다쪽 표의 인식률이 포함되지 않는다.
