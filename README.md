# 이벤트플러스 (event-plus)

행사 공간 사진을 업로드하면 AI가 사진 속 임시 설치물(사람, 의자, 테이블, 배너 등)을
탐지하고, 사용자가 분류를 검토·수정한 뒤, 해당 물품이 제거된 빈 공간 이미지를
생성해주는 1페이지 MVP 웹앱입니다. 생성된 빈 공간 위에 원하는 구조물을 배치해
가상 시뮬레이션 이미지도 만들 수 있습니다.

## 기술 스택

- Next.js (App Router) + TypeScript + Tailwind CSS
- 하이브리드 객체 탐지:
  - **YOLOX-S** (ONNX, Apache-2.0) — 브라우저에서 onnxruntime-web으로 실행.
    사람·의자·테이블·모니터 등 COCO 클래스를 인스턴스 단위(개별 박스)로 탐지
  - **GPT-4o** — 배너·부스·포토월·무대 등 행사 도메인 물체 탐지와 고정/가변 분류
  - 두 결과를 IoU·포함관계 기준으로 병합 (GPT가 무리를 뭉뚱그린 박스는 제거)
- OpenAI API — `gpt-image-1` (이미지 편집/인페인팅), `gpt-4o` (배치 지시 해석)
- DB 없음 — 세션 상태(React state)로만 동작

YOLOX 모델(`public/models/yolox_s.onnx`, ~36MB)은 저장소에 포함되어 있으며
[Megvii YOLOX 릴리스](https://github.com/Megvii-BaseDetection/YOLOX/releases)에서
받은 것입니다. onnxruntime-web의 wasm 런타임은 빌드 시
`scripts/copy-ort-wasm.mjs`가 `public/ort/`로 복사합니다.

## 실행 방법

1. 의존성 설치

   ```bash
   npm install
   ```

2. 환경변수 설정 — 프로젝트 루트에 `.env.local` 파일을 만들고 OpenAI API 키를 넣습니다.

   ```
   OPENAI_API_KEY=sk-...
   ```

3. 개발 서버 실행

   ```bash
   npm run dev
   ```

4. 브라우저에서 `http://localhost:3000` 접속

## 사용 흐름

1. 행사 공간 사진을 드래그앤드롭 또는 클릭으로 업로드
2. **분석하기** 클릭 → GPT가 물체를 탐지해 bbox 오버레이로 표시
   - 빨강: 제거 대상 / 파랑: 보존 대상 / 노랑: 확인 필요
3. 목록에서 분류 배지를 클릭해 제거 ↔ 보존 ↔ 확인 필요 토글
   (확인 필요 상태는 제거되지 않음)
4. **빈 공간 생성** 클릭 → 제거 대상 영역을 마스크로 만들어 OpenAI 이미지
   편집 API 호출
5. Before/After 슬라이더로 비교, 결과 이미지 다운로드
6. **구조물 배치하기** — 빈 공간 이미지 위에 구조물(의자/테이블/부스/무대/배너)을
   버튼으로 추가하고 드래그로 이동, 위쪽 핸들로 회전, 우하단 핸들로 크기 조절
7. **최종 배치하기** 클릭 → 배치한 콜라주를 gpt-image-1이 공간의 원근·조명에
   맞는 실사로 재렌더링. 결과에서 이어서 더 배치할 수도 있음

## API

- `POST /api/analyze` — `{ image: dataURL }` → `{ objects: [{ id, label, classification, bbox, confidence }] }` (bbox는 0~1 정규화 `[x, y, w, h]`)
- `POST /api/generate` — `{ image: dataURL, boxes: [[x,y,w,h], ...] }` → `{ resultImage: dataURL }`
- `POST /api/place` — `{ image: 스프라이트가 합성된 콜라주 dataURL }` → `{ resultImage: dataURL }` (콜라주 속 구조물을 실사로 재렌더링)

구조물 스프라이트(`public/sprites/*.png`)는 `node scripts/generate-sprites.mjs`로
gpt-image-1을 통해 재생성할 수 있습니다 (이미 있는 파일은 건너뜀).

## 배포 (Vercel)

1. Vercel 대시보드에서 이 GitHub 저장소(`jsulim/event-plus`)를 import
2. 프로젝트 설정 → Environment Variables에 `OPENAI_API_KEY` 등록
3. `main` 브랜치 push 시 자동 배포

## 참고

- 사용자가 GPT 분류를 수정한 이력은 "빈 공간 생성" 시점에 브라우저 콘솔에
  `[correction-log]`로 출력됩니다 (추후 파인튜닝 데이터 수집용).
- `gpt-image-1` 사용을 위해 OpenAI 조직 인증(verification)이 필요할 수 있습니다.
