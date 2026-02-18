# Firestore 스키마 — 뉴스 대시보드

## 컬렉션 구조

```
Firestore
├── keywords/          ← 사용자가 등록한 키워드 목록
│   └── {keywordId}
└── articles/          ← 수집된 기사 (10분마다 갱신)
    └── {articleId}    ← 문서 ID = hash 값 (중복 방지)
```

- **keywords**: 프론트에서 키워드를 추가/삭제할 때 쓰고 읽는다.
- **articles**: 백엔드(Cloud Function)가 10분마다 RSS를 수집해 저장한다. 프론트는 `keywordId` 필드로 필터링해 조회한다.
- **중복 방지**: `hash = sha256(keywordId + "|" + url)` 을 문서 ID로 사용하므로, 같은 기사를 다시 저장하면 덮어쓰기(upsert)가 되어 자동 중복 제거된다.

---

## keywords 컬렉션

### 필드 정의

| 필드명      | 타입     | 설명                          |
|-------------|----------|-------------------------------|
| `text`      | string   | 키워드 텍스트 (예: "AI 교육") |
| `source`    | string   | 수집 소스 (예: "rss", "all")  |
| `createdAt` | number   | 생성 시각 (Unix ms)           |

### 예시 문서 2개

```json
// keywords/kw_a1b2c3d4
{
  "text": "AI 교육",
  "source": "rss",
  "createdAt": 1739876400000
}

// keywords/kw_e5f6g7h8
{
  "text": "ChatGPT",
  "source": "all",
  "createdAt": 1739876520000
}
```

---

## articles 컬렉션

### 필드 정의

| 필드명          | 타입     | 설명                                          |
|-----------------|----------|-----------------------------------------------|
| `keywordId`     | string   | 연결된 keywords 문서 ID                       |
| `keywordText`   | string   | 키워드 텍스트 (조회 편의용 비정규화)          |
| `source`        | string   | 기사 출처 피드명 (예: "연합뉴스", "ZDNet")    |
| `title`         | string   | 기사 제목                                     |
| `url`           | string   | 기사 원문 URL                                 |
| `publishedAt`   | number   | 기사 발행 시각 (Unix ms)                      |
| `hash`          | string   | sha256(keywordId + "\|" + url) — 문서 ID와 동일 |
| `createdAt`     | number   | Firestore 저장 시각 (Unix ms)                 |

### 예시 문서 2개

```json
// articles/3f7a2c1e9b4d6f0a8e2c5b7d1f3a9e6c  (hash값이 문서 ID)
{
  "keywordId": "kw_a1b2c3d4",
  "keywordText": "AI 교육",
  "source": "연합뉴스",
  "title": "교육부, AI 디지털 교과서 2025년 전면 도입 확정",
  "url": "https://www.yonhapnews.co.kr/example/article-001",
  "publishedAt": 1739872800000,
  "hash": "3f7a2c1e9b4d6f0a8e2c5b7d1f3a9e6c",
  "createdAt": 1739876460000
}

// articles/9d1b4e7f2a5c8e3f6b0d9a2c5e8f1b4d
{
  "keywordId": "kw_e5f6g7h8",
  "keywordText": "ChatGPT",
  "source": "ZDNet Korea",
  "title": "ChatGPT, 기업용 플랜에 실시간 검색 기능 추가",
  "url": "https://zdnet.co.kr/example/article-002",
  "publishedAt": 1739869200000,
  "hash": "9d1b4e7f2a5c8e3f6b0d9a2c5e8f1b4d",
  "createdAt": 1739876520000
}
```

---

## 프론트 조회 쿼리 패턴

```js
// 특정 키워드의 기사를 최신순으로 50개 조회
db.collection("articles")
  .where("keywordId", "==", "kw_a1b2c3d4")
  .orderBy("publishedAt", "desc")
  .limit(50)
  .get();
```

## 백엔드 저장 패턴 (upsert)

```js
// hash를 문서 ID로 사용 → set()으로 중복 자동 처리
const hash = sha256(keywordId + "|" + url);
db.collection("articles").doc(hash).set({
  keywordId, keywordText, source, title, url,
  publishedAt, hash,
  createdAt: Date.now(),
}, { merge: true });
```

---

## 권장 인덱스

| 컬렉션   | 필드 1      | 필드 2        | 순서  |
|----------|-------------|---------------|-------|
| articles | keywordId   | publishedAt   | DESC  |
| articles | keywordId   | createdAt     | DESC  |
