# 연결 검증 기록

## 2026-11-11 제작 세션과 출력물 조회

- 프로젝트를 구성 원본, 제작 세션을 영상 한 편으로 분리했습니다. 생성 요청의 revision·중복 ID를 검사하고 스텝·기본값·참조·모델 사양·endpoint를 고정합니다. 이후 예약과 자동 진행도 세션의 스냅샷을 사용하며 토큰은 계정에서 갱신합니다.
- 작업·결과·검수·대화·피드백·중복 요청을 세션별로 구분합니다. 원본 수정은 기존 세션의 대기·진행·완료 결과를 취소하거나 무효화하지 않습니다. 세션 정의 수정은 HTTP에서 거부하고 실행·검수에는 세션을 요구합니다.
- 이전 실행 이력은 기존 제작 세션으로 한 번 이전하고 원본 기록을 보존합니다. 진행 중인 구버전 작업도 저장된 작업의 세션 참조로 로그·결과·복구를 이어갑니다.
- 출력 탭의 출력 추가·입력 스텝 선택·형식 폼과 준비 패키지 버튼을 제거했습니다. 모든 스텝의 검수가 끝난 세션에서 지정된 최종 스텝(미지정 시 마지막 스텝)의 승인 결과만 조회·다운로드합니다. 문서·코드는 실제 확장자로, 연결된 이미지·영상·음성은 실제 파일로 제공합니다. 진행 중인 세션은 대기 스텝과 이어가기를 표시합니다.
- 임시 SQLite의 실제 브라우저에서 세션 A 생성·직접 결과 저장·검수 → 원본 구성 변경 → A의 이전 지시 유지 → 커버 파일 연결·검수 → 문서와 PNG 출력 → 새 구성의 세션 B 초기화를 확인했습니다. 중간 검수 상태에서는 다운로드가 없고, 새로고침·세션/출력 필터·문서 다운로드와 320–1440px 가로 넘침도 확인했습니다. 유료 모델 호출은 하지 않았습니다.
- 자동화 검증은 전체 스냅샷·지연 스텝의 고정 모델·동시 세션 격리·파일 소유권·승인 결과 조회·HTTP 변경 거부·기존 이력 이전·SQLite 재시작 복구를 포함합니다. 실제 영상 생성·렌더링 연동 성공과는 별개입니다.
- 타입 검사·159개 테스트·프로덕션 빌드·diff 공백 검사가 통과했습니다.

## 2026-11-11 영상 한 편 범위와 재사용 설정

- 한 프로젝트·새 계획 도구의 범위를 영상 한 편으로 명시했습니다. 브랜드·예산 선택·편성표·다주차 운영·여러 편 일괄 제작을 기본 스텝에서 제외하도록 지시하며, 채널 목표만 있으면 이번 편의 주제·메시지만 질문하도록 했습니다.
- 목표·모델을 이번 영상과 공통 제작 설정으로 구분했습니다. 브랜드·시청자·말투·스타일·방식·선택적 음성/예산/제작 모델·공통 이미지를 저장·불러옵니다. 설정 갱신의 revision 충돌·워크스페이스 격리·참조 이미지 소유권을 서버에서 검사합니다.
- 관련 질문·답변을 제한된 대화 스냅샷으로 전달하고 설정·영상 규격·참조도 작업별 보존합니다. 이미지 입력 모델에는 실제 파일, 텍스트 전용 모델에는 목적·메타데이터만 전달하는 것을 모의 SDK 스트림으로 확인했습니다.
- 새 테스트는 저장 설정의 사본·격리·충돌, 다음 영상의 결과/승인/대화 초기화, 설정 변경 시 결과 갱신, 단일 영상 지시·질문 맥락 전달, 이미지 전달 방식과 기존 해시/승인 호환성을 포함합니다.
- 별도 임시 SQLite에서 브라우저로 설정 저장·갱신·다음 영상·프리셋 선택 생성·공통/개별 이미지 업로드·출력 규격 연동·기존 영상의 설정 유지·새로고침 영속성을 확인했습니다. 준비 작업/유료 호출은 생성하지 않았습니다. 320–1440px 가로 넘침과 콘솔 오류가 없었습니다.
- 타입 검사·153개 자동화 테스트·프로덕션 빌드·diff 공백 검사가 통과했습니다.
- 실제 Astra 재호출은 하지 않았습니다. 자동화 검증은 모의 모델이며 단일 영상 계획 품질의 실제 계정 성공으로 간주하지 않습니다.

## 2026-11-11 제작 대화 가독성과 공간 정리

- 화면의 Pi 이름과 반복 발신자 레이블을 제거하고 제작 대화·수정 대화로 표시합니다. 응답은 react-markdown·remark-gfm으로 문단·목록·표·코드를 구분하고, 작업 이벤트는 접힌 기록으로 분리합니다.
- 스텝이 없으면 짧은 안내와 넓은 대화, 스텝이 있으면 좁은 목록·편집기·확장된 대화로 배치합니다. 스텝 추가 중복 버튼을 제거했습니다. 대화 내역과 제안만 스크롤하고 입력창은 72–176px로 자동 확장합니다.
- 반복 사용량 체크박스와 상시 안내를 제거했습니다. 제안·준비 버튼이나 단축키의 사용자 요청에서 기존 서버의 명시적 실행 플래그를 전달합니다. 미저장·모델 미지정·작업 중 실행 제한을 유지합니다.
- 격리 브라우저의 모의 API로 전송 전 POST 없음, Ctrl+Enter 전송 1회·실행 플래그·입력 초기화, 미저장 실행 차단, 저장 후 준비 가능, 직접 추가 이름 포커스를 확인했습니다. 320·390·768·900·1024·1100·1200·1440px에서 빈/스텝 화면의 가로 넘침과 입력창 잘림이 없었습니다. 읽던 스크롤 위치 유지와 입력창 확장도 확인했습니다.
- Markdown의 원시 script와 javascript 링크가 실행·노출되지 않음을 확인했습니다. 타입 검사·146개 테스트·프로덕션 빌드·diff 공백 검사가 통과했습니다. 실제 유료 모델은 호출하지 않았습니다.

## 2026-11-11 최초 선택 포트 유지

- 매번 임의 포트를 고르던 동작을 수정했습니다. 최초의 빈 포트 선택을 `.data/runtime/{client,server}-port.json`에 저장하고 watch·앱 재실행에서도 재사용합니다. 기존 실행 주소가 있으면 그 포트를 우선 보존하며, 명시적 변경은 `OPENSTUDIO_CLIENT_PORT`·`OPENSTUDIO_SERVER_PORT`로 지원합니다.
- 지정 포트가 IPv4 또는 IPv6에서 점유됐으면 다른 포트로 이동하지 않고 시작 오류를 표시합니다. 잘못된 범위·브라우저 차단 포트·손상된 저장 설정도 거부합니다.
- 임시 워크스페이스의 실제 server watch 재시작 두 번과 watch 프로세스 종료 후 재실행에서 모두 같은 4408 포트를 사용했습니다. 기본 워크스페이스도 재시작 전후 서버 4342 유지와 기존 client 프록시의 HTTP 200 응답을 확인했습니다.
- client·server의 포트 저장·runtime 정리 후 재사용·이전 주소 이전·IPv4/IPv6 충돌·설정 검증을 자동화했습니다. 타입 검사·146개 테스트·diff 공백 검사가 통과했습니다.

## 2026-11-11 서버 개발 watch

- server의 `dev`를 `tsx watch --clear-screen=false src/main.ts`로 변경했습니다. 서버와 import한 공통 패키지 변경을 감지하며 Turbo 로그를 지우지 않습니다. 운영 `start`는 기존 실행 방식입니다.
- 임시 SQLite 환경에서 서버 라우트와 `packages/shared/src/workflow.ts`를 각각 변경해 자동 재시작을 확인했습니다. 이전 서버 프로세스 종료와 새 서버의 DB 실행권 획득·runtime 주소 발행이 정상 동작했습니다. 확인용 소스 변경은 복원했습니다.
- client를 재시작하지 않고 `/api/connections`·`/api/workflows`가 새 서버로 연결되어 HTTP 200을 반환했습니다. 런타임·작업 루프 관련 테스트 8개와 diff 공백 검사가 통과했습니다.
- 실행 중이던 기본 로컬 서버도 watch 실행으로 전환하고 기존 client 프록시의 정상 응답을 확인했습니다. 실제 제공자 생성 요청은 전송하지 않았습니다.

## 2026-11-11 공통 UI와 제목 편집

- Tailwind CSS 4와 shadcn/ui·Radix 기반 기본 요소, 제작용 패널·폼·액션·상태 컴포넌트를 추가했습니다. 제작 화면·연결 카드·연결 대화상자에서 같은 컨트롤 크기와 간격을 사용합니다. AI Elements의 Chat/Plan 패턴은 Pi 데이터에 맞춘 자체 구현이며 AI SDK transport를 설치한 것은 아닙니다.
- 프로젝트 이름 변경을 별도 서버 작업으로 구현했습니다. 142개 테스트가 통과했으며, 새 검증은 다른 미저장 설정·계획 revision·대기 작업 유지, 이름 충돌·멱등 처리·빈 이름 거부·계정 격리를 포함합니다. 타입 검사·프로덕션 빌드도 통과했습니다.
- 별도 임시 SQLite의 브라우저에서 생성·제목 클릭 편집·Enter 저장·Esc 취소·빈 이름 오류를 확인했습니다. 이름을 저장해도 미저장 목표는 입력에 남고 서버의 기존 목표와 revision은 유지됐습니다.
- 빈 스텝 안내의 계획 제안·직접 추가는 각각 대화 입력·스텝 이름으로 포커스를 옮겼으며 POST 요청이 없었습니다. 주요 탭·전역 메뉴 이동, 미저장 초안 유지도 확인했습니다.
- 320px·390px에서 제작·연결·모델 실행·기록 화면의 페이지 가로 넘침이 없었습니다. 좁은 화면의 하위 탭은 가로 스크롤로 탐색합니다. 연결 폼의 입력 높이 44px·글자 16px, 키 입력의 password 타입·닫기 후 초기화, 대화상자와 제목 편집 종료 시 포커스 복원을 확인했습니다.
- 모의 연결 응답으로 200개 모델·연결 상태·확인 시각·모델 선택 이동을 확인했습니다. 실제 인증 정보나 유료 모델 호출을 사용하지 않았습니다. 브라우저 콘솔 오류·경고는 없었습니다.

## 2026-11-11 컨텍스트 탭으로 화면 분리

- 왼쪽 전역 메뉴를 유지하고 중복된 상단 전역 메뉴를 제거했습니다. 제작 스튜디오의 상단 탭을 목표·모델 / 스텝 구성 / 제작·검수 / 출력으로 분리했습니다.
- 계획 제안과 스텝 피드백 입력을 분리하고, 탭 이동 및 연결 관리 방문 중 모델 선택·작업 지시·계획 초안·미저장 결과·피드백 초안이 유지됨을 브라우저에서 확인했습니다.
- 임시 SQLite 워크스페이스에서 수동 결과 저장·검수 승인·두 출력 설정·JSON 패키지 다운로드를 확인했습니다. 계획 제안·적용 UI는 모의 API로 확인했습니다. 실제 유료 모델 호출은 하지 않았습니다.
- 모델 실행의 상단에는 네 작업 유형, 작업 기록에는 전체/미디어/텍스트 필터만 표시합니다. 연결 화면에는 불필요한 탭이 없습니다.
- 타입 검사·141개 회귀 테스트·Turbo 빌드·diff 공백 검사가 통과했습니다. 320px·390px에서 네 탭의 가로 넘침이 없고 탭 글자는 14px를 유지했습니다. 키보드 탭 이동과 선택 상태도 확인했습니다.

## 2026-11-11 Pi 기반 제작 준비 MVP

- 프로젝트·사용자 편집 가능한 스텝 DAG·검수 옵션·출력 분기·결과 버전·피드백을 기존 SQLite 암호화 Workspace에 추가했습니다. 기존 연결·생성 작업은 유지합니다.
- Pi Agent Core/AI 1.5.2를 server에 명시적으로 연결했습니다. 도구는 계획 제안·결과 제출·사용자 질문만 제공하며, 스튜디오 준비 작업에서 이미지·음성·영상·셸·파일·렌더링을 실행하지 않습니다.
- 기존 계정의 키와 OpenAI 토큰 갱신을 재사용합니다. Responses SSE와 완료 JSON의 SDK 호환을 검증했습니다. 토큰·제공자 원문 오류를 프로젝트 응답이나 기록에 노출하지 않습니다.
- 기존 server 작업 인덱스로 준비 요청을 영속 처리합니다. 검수에서는 추가 모델 요청 없이 대기합니다. 커밋한 도구 결과는 재호출 없이 복구하고, 응답을 확인하지 못한 실행은 unknown으로 보존합니다.
- 141개 테스트·타입 검사·Turbo 빌드가 통과했습니다. Pi의 실제 도구 실행 루프에 모의 모델 스트림을 연결해 검수 차단·질문·실행 중 피드백·계획 충돌·결과 갱신·중복 요청·승인·복구·계정 격리·삭제된 대기 스텝의 호출 차단을 검증했습니다. 모델 HTTP 전송도 모의 SSE/JSON으로 검증했습니다.
- 별도 임시 DB의 브라우저에서 프로젝트 생성·스텝 추가·연결·검수·직접 수정·SVG 애니메이션 미리보기·세로/가로 출력 설정·JSON 다운로드·새로고침 후 복원을 확인했습니다. 준비 패키지의 rendered=false, 결과 3개·출력 2개를 확인했습니다.
- 계획 제안·적용·피드백 재실행·버전 2개·검수 완료 UI는 모의 API로 확인했습니다. 320px·390px 가로 넘침 없음도 확인했습니다. 영상 파일과 유료 모델 결과는 만들지 않았습니다.
- Pi 공식 출처와 현재 구현 범위는 `docs/studio-system.md`에 기록합니다.

## 2026-11-10 Turbo에서 앱 통합 실행

- 루트 `pnpm dev`와 `pnpm start`를 각각 `turbo run dev --continue=always`, `turbo run start --continue=always`로 변경했습니다. 자체 fork 실행기는 제거했습니다.
- 각 앱이 환경 설정·포트 바인딩·종료를 담당합니다. `.data/runtime/`에는 PID·인스턴스 ID·loopback 주소만 저장하고, 상대 프로세스가 없거나 기록이 잘못됐으면 사용하지 않습니다.
- client 프록시는 현재 server 주소를 읽고, server의 Origin 검사는 현재 client 주소를 읽습니다. client가 없을 때는 변경 요청을 거부합니다. 앱을 다시 실행해 포트가 달라져도 상대 앱의 재시작 없이 새 주소를 사용합니다.
- 타입 검사·127개 테스트·Turbo 빌드·diff 공백 검사가 통과했습니다. 새 테스트는 런타임 기록 교체·종료 정리·중단 프로세스·잘못된 주소·client 주소 변경 후 Origin 제한을 검증합니다.
- 별도 임시 DB에서 실제 `pnpm dev`의 두 앱 동시 실행과 프록시를 확인했습니다. client를 강제 종료했을 때 server health가 유지됐고, 필터 명령으로 client를 다시 실행한 뒤 새 Origin은 허용하고 옛 Origin은 거부했습니다. server만 다시 실행했을 때 기존 client가 새 API 주소로 연결되는 것도 확인했습니다.
- 별도 임시 DB와 테스트용 키로 `pnpm start`의 동시 실행·프록시를 확인하고 Turbo에 SIGINT를 보내 두 앱의 종료를 확인했습니다. 검증용 서버는 모두 종료했으며 실제 유료 제공자 호출은 실행하지 않았습니다.

아래의 자체 실행기·자동 재시작 설명은 이전 구현 이력입니다. 현재 실행 방식은 위 구성을 기준으로 합니다.

## 2026-11-10 pnpm 전환

- 실행 중인 OpenStudio 실행기·client·server를 종료했습니다.
- 패키지 매니저를 `pnpm@12.4.2`로 고정하고 workspace 정의를 `pnpm-workspace.yaml`로 이전했습니다. 내부 패키지는 `workspace:*`로 연결합니다.
- npm 잠금 파일의 기존 의존성 버전을 가져와 `pnpm-lock.yaml`을 생성하고 `package-lock.json`을 제거했습니다. 설치 스크립트는 필요한 esbuild만 허용합니다.
- 검증 명령은 `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`입니다. 개발 서버는 다시 실행하지 않습니다.
- 고정 잠금 파일 설치·타입 검사·124개 테스트·Turbo 빌드·diff 공백 검사를 통과했습니다.

## 2026-11-10 Turbo TUI 실행

- 루트 dev/start 스크립트를 Turbo 실행으로 통합하고 `turbo.json`에 TUI를 지정했습니다. client·server를 함께 보여주되 한쪽 종료가 다른 쪽을 중단시키지 않습니다.
- 각 앱이 자신의 포트와 종료를 담당합니다. `.data/runtime/{client,server}.json`에는 PID·임의 인스턴스 ID·loopback 주소만 원자적으로 공개합니다. 앱은 상대 주소를 요청 시 다시 읽으며 상대 앱 재시작에 따라 포트가 바뀌어도 동작합니다.
- 주소 기록이 없거나 잘못된 경우 변경 요청은 실패 폐쇄합니다. 새 client 주소만 Origin allowlist에 반영하고 이전 주소는 거부합니다.
- Turbo에서 두 앱 동시 실행·API 프록시·client 단독 재시작 중 server health 유지·server 단독 재시작 후 기존 client 프록시 갱신을 확인했습니다. 별도로 Turbo start와 SIGINT 전체 종료도 확인하고 검증 서버를 종료했습니다.
- 타입 검사·127개 테스트·build·diff 공백 검사가 통과했습니다. 실제 유료 제공자 호출은 하지 않았습니다.

## 2026-11-10 Turborepo · SQLite · server 내부 작업 루프

- `apps/client`와 `apps/server`를 독립 프로세스로 분리했습니다. 공통 공개 코드와 SQLite 구현은 각각 `packages/shared`, `packages/database`입니다. 별도 worker 앱은 없습니다.
- 기존 암호화 Workspace를 SQLite 행으로 이전하고 작업 인덱스·실행권을 같은 DB 커밋으로 반영합니다. 기존 `.enc`와 에셋 경로는 보존하며 DB가 이미 갱신된 항목을 다시 덮어쓰지 않습니다.
- 생성 접수는 `queued`를 먼저 커밋합니다. server 루프가 실행권을 획득·갱신하며 제출/조회/파일 확보를 처리합니다. client는 상태 GET만 호출합니다.
- 재시작 시 외부 ID·결과 URL·제출 의도 기록에 따라 복구합니다. 이미 과금됐을 수 있는 제출은 `unknown`으로 보존하고 자동 재제출하지 않습니다.
- 기본 로컬 모드에서 localhost·127.0.0.1·새 브라우저가 같은 DB 워크스페이스를 엽니다. 기존 session 격리 모드도 유지합니다.
- 124개 자동화 테스트가 통과했습니다. 기존 원본 보존·재이전 방지·에셋 경로·로컬 ID 유지·SQLite 실행권 경쟁·DB 재개방 후 큐 복구·기존 작업 추적·다운로드만 재시도·불명확 제출 차단·브라우저 코드의 server/database import 경계를 확인했습니다. 제공자 응답은 모의 응답입니다.
- 실제 개발 실행에서 SQLite로 이전한 연결 목록이 두 호스트에서 일치함을 공개 응답의 해시로 확인했습니다. client를 종료해도 기존 server health가 유지됐고, 실행기가 client만 같은 주소로 다시 시작했습니다. server를 강제 종료한 뒤 새 server로 자동 복구하고 프록시가 새 주소로 이어지며 연결 목록이 그대로 유지되는 것도 확인했습니다.
- 이 단계에서 실제 유료 생성은 실행하지 않았습니다. 텍스트 호출은 현재 요청 안에서 처리하며 음성·이미지·영상의 영속 실행과 구분합니다.
- 타입 검사와 Turbo 프로덕션 빌드가 통과했습니다. 별도 임시 DB로 `npm start`를 실행해 프로덕션 화면·API 프록시·local 워크스페이스 초기화도 확인했습니다.

아래는 이전 구현 단계의 기록입니다. 저장소·세션·브라우저 polling 설명은 위의 현재 구조를 기준으로 합니다.

## 2026-11-10 연결 상태 피드백·localhost

- 연결 카드와 계정 목록에 상태 배지를 항상 표시하고 인증 확인·모델 개수·확인 시각·실제 실행 확인을 펼쳤습니다. 연결된 제공자를 먼저 보여주며 완료 메시지와 모델 선택 동선을 제공합니다.
- 모델 조회 등 기존 인증을 사용하는 요청의 실패를 계정에 저장합니다. 401은 재인증, 403은 권한, 일시적인 실패는 재확인 실패로 구분하고 마지막 정상 모델 목록은 보존합니다. 잘못된 교체 키는 기존 정상 인증 상태를 덮어쓰지 않습니다.
- localhost와 127.0.0.1을 같은 프런트 포트에서 지원하며 IPv4·IPv6 loopback을 함께 바인딩합니다. API Origin은 설정된 포트의 두 호스트만 허용합니다. 외부 출처·다른 포트는 거부합니다.
- OpenAI·OpenRouter OAuth 콜백은 시작한 브라우저 호스트를 유지합니다. 두 호스트의 쿠키 저장소는 별개입니다. 실제 제공자 로그인 승인은 자동 실행하지 않았습니다.
- 타입 검사와 112개 테스트에서 상태 분류·오류 저장/복구, IPv4/IPv6 접속·포트 충돌 정리, Origin 제한, localhost OAuth 콜백·토큰 교환을 확인했습니다. 제공자 응답은 테스트용 모의 응답입니다.
- 프로덕션 빌드와 diff 공백 검사 통과. 실제 localhost/127.0.0.1 브라우저에서 API 요청·OpenRouter OAuth 시작/취소·호스트별 콜백 URL을 확인했습니다. 제공자 승인·키 교환은 실행하지 않았습니다. 두 호스트의 HMR WebSocket 연결과 콘솔 오류 없음도 확인했습니다.
- 모의 연결 응답으로 완료 메시지·모델 200개 표시·연결된 제공자 우선 정렬·일시적 실패·재인증 필요·정상 재확인 복구를 검증했습니다. 320px/390px에서 가로 넘침이 없었습니다. 실제 fal 계정의 유료 실행 검증은 아닙니다.

## 2026-11-10 프로바이더 연결 우선으로 수정

- 현재 흐름은 **프로바이더 연결 → 작업 유형 → 연결 계정 → 모델 선택 → 실행**입니다. 아래의 이전 모델 등록·직접 endpoint 등록 UI 기록은 과거 구현 이력입니다.
- 별도의 모델 등록 화면과 등록/삭제 API를 제거했습니다. 기존 계정·인증·작업 데이터는 유지합니다.
- fal.ai·BytePlus 연결 폼은 API 키와 연결 이름을 받습니다. 모델 ID·URL을 입력하는 UI는 제공하지 않습니다.
- fal.ai 전체 검색은 연결 계정의 키로 조회하며 반환 모델을 계정 모델 캐시에 반영합니다. 검색 결과 선택 후 같은 실행 어댑터로 호출합니다. 이 캐시는 별도 사용자 모델 등록 목록이 아닙니다.
- 계정 API와 공개 목록의 차이, 실제 실행 권한은 기존과 같이 구분합니다. 이번 수정에서 외부 유료 생성은 실행하지 않았습니다.
- 자동화 테스트: 키만으로 BytePlus 연결·조회, fal.ai 인증 검색·cursor·중복 캐시·계정 격리, 모델 등록 없이 텍스트 실행과 기록 격리를 검증했습니다.
- 타입 검사·101개 테스트·프로덕션 빌드·diff 공백 검사가 통과했습니다.
- 브라우저: 실제 연결 폼에서 fal.ai·BytePlus가 연결 이름/API 키 두 입력만 받는 것을 확인했습니다. 모의 응답으로 키 연결 → 계정 선택 → 모델 선택, fal.ai 검색 결과의 직접 선택, BytePlus 계정별 목록 분리, 음성 모델 선택을 확인했고 모델 등록 API 요청은 없었습니다. 320px·390px 레이아웃과 콘솔 오류 없음도 확인했습니다. 실제 유료 생성 검증과는 별개입니다.

## 2026-11-10 모델 중심 화면·ElevenLabs TTS

- 모델 등록은 세션별 암호화 Workspace에 연결 ID·모델 ID·유형을 참조해 저장합니다. 인증 정보는 기존 계정에만 저장합니다.
- 유형별 등록 목록, 단일 모델 추가 흐름, 설정 안의 연결 계정 관리, 별도 작업 기록을 구현했습니다. 모델 목록 갱신 시 등록 ID를 변경하지 않습니다.
- ElevenLabs는 `xi-api-key` 헤더로 `/v1/models`를 조회하고 TTS 가능 모델만 제공합니다. `/v2/voices`의 검색·페이지 토큰을 지원합니다.
- 생성은 `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`입니다. 모델·보이스·원고를 작업에 남기고 MP3를 세션별로 저장합니다.
- 동일 요청 ID는 재제출하지 않습니다. 인증·권한·한도 오류를 구분하고 네트워크/5xx의 불명확한 제출은 `unknown`으로 보존합니다.
- **실제 계정 검증:** ElevenLabs API 키·보이스 권한·유료 생성은 미검증입니다. 모델 조회와 생성의 자동화 테스트는 모의 응답입니다.
- **자동화 검증:** 타입 검사·100개 테스트·프로덕션 빌드·diff 공백 검사를 통과했습니다. 모델 등록의 세션 격리, 계정 참조 재사용, 등록 중복 방지, TTS 동의·오류·불명확 제출·MIME 검사·오디오 Range 접근을 검증했습니다.
- **브라우저 검증:** 실제 빈 워크스페이스와 계정 연결 폼을 열었습니다. 이어서 브라우저 요청을 모의 처리해 연결 완료 후 등록 복귀, 기존 계정 재사용, 등록 유지, 음성 결과 컨트롤·다운로드 링크, 텍스트·이미지·영상 폼, 별도 작업 기록을 확인했습니다. 모의 MP3는 실제 생성·오디오 디코딩 성공의 증거가 아닙니다. 320px·390px에서 가로 넘침이 없었고 콘솔 오류는 없었습니다.
- 무작위 포트 중 브라우저가 차단하는 3659·4045를 할당에서 제외했습니다.
- 재현: 모델 추가 → 음성 → 제공자에서 조회 → ElevenLabs → API 키 연결 → 조회된 TTS 모델 등록 → 보이스 선택 → 원고 입력 → 크레딧 사용 동의 → 음성 생성 → MP3 재생/다운로드.
- 공식 문서 확인일: 2026-11-10.
  - https://elevenlabs.io/docs/api-reference/models/list
  - https://elevenlabs.io/docs/api-reference/voices/search
  - https://elevenlabs.io/docs/api-reference/text-to-speech/convert
  - https://developers.openai.com/api/docs/guides/text-to-speech.md — 기존 Speech 모델 종료 예고를 확인했으며 이번 TTS 어댑터에는 포함하지 않았습니다.

아래는 이전 단계의 검증 이력입니다.

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

재현: `pnpm dev` → 출력된 프런트 주소 → 연결 → OpenAI / ChatGPT OAuth → Continue with ChatGPT.
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

## Responses 응답 형식 수정

- 기존 파서는 Content-Type이 `text/event-stream`이 아니면 본문을 읽기 전에 거부했다.
- 누락·오표기된 헤더의 유효 SSE, 완료된 Responses JSON, JSON 형식 사용량 오류에서 같은 형식 오류를 재현해 파서를 수정했다.
- 이제 본문의 SSE/JSON 구조와 완료 상태를 검증한다. JSON 오류·HTML·미완료·끊긴 스트림은 성공으로 기록하지 않는다.
- 사용자가 보고한 실제 실패 응답 본문은 확보하지 못했으므로, 정확한 upstream 원인은 미확인이다. 사용자 재시도로 검증해야 하며 유료 요청을 자동 반복하지 않는다.
- 수정 후 전체 테스트 50개 통과.

## 제공자·OAuth·미디어 확장 (2026-11-10)

### 구현 범위

- 제공자 레지스트리: OpenAI, OpenRouter, Anthropic, Google, fal, Copilot, xAI, DeepSeek, Groq, Mistral
- OpenRouter 공식 PKCE: 브라우저 세션/state/S256, 일회성 코드 교환, `/key` 검증, 암호화 저장, 취소·만료 처리. 키 교환 후 계정 확인의 일시 실패는 재교환 없이 재확인한다.
- Anthropic 모델 페이지네이션·Messages, Google 모델 페이지네이션·generateContent, OpenAI 호환 제공자의 모델 조회·Chat Completions
- OpenRouter 공개 이미지/영상 명세와 fal 분류별 최신 50개 목록·선택 모델의 OpenAPI 입력 스키마 조회
- 이미지·영상 요청/결과, 참조 이미지 업로드, 미디어 작업 기록, 결과 파일 저장·재생·다운로드
- 요청 ID 중복 방지, 외부 작업 ID 유지, 결과 재수집, 재시작 시 불명확한 제출을 자동 재생성하지 않는 상태 처리
- 파일의 실제 MIME 바이트 확인, 세션 격리, CDN 이동 시 인증 헤더 제거, MP4/WebM Range 요청
- 기존 API 계정 ID를 유지하는 키 갱신. 진행 작업의 결과 확보 전에 계정을 삭제하지 않는다.

### 실제 확인과 미확인 구분

- **확인:** OpenRouter OAuth 버튼으로 실제 `openrouter.ai` 로그인 진입. 계정 승인은 진행하지 않았다.
- **확인:** OpenRouter 공개 `/images/models/.../endpoints`, `/videos/models`에서 실제 옵션·과금 단위 조회.
- **확인:** fal 공개 모델 목록은 인증 없이 HTTP 200이나, 잘못된 키를 전달하면 HTTP 401. 익명 공개 조회를 키 검증 성공으로 취급하지 않는다.
- **확인:** fal Seedream 5.0 Pro의 실제 OpenAPI를 읽어 입력 스키마의 로컬 검증과 기본값 적용을 확인했다. 생성 API는 호출하지 않았다.
- **미확인:** 새 제공자의 실제 사용자 키·계정 승인·유료 이미지/영상 생성. 계정·크레딧을 연결한 사용자가 실행 동의 후 검증해야 한다.
- **자동화:** OAuth·제공자·미디어 파이프라인은 모의 HTTP로 검증한다. 브라우저에서는 모의 계정·생성 응답으로 옵션 조회, 참조 선택, 동의 전 차단, 결과 표시, 새로고침 후 기록 복원, 모바일 가로 넘침 없음과 하위 Seedance 비활성화를 확인했다. 실제 연동 성공 증거와 별개다.

### Seedance 5.0 이상

요청 버전은 5.0 이상으로 유지한다. 현재 조사에서 공식 endpoint를 확인하지 못했다. 하위 버전 모델은 공개 목록에서 실행 불가로 표시하고 서버에서 재검증한다. Seedream 이미지 모델과 혼동하지 않는다.

### 참고 자료

- [OpenRouter OAuth PKCE](https://openrouter.ai/docs/use-cases/oauth-pkce)
- [OpenRouter 키 확인](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
- [OpenRouter 이미지 API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter 영상 API](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
- [fal 모델 검색·OpenAPI 확장](https://fal.ai/docs/platform-apis/v1/models.md)
- [fal Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [Claude API](https://platform.claude.com/docs/en/api/overview)
- [Claude 구독 인증 조건](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
- [Google 모델 API](https://ai.google.dev/api/models)

### 남은 제약

단일 프로세스 로컬 검증 구조이며 외부 작업의 조회·다운로드는 브라우저가 재접속하거나 열린 동안 진행한다. 원격 공유 서비스의 사용자 로그인·DB·분산 워커·용량 정리는 후속 작업이다. 현재 참조 입력은 이미지에 한정하며 영상·오디오 참조와 편집·합성 스텝은 아직 없다.

### 이번 확장 검증 결과

전체 테스트 67개, 타입 검사, 프로덕션 빌드 통과. 런타임에서 제공자 10개 등록과 API health HTTP 200을 확인했다. 최종 재시작 주소는 프런트 3708 / 백엔드 4332이며 실행 시마다 다시 선택된다. 브라우저에서 미디어 옵션의 명시적 레이블, 동의 전 생성 차단, 모의 결과 표시·작업 기록 복원, 하위 Seedance 실행 차단과 390px 가로 넘침 없음을 확인했다. 유료 외부 생성은 실행하지 않았다.

## BytePlus ModelArk 직접 연결 (2026-11-10)

### 확인한 명세

- [Base URL과 인증](https://docs.byteplus.com/en/docs/modelark/base-url-and-authentication): Singapore `https://ark.ap-southeast.bytepluses.com/api/v3`, `Authorization: Bearer <API key>`.
- [Models API](https://docs.byteplus.com/en/docs/modelark/models-api): 계정에 보이는 기반 모델 버전 목록. `modalities`, `task_type`, `token_limits`, `features`를 사용하며 추론 endpoint 목록으로 일반화하지 않는다.
- [이미지 API](https://docs.byteplus.com/en/docs/modelark/image-generation-api): `/images/generations`, `image`, `size`, `response_format`, `output_format`, 비스트리밍 결과의 `data`.
- [영상 제출](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api): `/contents/generations/tasks`, `content`, `ratio`, `resolution`, `duration`, 시작·끝 프레임.
- [영상 조회](https://docs.byteplus.com/en/docs/modelark/get-video-generation-task-api): 작업 ID와 상태, `content.video_url`.
- [공식 Python SDK 기본 주소](https://github.com/byteplus-sdk/byteplus-python-sdk-v2/blob/master/byteplussdkarkruntime/_constants.py), [인증](https://github.com/byteplus-sdk/byteplus-python-sdk-v2/blob/master/byteplussdkarkruntime/_client.py), [이미지 요청](https://github.com/byteplus-sdk/byteplus-python-sdk-v2/blob/master/byteplussdkarkruntime/resources/images/images.py), [영상 요청](https://github.com/byteplus-sdk/byteplus-python-sdk-v2/blob/master/byteplussdkarkruntime/resources/content_generation/tasks.py), [영상 결과 타입](https://github.com/byteplus-sdk/byteplus-python-sdk-v2/blob/master/byteplussdkarkruntime/types/content_generation/content_generation_task.py).

문서가 JS 로딩 뒤 본문을 표시하므로 브라우저에서 실제 API 본문을 읽어 경로·필드를 확인했다. 다른 리전 URL은 추정해 추가하지 않았다.

### 구현과 검증 상태

- 구현: API 키·리전 설정, 기반 모델 조회/분류, 모델/ep-... ID 직접 등록·수정, 이미지 생성·참조 편집, 영상 제출·조회·파일 저장.
- 사용자 등록 ID와 기반 모델 매핑은 미확인으로 표시한다. 불투명한 영상 endpoint ID로 Seedance 버전 제한을 우회하지 않는다.
- 실행에는 당시 모델 설정과 API 주소를 보존하며 새 설정으로 기존 외부 작업을 다른 URL에 조회하지 않는다.
- 실제 확인: 키 없는 `GET /models`는 HTTP 401 JSON을 반환했다. 이는 인증 성공이나 모델 조회 성공의 증거가 아니다.
- 자동화 테스트: ModelArk 요청 필드·Bearer 인증, modality 분류와 한도 보존, 지역/ID 주입 거부, ID 치환 방지, 영상 ID/상태 검사, 키·설정 격리, 서명된 이미지/영상 파일 수신 및 기존 작업 재조회. 외부 HTTP는 모의 응답이며 실제 과금 생성은 실행하지 않았다.
- 차단 요인: 실제 ModelArk API 키, 계정 활성화 모델 또는 콘솔 endpoint 권한·크레딧이 필요하다. 실제 사용자 키로 생성 성공을 확인한 뒤 별도 기록한다.
- Seedance 5.0 이상의 실제 제공 endpoint는 여전히 미확인이다. Seedream 5.0 이미지 모델과 구분한다.

### 적용 결과

테스트 78개, 타입 검사, 프로덕션 빌드 통과. 프런트 3548 / 백엔드 4429에서 BytePlus 등록과 API health를 확인했다. 실제 연결 폼에서 Singapore 리전·공식 Base URL·ID 입력 규칙을 확인했고, 별도 모의 계정 응답으로 설정 전달·등록 수정·문자열 크기 옵션·390px 모바일 가로 넘침 없음·브라우저 오류 없음을 확인했다. UI 검증용 키는 요청을 가로채 실제 서비스에 보내지 않았으며 유료 생성도 실행하지 않았다.

## fal.ai 연결 보완 (2026-11-10)

기존 Queue 어댑터와 최신 50개 목록에 다음을 추가했다.

- 연결 전 공개 모델 검색·작업 분류·cursor 페이지 조회. 공개 검색에는 앱 쿠키나 인증 키를 전달하지 않는다.
- API 키 연결 폼과 fal.ai 모델 설정에서 endpoint ID/공식 모델 URL 직접 등록. 조회로 존재를 확인하고 정규화된 호출 ID를 유지한다.
- 기본 목록 밖의 직접 등록 모델을 계속 조회한다. 잘못된 신규 설정은 저장하지 않고, 기존 설정의 미조회 모델은 실행 불가로 남겨 자동 대체하지 않는다.
- 입력 명세의 로컬 참조·allOf와 참조 배열 한도 처리, prompt 없는 모델에 prompt를 강제 전송하지 않도록 보완.
- 기존 Queue 제출·상태 추적·파일 수신 경로 재사용. Seedance 하위 버전 제한을 유지한다.

실제 확인: fal 공개 모델 검색 HTTP 200, 잘못된 Key를 보낸 모델 조회 HTTP 401. 앱의 공개 검색으로 Seedream 5.0 Pro 이미지 endpoint를 찾고 추가했으며 영상 목록 20개→40개 페이지 조회를 확인했다. 카탈로그 조회는 실제 계정 권한·생성 성공의 증거가 아니다.

브라우저에서는 별도 모의 계정으로 키 연결 설정 전달, 모델 URL 정규화, 등록 수정, prompt 없는 모델의 입력 화면, 390px 가로 넘침 없음과 오류 없음을 확인했다. 실제 키나 유료 생성 요청을 자동 전송하지 않았다.

자동화 테스트 87개, 타입 검사·프로덕션 빌드 통과. 참고: [fal 모델 검색 API](https://fal.ai/docs/platform-apis/v1/models.md), [fal Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue).

fal 계정으로 재접속할 때 지원하지 않는 텍스트 탭에 머물지 않고 이미지 작업을 기본 선택하는 것도 확인했다. 적용 서버는 프런트 3437 / 백엔드 4503이며 공개 검색·health 요청은 HTTP 200이다.
