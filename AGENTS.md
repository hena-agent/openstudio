# OpenStudio

## 제품 목표

여러 스텝을 연결하고 중간 결과를 확인·수정하면서 최종 영상을 완성하는 웹 기반 워크플로우 도구다.

- 특정 주제나 제작 순서를 필수 구조로 만들지 않는다. `docs/usecase.md`는 사례 하나다.
- 프롬프트로 바로 영상을 만들거나, 참조 에셋을 활용하거나, 여러 결과물을 합성할 수 있다.
- 전체 실행, 단계별 실행, 체크포인트 검수를 같은 실행 모델로 지원한다.
- 중간 결과의 수정·교체·재생성과 부분 재실행을 지원한다.
- 여러 사용자가 각자의 제공자 계정을 연결한다.

## 현재 최우선 과제: 연결 가능성

편집기 본격 구현보다 구독 OAuth와 API 키를 이용한 실제 연결 검증을 먼저 한다.

1. 제공자별 인증과 연결 해제
2. 연결 계정의 사용 가능 모델 조회
3. 실제 모델 호출 및 결과 수신
4. 비동기 영상 생성의 제출·추적·파일 확보
5. 인증 만료·재연결·제한·실패 처리

조사 완료, 인증 성공, 모델 조회 성공, 실제 호출 성공을 구분한다. 모의 응답은 연동 성공의 증거가 아니다.
계정이나 권한이 없으면 차단 요인과 재현 절차를 기록한다. 사용자 동의 없이 유료 모델 호출을 실행하지 않는다.

## 연결 구조

- 모델, 제공자, 연결 계정, 실행 어댑터를 분리한다.
- OAuth/device flow/API 키는 제공자별 지원 방식에 맞춘다.
- OpenCode의 공식 문서와 현재 구현을 참고하고 출처·확인 날짜를 기록한다.
- 다른 앱의 공개 OAuth client ID는 자동으로 사용하지 않는다. 운영 시 사용할 앱의 client ID와 제공자 권한을 확인한다.
- OpenAI 구독 연결은 현재 공식 Sign in with ChatGPT 직접 등록 흐름을 우선한다. `dynamic_agent_client`는 최초 등록용이며, 발급된 앱별 client ID를 저장·재사용한다.
- OpenCode의 로컬 연결이 공유 웹서비스에서도 동작한다고 가정하지 않는다.
- 로그인 성공과 구독의 API·모델 사용 권한은 별개로 확인한다.
- 텍스트 호출 성공을 이미지·영상 호출 성공으로 일반화하지 않는다.
- 제공자별 실제 모델 목록과 지원 endpoint를 우선한다.

## 모델 카탈로그

models.dev를 기본 정보 소스로 사용하고 제공자 API와 자체 명세로 보완한다.
최신 목록과 실행 어댑터 지원, 계정 권한을 구분한다. 주기적 갱신, 수동 새로고침,
마지막 정상 데이터 유지, 미등록 모델 확장을 고려한다.
모델 목록 갱신으로 기존 워크플로우의 모델을 자동 교체하지 않는다.

## 인증과 작업 상태

- 비밀값을 커밋·로깅하거나 브라우저 저장소에 보관하지 않는다.
- 인증 정보는 서버에서 암호화해 저장하고 사용자별 접근 제어를 적용한다.
- 워크플로우에는 계정 참조만 저장한다.
- 인증 실패·권한 부족·사용량 초과·제공자 오류를 구분한다.
- OAuth polling 간격, slow_down, 만료, 거절, 동시 요청을 처리한다.
- 외부 작업 ID를 보존하고 조회 실패 시 생성을 중복 제출하지 않는다.
- 실행에는 워크플로우 버전·모델·제공자·설정을 남긴다.
- 상위 결과 변경 시 후속 결과를 갱신 필요 상태로 표시한다.

## 개발 및 검증

검증에 필요한 최소한의 코드부터 작성하고 확인되지 않은 연동 위에 큰 추상화를 만들지 않는다.
인증·계정 격리·오류 상태 전이에는 의미 있는 테스트를 작성한다.
자동화 테스트와 실제 제공자 검증 결과는 따로 기록한다.

- `npm run dev`: 프런트 3001–3999, 백엔드 4001–4999의 임의 빈 포트에 loopback 바인딩. 3000번을 사용하지 않는다.
- `npm run typecheck`: 타입 검사
- `npm test`: 서버 인증·제공자 테스트
- `npm run build`: 프로덕션 빌드

사용자 지시 없이 커밋하거나 푸시하지 않는다.

## 화면 방향

영상 제작용 다크 작업 도구로 구현한다. 차콜·검정 배경, 작업 패널, 읽을 수 있는 텍스트 대비를 사용한다.
작업 본문은 15–16px, 버튼·레이블은 14px, 보조 텍스트는 최소 12px를 기준으로 한다. 모바일에서도 글자를 과도하게 축소하지 않는다.
랜딩 페이지식 소개 배너·슬로건·장식용 그래픽을 넣지 않는다.
연결·모델 선택·실행·결과 확인을 짧은 동선으로 제공한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
