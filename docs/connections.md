# 연결 검증 기록

확인 날짜: 2026-11-09

## 현재 결과

| 경로 | 확인한 실제 결과 | 미확인 |
|---|---|---|
| models.dev | JSON 수신·카탈로그 화면 검색 | 제공자별 실행 지원은 별도 |
| OpenAI discovery | 공개 OIDC 문서 HTTP 200, issuer·authorize·token·JWKS·revoke endpoint 일치 | 해당 없음 |
| OpenAI ChatGPT OAuth | OpenStudio 직접 등록 URL 생성, 실제 OpenAI 로그인 페이지 진입 | 계정 승인·토큰 교환·모델 조회·생성 |
| OpenAI API 키 | 구현·자동화 테스트 | 실제 API 키로 조회·호출 |
| GitHub Copilot | 조사·구현·자동화 테스트 | 사용할 앱의 client ID·계정 승인·조회·호출 |
| 영상 생성 | 미착수 | 제출·추적·결과 파일 수신 |

계정의 로그인 화면까지 도달한 것을 인증 완료 또는 모델 호출 성공으로 기록하지 않는다.
실제 유료 생성 요청은 자동으로 실행하지 않았다.

## OpenAI: 공식 직접 등록 흐름

OpenCode 구현을 먼저 확인한 뒤, 현재 OpenAI 공식 문서에서 앱 자체 등록과 공개 Responses API를 지원하는 경로를 확인했다.
OpenCode의 legacy Codex client ID·고정 콜백 포트·backend-api를 복사하는 대신 이 공식 경로를 구현했다.

### 참고 자료

- [공식 OSS ChatGPT 구독 연결](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [계정·재연결·회전 갱신·세션 폐기](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [계정별 모델과 추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [현재 preview 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [OIDC 검증과 discovery](https://developers.openai.com/siwc/website)
- [실제 discovery URL](https://auth.openai.com/.well-known/openid-configuration)

### 구현

1. 최초 등록: `client_id=dynamic_agent_client`, `agent_name_hint=OpenStudio`, 영속 host ID
2. `http://127.0.0.1:<4xxx>/auth/callback`을 정확하게 authorize·code exchange에 전달
3. 브라우저 세션, state·nonce·PKCE, 만료와 일회성 callback 검사
4. 발급된 client ID로 코드 교환, JWKS 서명·issuer·audience·nonce·만료 검증
5. `chatgpt.tokens.use.direct` scope와 identity 성공 구분
6. 계정/client 등록 유지, 재인증 시 동일 identity 검증
7. 회전 refresh token의 직렬 갱신과 암호화 원자 저장
8. 공개 `/v1/models`의 `models[].slug`·`display_name`·visibility 반영
9. 공개 `/v1/responses`, 배열형 input, `store:false`, `stream:true`
10. SSE 완료 이벤트를 기준으로 성공 판정. 부분 응답 뒤 실패·한도 초과도 실패로 처리
11. 로그아웃 시 원격 revoke 시도·로컬 토큰 제거, 등록 매핑은 유지

### 실제 브라우저 확인

실행 당시 프런트 `127.0.0.1:3075`, 백엔드 `127.0.0.1:4340`.
Continue with ChatGPT → OpenAI authorize → `https://auth.openai.com/log-in`의 실제 이메일·소셜 로그인 화면 확인.
사용자 인증 정보는 입력하지 않았고 계정 승인을 완료하지 않았다. 대기 중 인증은 앱에서 취소했다.

재현: `npm run dev` → 출력된 프런트 주소 → 연결 추가 → OpenAI / ChatGPT OAuth → Continue with ChatGPT.
사용자가 승인한 후 목록 조회 → 모델 선택 → 사용량 동의 → 실행.
성공 시 실제 모델 ID·endpoint·시간과 결과 요약을 추가한다. 토큰·인증 code·nonce·verifier는 기록하지 않는다.

## GitHub Copilot

- [OpenCode 제공자 문서](https://opencode.ai/docs/providers/)
- [OpenCode 인증 문서](https://opencode.ai/docs/cli/providers)
- [GitHub device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
- 확인한 OpenCode commit: `2f0e2dbbff4b271b122399b89a1d8965c2a40fe0`
  - [Copilot 인증·호출](https://github.com/anomalyco/opencode/blob/2f0e2dbbff4b271b122399b89a1d8965c2a40fe0/packages/core/src/plugin/provider/github-copilot.ts)
  - [모델별 endpoint](https://github.com/anomalyco/opencode/blob/2f0e2dbbff4b271b122399b89a1d8965c2a40fe0/packages/core/src/github-copilot/models.ts)
  - [OpenAI legacy 인증](https://github.com/anomalyco/opencode/blob/2f0e2dbbff4b271b122399b89a1d8965c2a40fe0/packages/core/src/plugin/provider/openai.ts)

GitHub device code → access token → user/entitlement 확인 → 모델 조회 → 지원 endpoint로 호출.
`copilot_internal/user`는 일반 OAuth 앱에서 사용 가능함을 보장하지 않는다.
사용 권한 있는 OAuth client ID와 Copilot 구독이 필요하며 다른 앱의 client ID는 기본값으로 사용하지 않는다.
GitHub.com만 지원한다. 토큰 만료 시 재연결한다.

## 서버와 자동화 검증

- 프런트 3001–3999 / 백엔드 4001–4999에 실제 리스너를 바인딩, 점유 포트 회피
- 프런트 `/api/*` → 백엔드 프록시, 실제 포트 기반 Origin 검증
- OAuth session cookie, 다른 브라우저의 계정 접근 거부
- 토큰 암호화·비밀 필드 응답 제외
- state·nonce·audience·서명·만료·동시 갱신·거절·취소 검증
- 구독 추론의 API 옵션과 SSE 완료/중단/사용량 오류 검증

테스트는 실제 외부 계정 연동 성공의 증거가 아니다.

### 이번 작업의 확인 결과

- 자동화 테스트 37개 통과, 타입 검사 및 프로덕션 빌드 통과
- 프로덕션 실행에서도 3xxx/4xxx 분리, 페이지·API 프록시 HTTP 200, 교차 Origin 요청 HTTP 403 확인
- 390px 모바일에서 문서 가로 넘침 없음, 모델 검색에서 실제 Seedance 카탈로그 항목 표시 확인
- OAuth 새 창 로그인 진입 및 앱에서 대기 취소 재확인: 브라우저 console error 없음
- 재시작 시 다른 빈 포트로 바뀌는 것 확인 (프런트 3299 / 백엔드 4643)

## 모델 사양 표시 보완

- models.dev의 한도·기능·기본/캐시/컨텍스트 구간별 가격을 저장하고 캐시를 새 형식으로 갱신한다.
- 연결 계정의 모델 API가 명시적으로 제공한 한도를 보존한다. 같은 제공자·정확한 모델 ID 또는 명시적 canonical ID로만 참고 사양을 매칭한다.
- 계정 API 제한과 카탈로그 참고값이 다르면 두 값을 구분해 표시한다. 최대 입력을 다른 한도에서 역산하지 않는다.
- 가격 0, 기능 미지원(false), 정보 미확인을 구분한다. 컨텍스트 0은 유효한 한도로 표시하지 않는다.
- 실제 공개 카탈로그로 GPT-6 Astra의 컨텍스트 1,050,000 / 입력 922,000 / 출력 128,000 / 기본 입력 $10·출력 $50 per 1M tokens를 화면에서 확인했다. 이는 해당 카탈로그의 참고 정보이며 연결 계정의 실제 제한 검증이 아니다.
- 테스트 47개 통과, 프로덕션 빌드 통과.
- 모델 선택창은 격리된 브라우저에서 모의 계정과 실제 공개 카탈로그로 검색·방향키·Enter·Escape·포커스 복귀·390px 모바일을 확인했다. 미등록 모델은 미확인으로 표시하며 구독과 API 가격을 구분한다. 실제 모델 생성은 실행하지 않았다.
