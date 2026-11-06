# AIONIT 디자인 전달 형식 요청서

- 작성일: 2026-11-06
- 보내는 쪽: AIONIT 개발
- 받는 쪽: 디자이너(디자인 AI)
- 디자인 저장소: https://github.com/StudyNLab/aionit-design (비공개, 첫 태그 `v1-2026-11-06`)
- 이 문서는 **디자인을 어떤 형식으로, 어떻게 넘겨 주시면 좋은지**만 다룹니다. 색 · 글꼴 · 배치 같은 디자인 내용은 지금처럼 자유롭게 정해 주세요.

---

## 1. 왜 필요한가

이번에 AIONIT-Service 시안을 실제 사이트에 옮기면서(PR 7개) 시간이 가장 많이 든 곳은 디자인 자체가 아니라 **형식**이었습니다.

1. **화면별 HTML이 없었습니다.** 화면이 `screens.js` · `app.js` 안의 긴 문자열로만 있어서, 화면 하나를 보려면 미리보기를 띄우고 직접 찾아 들어가야 했습니다.
2. **CSS 5개가 순서대로 서로 덮어썼습니다.** `style.css` → `service.css` → `readability.css` → `home-type.css` → `topic-accents.css` 순서라서, 어떤 값이 최종인지 화면마다 브라우저에서 재어 보고 맞췄습니다.
3. **토큰 파일이 없었습니다.** (토큰 = 색 · 간격 · 글자 크기 같은 공통 값에 이름을 붙여 모아 둔 목록) 같은 값이 여러 곳에 흩어져 있었습니다.
4. **작업 중에 시안이 바뀌었는데 버전과 변경 기록이 없었습니다.** 예: 로고가 11-06 12:11 ~ 12:35 사이에 바뀌었고, 무엇이 바뀌었는지 파일을 비교해서 알아냈습니다.
5. **예시 데이터와 화면용 동작이 섞여 있었습니다.** 실제 기능인지, 보여 주기용인지 77개 상태를 하나씩 가려냈습니다.

아래 형식으로 넘겨 주시면 이 시간들이 거의 없어집니다.

---

## 2. 앞으로 넘길 형식 (8가지)

### ① git 저장소 + 날짜를 붙인 버전 태그

디자인 자료는 **git 저장소 StudyNLab/aionit-design 하나로만** 주고받습니다. (git = 파일의 바뀐 기록을 모두 남겨 두는 도구, 태그 = 특정 시점에 붙이는 이름표)

- **디자이너는 이 저장소에서만 작업하고 커밋합니다.** (커밋 = 바뀐 것을 기록으로 남기기) 작업 단위마다 커밋해 주세요.
- **넘길 때는 태그를 붙입니다.** 이름은 `v번호-날짜`, 예: `v2-2026-11-20`. 태그를 GitHub에 올리면(push) 넘긴 것입니다.
- **태그를 붙일 때 `CHANGELOG.md` 에 그 버전의 바뀐 점을 적습니다.** "어느 화면 · 어느 부품 · 로고가 무엇에서 무엇으로" 를 한 줄씩 적어 주시면 됩니다.
- **태그를 붙인 버전은 고치지 않습니다.** 태그를 옮기거나 지우거나 다시 붙이지 않습니다. 바꿀 것이 생기면 계속 커밋하고, 다음에 넘길 때 새 태그(`v3-…`)를 붙입니다.
- **개발 쪽은 이 저장소를 읽기만 합니다.** 커밋하지 않습니다. 개발은 태그 하나를 기준으로 사이트에 옮기고, 어느 태그를 옮겼는지 개발 PR(개발 쪽 변경 묶음)에 적습니다. 다음 태그가 나오면 두 태그 사이의 차이만 보고 옮깁니다.
- 지금의 `E:\온라인아카데미_디자인\` 같은 로컬 폴더는 디자이너 작업 공간입니다. 개발 쪽은 그 폴더에 쓰지 않고, 넘겨받는 것은 저장소의 태그로만 받습니다.
- 첫 태그 `v1-2026-11-06` 은 2026-11-06 12:35 기준 AIONIT-Service 를 개발 쪽이 등록한 것입니다. 저장소 사용법은 저장소의 `저장소_사용법.md` 에 있습니다.

### ② 최종값 토큰 파일 하나

- `tokens.css` (또는 `tokens.json`) **하나**에 최종값만 모아 주세요.
- 밝은 화면 값과 어두운 화면 값을 같은 이름으로 나란히 적어 주세요. (예: 같은 이름 `--surface` 가 밝게 / 어둡게 각각 무슨 값인지)
- 다른 파일이 이 값을 덮어쓰지 않게 해 주세요.

### ③ 겹치지 않은 최종 CSS 한 벌

- 여러 파일이 순서대로 덮어쓰는 형태 대신, **덮어쓰기를 다 반영한 최종 CSS 한 벌**을 넣어 주세요.
- 파일을 나누셔도 됩니다. 다만 같은 대상을 두 파일이 다시 정하지 않게 해 주세요.
- 작업용 원본(덮어쓰는 여러 파일)은 따로 두셔도 괜찮습니다. 개발은 최종본만 봅니다.

### ④ 부품 목록과 상태별 HTML 조각

- 부품(화면 여러 곳에 반복해서 쓰는 조각) 목록과, 부품마다 **상태별 HTML 조각**을 주세요.
- 부품: 버튼 · 입력칸 · 체크(체크박스 · 라디오 · 스위치) · 카드 · 표 · 알림(안내 상자) · 머리글 · 바닥글 · 메뉴
- 상태: 기본 · hover(마우스를 올렸을 때) · focus(키보드로 골랐을 때) · disabled(누를 수 없을 때) · 오류
- 한 부품의 상태들을 한 HTML 파일에 나란히 놓아 주시면 가장 좋습니다.

### ⑤ 화면별 정적 HTML 또는 스크린숏 + 짝표

- 화면마다 **따로 열리는 HTML 파일 하나** (스크립트 없이 열리는 것)를 주세요.
  어렵다면 **화면마다 1440 너비 · 390 너비 스크린숏**이라도 주세요.
- 화면마다 **화면 ID** 를 붙이고, **화면 ID ↔ 우리 사이트 주소 짝표** (`screens.csv` 또는 표)를 넣어 주세요.
  우리 사이트 주소는 이 문서 끝 **부록**에 있습니다. 이 주소에 맞춰 화면 ID를 정해 주세요.
- 같은 화면의 다른 상태(빈 목록 · 오류 · 로그인 전/후 등)는 `ID--상태` 처럼 이어 붙여 주세요. 예: `my-payments--empty`

### ⑥ 로고는 최종본만

- 최종 로고 SVG **밝은 배경용 / 어두운 배경용** 각 1개, 파비콘(브라우저 탭 아이콘), 앱 아이콘만 넣어 주세요.
- 비교했던 시안 · 이전 로고(`before-…`, `study-…` 같은 것)는 저장소 안 **`비교시안/` 폴더**에 따로 두어 주세요. (git에 기록이 남으므로 지워도 괜찮습니다.)

### ⑦ 화면마다 표시 두 가지

화면 HTML(또는 짝표)에 아래 두 가지를 표시해 주세요.

- **예시 데이터**: 실제로는 사이트 데이터가 들어갈 자리 (강의 이름 · 금액 · 날짜 · 회원 이름 등)
- **새 기능 필요**: 지금 사이트에 없는 기능을 그린 곳 (예: 프로필 사진, 로그인 유지 선택)

HTML이라면 해당 요소에 `data-sample` · `data-new-feature` 같은 표시를 붙이거나, 짝표에 칸을 하나 두셔도 됩니다.

### ⑧ 글꼴 파일과 라이선스

- 쓰는 글꼴 파일(`.woff2`)과 각 라이선스 파일을 함께 넣어 주세요.
- 글꼴마다 어떤 굵기를 쓰는지 목록으로 적어 주세요.

---

## 3. 저장소 구조 예시

StudyNLab/aionit-design 저장소의 맨 위(루트) 기준입니다. 태그를 붙이는 순간의 저장소가 이 모양이면 됩니다.

```text
aionit-design/                (저장소 루트, 태그 v2-2026-11-20 시점)
├─ README.md               무엇이 들어 있는지, 미리보기 여는 법
├─ 저장소_사용법.md          디자이너 · 개발 쪽 규칙 (이미 있음)
├─ CHANGELOG.md            태그마다 바뀐 점 (이미 있음, 새 태그를 맨 위에)
├─ tokens.css              최종값 토큰 하나 (밝게 / 어둡게)
├─ css/
│  └─ site.css             겹치지 않은 최종 CSS 한 벌
├─ components/             부품별 상태 HTML
│  ├─ button.html          기본 · hover · focus · disabled · 오류
│  ├─ input.html
│  ├─ check.html
│  ├─ card.html
│  ├─ table.html
│  ├─ notice.html
│  ├─ header.html
│  ├─ footer.html
│  └─ menu.html
├─ screens/                화면별 정적 HTML
│  ├─ home.html
│  ├─ courses.html
│  ├─ my-payments.html
│  ├─ my-payments--empty.html
│  └─ …
├─ screenshots/            화면별 1440 · 390
│  ├─ home_1440.png
│  ├─ home_390.png
│  └─ …
├─ screens.csv             화면 ID · 사이트 주소 · 예시 데이터 · 새 기능 필요
├─ brand/                  최종 로고만
│  ├─ logo-light.svg
│  ├─ logo-dark.svg
│  ├─ favicon.svg
│  └─ app-icon.png
├─ fonts/
│  ├─ (글꼴).woff2
│  └─ LICENSE-(글꼴).txt
├─ 비교시안/                 이전 로고 · 비교안 (개발은 보지 않음)
└─ dist/ · qa/             지금의 작업 원본 · 검수 기록 (그대로 두어도 됨)
```

- 위 폴더들은 지금 저장소(`v1-2026-11-06`: `dist/` · `qa/` · `README.md` 등)에 **더해서** 만들어 주시면 됩니다.
- 개발은 `tokens.css` · `css/` · `components/` · `screens/` · `screenshots/` · `screens.csv` · `brand/` · `fonts/` 만 봅니다. `dist/` 는 작업 원본으로 두셔도 되지만, 두 곳의 내용이 다르면 위 최종본 쪽을 따릅니다.

`screens.csv` 예시:

```text
화면ID,사이트주소,상태,예시데이터,새기능필요
home,/,기본,강의 카드 6개,
my-payments,/my/payments,기본,결제 내역 3줄,
my-payments--empty,/my/payments,빈 목록,,
instructor-profile,/instructors/[id],기본,강사 이름 · 소개,강사 경력 줄
```

---

## 4. 부록: 우리 사이트 주소 목록

화면 ID는 아래 주소에 맞춰 주세요. `[slug]` · `[id]` 같은 대괄호는 "강의마다 · 회원마다 바뀌는 자리"라는 뜻입니다.
(2026-11-06 기준 실제 코드에서 뽑았습니다. 별표(*)는 화면 없이 바로 다른 화면으로 넘어가는 주소입니다.)

### 공개 (누구나)

| 주소 | 화면 이름 |
| --- | --- |
| `/` | 홈 |
| `/courses` | 강의 목록 |
| `/courses/[slug]` | 강의 상세 |
| `/courses/[slug]/preview/[key]` | 교재 미리보기 (무료 공개 장) |
| `/instructors/[id]` | 강사 소개 |
| `/subscribe` | 구독 안내 · 신청 |
| `/notices` | 공지 목록 |
| `/notices/[id]` | 공지 본문 |
| `/faq` | 자주 묻는 질문 |
| `/policies/[kind]` | 정책 문서 (이용약관 · 개인정보 처리방침 등) |
| (없는 주소) | 404 — 찾을 수 없음 |
| (권한 없는 주소) | 403 — 들어갈 수 없음 |

### 계정

| 주소 | 화면 이름 |
| --- | --- |
| `/login` | 로그인 |
| `/login/two-factor` | 2단계 인증 코드 입력 |
| `/signup` | 회원가입 |
| `/signup/sent` | 인증 메일 보냄 |
| `/forgot-password` | 비밀번호 찾기 (메일 보냄 화면 포함) |
| `/reset-password` | 새 비밀번호 정하기 |
| `/auth-error` | 로그인 오류 |

### 마이페이지

| 주소 | 화면 이름 |
| --- | --- |
| `/my` | 내 정보 |
| `/my/security` | 로그인 · 보안 (비밀번호, 2단계 인증) |
| `/my/entitlements` | 수강권 |
| `/my/payments` | 결제 내역 |
| `/my/payments/[itemId]/refund` | 환불 요청 |
| `/my/subscription` | 구독 관리 |
| `/my/subscription/card/[id]` | 결제 카드 바꾸기 결과 |
| `/my/questions` | 내 질문 (강의 Q&A) |
| `/my/inquiries` | 1:1 문의 목록 |
| `/my/inquiries/new` | 1:1 문의하기 |
| `/my/inquiries/[id]` | 1:1 문의 본문 · 답변 |
| `/my/notifications` | 알림 |
| `/my/withdraw` | 회원 탈퇴 |

### 학습

| 주소 | 화면 이름 |
| --- | --- |
| `/learn` | 내 강의실 |
| `/learn/[slug]` * | 강의 들어가기 (마지막으로 본 장으로 넘어감) |
| `/learn/[slug]/[key]` | 학습방 (교재 · 영상 · 실습 · 질문) |

### 구독 · 결제

| 주소 | 화면 이름 |
| --- | --- |
| `/checkout/[id]` | 주문서 (결제창) |
| `/checkout/[id]/success` | 결제 완료 |
| `/checkout/[id]/fail` | 결제 실패 |
| `/subscribe/[id]/success` | 구독 신청 완료 |
| `/subscribe/[id]/fail` | 구독 신청 실패 |

### 강사

| 주소 | 화면 이름 |
| --- | --- |
| `/instructor` | 강사 화면 첫 화면 |
| `/instructor/courses` | 내 강의 목록 |
| `/instructor/courses/[id]` | 내 강의 관리 |
| `/instructor/courses/[id]/stats` | 판매 · 수강 현황 |
| `/instructor/courses/[id]/versions/[vid]` | 교재 버전 |
| `/instructor/courses/[id]/versions/[vid]/chapters/[key]` | 교재 미리보기 |
| `/instructor/courses/[id]/videos/[vid]` | 영상 보기 |
| `/instructor/qna` | Q&A 답변 |
| `/instructor/settlements` | 정산 목록 |
| `/instructor/settlements/[month]` | 월 정산 명세 |
| `/instructor/profile` | 정산 정보 · 프로필 |

### 관리자

| 주소 | 화면 이름 |
| --- | --- |
| `/admin` | 관리자 첫 화면 (대시보드) |
| `/admin/users` | 회원 관리 |
| `/admin/users/[id]` | 회원 상세 |
| `/admin/instructors` | 강사 관리 |
| `/admin/instructors/[id]` | 강사 상세 (계약 포함) |
| `/admin/courses` | 과정 관리 |
| `/admin/courses/[id]` | 과정 상세 |
| `/admin/courses/[id]/versions/[vid]` | 교재 검수 |
| `/admin/courses/[id]/versions/[vid]/chapters/[key]` | 교재 미리보기 |
| `/admin/courses/[id]/videos/[vid]` | 영상 보기 |
| `/admin/reviews` | 검수 대기 |
| `/admin/products` | 상품 · 가격 |
| `/admin/subscriptions` | 구독 |
| `/admin/refunds` | 환불 목록 |
| `/admin/refunds/[id]` | 환불 처리 |
| `/admin/settlements` | 정산 관리 |
| `/admin/settlements/[month]` | 월 정산 |
| `/admin/settlements/items/[id]` | 강사별 정산 |
| `/admin/settlements/policies` | 배분 정책 |
| `/admin/qna` | Q&A 관리 |
| `/admin/inquiries` | 1:1 문의 목록 |
| `/admin/inquiries/[id]` | 1:1 문의 답변 |
| `/admin/notices` | 공지 목록 · 쓰기 |
| `/admin/notices/[id]` | 공지 고치기 |
| `/admin/faqs` | 자주 묻는 질문 관리 |
| `/admin/policies` | 정책 문서 |
| `/admin/policies/[kind]` | 정책 문서 버전 |
| `/admin/logs` | 기록 (운영 기록) |

이 목록에 없는 화면을 새로 그리셨다면, 짝표의 "사이트주소" 칸에 `(새 화면)` 이라고 적고 "새기능필요" 칸에 무엇인지 적어 주세요.

---

## 5. 넘길 때 확인표

태그를 붙이기 전에 하나씩 확인해 주세요.

- [ ] 작업한 것이 모두 StudyNLab/aionit-design 저장소에 커밋되어 있다
- [ ] `CHANGELOG.md` 맨 위에 이번 태그 이름과 바뀐 점(화면 · 부품 · 로고별)이 적혀 있다
- [ ] 태그 이름이 `v번호-날짜` 이고 이전 태그보다 번호가 크다 (예: `v2-2026-11-20`)
- [ ] 태그를 GitHub에 올렸다 (커밋만 올리고 태그를 빠뜨리지 않기)
- [ ] 이미 붙인 태그는 옮기거나 지우거나 다시 붙이지 않았다 (고칠 것은 다음 태그로)
- [ ] `tokens.css`(또는 `tokens.json`) 하나에 최종값이 모여 있고, 밝게 / 어둡게 값이 모두 있다
- [ ] 최종 CSS 한 벌에서 같은 대상을 두 번 정하지 않는다
- [ ] 부품 9종(버튼 · 입력칸 · 체크 · 카드 · 표 · 알림 · 머리글 · 바닥글 · 메뉴)의 상태별 HTML이 있다
- [ ] 각 부품에 기본 · hover · focus · disabled · 오류 상태가 있다 (해당 없는 것은 "없음"이라고 적기)
- [ ] 화면마다 정적 HTML 또는 1440 · 390 스크린숏이 있다
- [ ] `screens.csv`(짝표)에 모든 화면 ID와 사이트 주소가 짝지어 있다
- [ ] 빈 목록 · 오류 · 로그인 전/후 같은 다른 상태도 화면 ID로 나뉘어 있다
- [ ] 화면마다 "예시 데이터" 자리가 표시되어 있다
- [ ] 화면마다 "새 기능 필요" 자리가 표시되어 있다 (없으면 비워 두기)
- [ ] `brand/` 에는 최종 로고(밝게 · 어둡게) · 파비콘 · 앱 아이콘만 있다
- [ ] 이전 로고 · 비교 시안은 `비교시안/` 폴더에 따로 있다
- [ ] 글꼴 파일과 라이선스 파일이 함께 있고, 쓰는 굵기 목록이 있다
- [ ] `README.md` 에 들어 있는 것과 미리보기 여는 법이 적혀 있다
