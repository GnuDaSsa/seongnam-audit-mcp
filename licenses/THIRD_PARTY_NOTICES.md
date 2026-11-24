# 모델·코드·자료 출처

## Potion 검색 모델

Minish Lab이 공개한 `minishlab/potion-multilingual-128M`의 가중치를 사용한다. 고정 리비전은 `73908c3438cf03b6a01bcb9611d62b23d0726f08`이다. 공식 모델 카드는 가중치 라이선스를 MIT로 표시하며 Model2Vec의 개발자로 Minish Lab의 Stephan Tulkens와 Thomas van Dongen을 명시한다. [해당 리비전의 공식 모델 카드](https://huggingface.co/minishlab/potion-multilingual-128M/blob/73908c3438cf03b6a01bcb9611d62b23d0726f08/README.md) · [Model2Vec 프로젝트의 MIT 라이선스 고지](https://github.com/MinishLab/model2vec/blob/main/LICENSE)

성남 예산 MCP는 토큰 벡터를 행 단위 대칭 int8 형식으로 변환했다. 감사 MCP는 그 중 고정한 공통 토큰 부분집합과 어휘로 256차원 검색 벡터를 만든다. 원 저작자 표시와 MIT 허가문은 동봉한 파일에 실었다. [MIT 고지](MODEL2VEC-MIT.txt) · [예산 MCP](https://github.com/GnuDaSsa/seongnam-budget-mcp)

## 성남 예산 MCP

예산 MCP의 검색 모델 자산 형식을 재사용한다. 원 프로젝트 코드에 대한 저작권 표시는 “Copyright (c) 2026 Seongnam Budget MCP contributors”이며 라이선스는 MIT다. [원 프로젝트 라이선스 사본](BUDGET-LICENSE.txt)

## 공식 자료와 실행 의존성

성남시와 재단이 발행한 감사 게시물·보고서의 출처와 검색·인용 범위는 README에 기재했다. 각 발행기관의 공개 조건이 적용된다. [성남시 저작권 정책](https://www.seongnam.go.kr/cn050401) · [서비스 수록 범위](../README.md#공개-서비스와-로컬-자료)

HTML 추출에는 Beautiful Soup 4, 로컬 PDF 추출에는 PyMuPDF, 공개 HTTP 서비스 빌드에는 esbuild를 사용한다. 버전은 `requirements.txt`와 `package-lock.json`에 고정했다. 각 프로젝트의 이용 조건은 배포 파일과 공식 안내에 따른다. [Beautiful Soup](https://www.crummy.com/software/BeautifulSoup/) · [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/about.html) · [esbuild](https://github.com/evanw/esbuild/blob/main/LICENSE.md)
