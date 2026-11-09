# OpenStudio

스텝을 연결해 영상을 완성하는 웹 워크플로우 도구. 현재는 **계정 연결과 실제 모델 호출 검증** 단계입니다.

## 실행

Node.js 22.12 이상.

```sh
npm install
npm run dev
```

터미널에 실제 주소가 출력됩니다. 매번 임의의 **빈 포트에 실제 리스너를 바인딩**합니다.

- 프런트: `http://127.0.0.1:3xxx` (3001–3999)
- 백엔드: `http://127.0.0.1:4xxx` (4001–4999)
- OpenAI callback: `http://127.0.0.1:4xxx/auth/callback`
- 브라우저의 `/api/*` 요청은 프런트 서버가 백엔드로 프록시합니다.
- 3000번을 사용하지 않습니다. `localhost`와 `127.0.0.1`을 섞지 마세요. OAuth 세션 쿠키는 호스트에 귀속됩니다.

로컬 개발용 암호화 키는 첫 실행 시 `.data/master.key`에 자동 생성됩니다. 별도 환경 설정 없이 화면·OpenAI OAuth를 시작할 수 있습니다. 키와 `.data/*.enc`는 Git에서 제외됩니다. 기존 키를 삭제하면 저장한 인증 정보를 복호화할 수 없습니다.

## ChatGPT 구독 OAuth

1. **연결 추가 → OpenAI → ChatGPT 구독 · OAuth**
2. **Continue with ChatGPT** 클릭
3. OpenAI 로그인 창에서 OpenStudio 등록과 구독 사용 권한 승인
4. 작업 화면으로 돌아와 **목록 조회**
5. 모델 선택, 프롬프트 입력, 사용량 동의 후 **실행**

공식 [ChatGPT plan usage in open-source apps](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) 흐름을 사용합니다.

- 최초 등록은 공식 `dynamic_agent_client` 진입점을 사용하며 OpenStudio 자체 client ID가 발급됩니다.
- 다른 앱의 client ID나 기존 OpenCode/Codex 인증 파일을 사용하지 않습니다.
- `state`, nonce, PKCE를 매번 생성하고 인증을 시작한 브라우저 세션에 연결합니다.
- 백엔드 4xxx의 loopback callback에서 코드를 교환합니다.
- OpenAI JWKS로 ID 토큰의 서명·issuer·audience·만료·nonce를 검증합니다.
- 로그인 성공과 `chatgpt.tokens.use.direct` 구독 권한을 구분합니다.
- 발급된 client ID와 계정 identity를 유지해 다시 로그인할 때 재사용합니다.
- 토큰은 서버에 암호화 저장하고 만료 전에 회전 갱신합니다.
- 모델 목록은 연결 계정의 `GET https://api.openai.com/v1/models`로 조회합니다.
- 호출은 공개 `POST /v1/responses`를 사용합니다. 이 공식 경로에서는 ChatGPT backend-api를 사용하지 않습니다.
- 구독 호출은 `store:false`, `stream:true`, 배열형 input을 사용하며 `response.completed`를 받아야 성공입니다.
- `max_output_tokens` 등 구독 경로에서 금지된 API 옵션은 보내지 않습니다.
- 연결 해제 시 갱신 세션의 원격 폐기를 시도하고 로컬 토큰을 삭제합니다. 계정/client 등록 매핑은 재로그인용으로 유지합니다.

현재 브라우저에서 **실제 OpenAI 로그인 페이지 진입까지 확인**했습니다. 실제 사용자 계정 승인·모델 조회·생성 성공은 별도 검증이 필요합니다. OAuth 승인은 사용자가 직접 진행해야 합니다.

공식 직접 등록은 local/self-hosted OSS용 preview 흐름입니다. 원격 공유 웹서비스의 제품 로그인·서버 운영과 동일하지 않습니다. 현재 앱은 loopback 개발 환경에 맞춰져 있습니다.

## API 키와 Copilot

- **OpenAI → API 키**: 키 입력 → 서버가 `/v1/models`로 검증 → 계정 저장. ChatGPT 구독과 별도 과금입니다.
- **GitHub Copilot**: `.env.local`에 `GITHUB_COPILOT_CLIENT_ID`를 설정하고 서버를 재시작합니다. 사용할 권한이 있고 device flow·Copilot API 접근이 허용된 OAuth 앱이 필요합니다. 일반 GitHub 로그인 성공은 Copilot 모델 호출 성공과 다릅니다.
- API 키 모델 목록에는 미디어 모델도 포함될 수 있습니다. 현재 실행 패널은 텍스트 어댑터이며 미디어 생성은 아직 구현하지 않았습니다.

```sh
# 선택 설정을 사용할 경우
cp .env.example .env.local
```

## 현재 화면

- 다크 작업 공간: 왼쪽 계정 목록, 모델·프롬프트 패널, 응답 패널, 세션 실행 기록
- models.dev 카탈로그: 검색, 출력 유형 필터, 페이지 이동, 6시간 캐시, 수동 갱신, 마지막 정상 데이터 유지
- 모델 선택: 검색 가능한 다크 선택창, 키보드 탐색, 선택 전 사양·가격 미리보기
- 모델 정보: 컨텍스트·최대 입출력·입출력 유형·추론·도구·구조화 출력·API 기본/캐시/컨텍스트 구간별 단가
- 계정 API의 명시적인 제한을 우선하고 models.dev 참고 사양은 출처를 표시해 보완합니다. 기존 계정의 API 제한 정보도 새로 받으려면 **목록 조회**를 실행하세요.
- 카탈로그 모델 이름 또는 **사양·가격**을 누르면 상세 정보를 볼 수 있습니다. 구독 사용량과 API 참고 가격은 구분해 표시합니다.
- 워크플로우·에셋 편집기는 후속 단계입니다.

## 데이터와 운영

- 인증 정보는 `.data/*.enc`에 AES-256-GCM으로 암호화합니다.
- HttpOnly/SameSite=Lax 쿠키로 브라우저 세션을 격리합니다. Lax는 OpenAI의 top-level callback을 받기 위해 사용합니다.
- 브라우저 저장소·응답·로그에 토큰을 넣지 않습니다.
- 세션 쿠키는 30일간 유효합니다. 쿠키를 삭제하면 해당 브라우저의 저장 계정에 접근할 수 없습니다.
- 파일 저장과 잠금은 단일 프로세스 검증용입니다. 공유 서비스 배포에는 사용자 로그인·DB·분산 잠금·만료 데이터 정리가 필요합니다.
- `npm run build && npm start`로 로컬 프로덕션 빌드를 실행합니다. 이 경우 `OPENSTUDIO_ENCRYPTION_KEY`에 32바이트 hex 키가 필요합니다. 실행 포트 범위와 API 프록시는 개발 환경과 같습니다.

## 확인 명령

```sh
npm run typecheck
npm test
npm run build
```

자동화 테스트는 모의 HTTP 및 테스트용 서명 키로 인증 상태·계정 격리·갱신·SSE 완료 조건을 검증합니다. 실제 제공자 연결 결과는 [docs/connections.md](docs/connections.md)에 따로 기록합니다.
