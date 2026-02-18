/**
 * 뉴스 대시보드 — Cloud Functions
 *
 * [API 엔드포인트]
 *   GET    /api/keywords              → 키워드 목록 조회
 *   POST   /api/keywords              → 키워드 추가
 *   DELETE /api/keywords/:id          → 키워드 삭제
 *   GET    /api/articles?keywordId=   → 기사 목록 조회
 *
 * [스케줄러]
 *   fetchNewsScheduled               → 10분마다 모든 키워드의 RSS 수집
 */

"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const xml2js = require("xml2js");
const crypto = require("crypto");

// ── Firebase 초기화 ──────────────────────────────────────────
initializeApp();
const db = getFirestore();

// ── Google News RSS (키워드별 검색) ─────────────────────────
function makeGoogleNewsUrl(keyword) {
    const q = encodeURIComponent(keyword);
    return `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
}

// ── 한국 언론사 직접 RSS 피드 목록 ──────────────────────────
// Cloud Functions에서 접근 가능한 무료 공개 피드만 포함
const KOREAN_RSS_FEEDS = [
    { name: "연합뉴스", url: "https://www.yonhapnews.co.kr/rss/allheadlines.xml" },
    { name: "KBS 뉴스", url: "https://news.kbs.co.kr/rss/news9.xml" },
    { name: "머니투데이", url: "https://rss.mt.co.kr/mt_news_total.xml" },
    { name: "매일경제", url: "https://www.mk.co.kr/rss/30000001/" },
    { name: "ZDNet Korea", url: "https://zdnet.co.kr/rss.aspx" },
    { name: "BBC Korea", url: "https://feeds.bbci.co.uk/korean/rss.xml" },
];

// ══════════════════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════════════════

/** sha256(keywordId + "|" + url) → 중복 방지용 문서 ID */
function makeHash(keywordId, url) {
    return crypto.createHash("sha256").update(`${keywordId}|${url}`).digest("hex");
}

/** RSS XML 문자열 → 기사 배열 */
async function parseRSS(xmlText, sourceName) {
    try {
        const result = await xml2js.parseStringPromise(xmlText, { trim: true, explicitArray: false });
        const channel = result?.rss?.channel || result?.feed;
        if (!channel) return [];

        // RSS 2.0: channel.item / Atom: feed.entry
        const rawItems = channel.item || channel.entry || [];
        const items = Array.isArray(rawItems) ? rawItems : [rawItems];

        return items.map((it) => {
            const title = it.title?._ || it.title || "";
            const url = it.link?.href || it.link || it.guid?._ || it.guid || "";
            const pubStr = it.pubDate || it.published || it.updated || "";
            const publishedAt = pubStr ? new Date(pubStr).getTime() : Date.now();

            return { title: String(title).trim(), url: String(url).trim(), publishedAt, source: sourceName };
        }).filter((it) => it.url && it.title);
    } catch (e) {
        console.error(`[parseRSS] ${sourceName} 파싱 오류:`, e.message);
        return [];
    }
}

/** 단일 RSS 피드 fetch → 기사 배열 */
async function fetchFeed(feed) {
    try {
        const res = await fetch(feed.url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
            timeout: 8000,
        });
        if (!res.ok) return [];
        const text = await res.text();
        return await parseRSS(text, feed.name);
    } catch (e) {
        console.error(`[fetchFeed] ${feed.name} 오류:`, e.message);
        return [];
    }
}

/**
 * 키워드로 기사 수집 (하이브리드)
 * 1) Google News RSS 키워드 검색 (매칭률 100%)
 * 2) 한국 언론사 직접 피드 → 키워드 필터링
 * → 두 결과를 합쳐 중복 URL 제거 후 반환
 */
async function fetchByKeyword(keywordText) {
    const kw = keywordText.toLowerCase();

    // 1) Google News 키워드 검색
    const googleFetch = fetch(makeGoogleNewsUrl(keywordText), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
        timeout: 10000,
    }).then(r => r.ok ? r.text() : "").then(t => t ? parseRSS(t, "Google News") : []).catch(() => []);

    // 2) 한국 언론사 직접 피드 병렬 수집
    const directFetches = KOREAN_RSS_FEEDS.map(feed => fetchFeed(feed));

    // 병렬 실행
    const [googleArticles, ...directResults] = await Promise.all([googleFetch, ...directFetches]);

    // 직접 피드 결과 → 키워드 필터링
    const directArticles = directResults.flat().filter(
        a => a.title.toLowerCase().includes(kw)
    );

    // 합치고 중복 URL 제거
    const all = [...googleArticles, ...directArticles];
    const seen = new Set();
    const unique = all.filter(a => {
        if (seen.has(a.url)) return false;
        seen.add(a.url);
        return true;
    });

    console.log(`[fetchByKeyword] "${keywordText}" → Google:${googleArticles.length} + 직접:${directArticles.length} = 총:${unique.length}건`);
    return unique;
}

// ══════════════════════════════════════════════════════════════
// Express 앱 (API)
// ══════════════════════════════════════════════════════════════

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ── GET /api/keywords ───────────────────────────────────────
app.get("/api/keywords", async (req, res) => {
    try {
        const snap = await db.collection("keywords").orderBy("createdAt", "asc").get();
        const keywords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        res.json({ keywords });
    } catch (e) {
        console.error("[GET /keywords]", e);
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/keywords ──────────────────────────────────────
app.post("/api/keywords", async (req, res) => {
    try {
        const { text, source } = req.body;
        if (!text || !source) return res.status(400).json({ error: "text, source 필수" });

        // 중복 체크
        const dup = await db.collection("keywords")
            .where("text", "==", text)
            .where("source", "==", source)
            .limit(1).get();
        if (!dup.empty) return res.status(409).json({ error: "이미 존재하는 키워드입니다." });

        const docRef = await db.collection("keywords").add({
            text,
            source,
            createdAt: Date.now(),
        });

        const newDoc = await docRef.get();
        res.status(201).json({ id: docRef.id, ...newDoc.data() });
    } catch (e) {
        console.error("[POST /keywords]", e);
        res.status(500).json({ error: e.message });
    }
});

// ── DELETE /api/keywords/:id ────────────────────────────────
app.delete("/api/keywords/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection("keywords").doc(id).delete();

        // 연관 기사도 일괄 삭제 (배치)
        const articleSnap = await db.collection("articles").where("keywordId", "==", id).get();
        if (!articleSnap.empty) {
            const batch = db.batch();
            articleSnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }

        res.json({ success: true, deleted: articleSnap.size });
    } catch (e) {
        console.error("[DELETE /keywords/:id]", e);
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/articles?keywordId= ───────────────────────────
app.get("/api/articles", async (req, res) => {
    try {
        const { keywordId } = req.query;
        if (!keywordId) return res.status(400).json({ error: "keywordId 필수" });

        const snap = await db.collection("articles")
            .where("keywordId", "==", keywordId)
            .orderBy("publishedAt", "desc")
            .limit(50)
            .get();

        const articles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        res.json({ articles });
    } catch (e) {
        console.error("[GET /articles]", e);
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/seed (테스트용 더미 데이터 삽입) ──────────────
app.post("/api/seed", async (req, res) => {
    try {
        const kwSnap = await db.collection("keywords").limit(1).get();
        if (kwSnap.empty) return res.status(400).json({ error: "키워드를 먼저 추가하세요." });

        const kw = kwSnap.docs[0];
        const testArticles = [
            { title: `[${kw.data().text}] AI 교육 혁신 사례 분석`, url: "https://example.com/test-1" },
            { title: `[${kw.data().text}] 최신 트렌드 리포트 2025`, url: "https://example.com/test-2" },
            { title: `[${kw.data().text}] 전문가 인터뷰: 미래 전망`, url: "https://example.com/test-3" },
            { title: `[${kw.data().text}] 글로벌 시장 동향`, url: "https://example.com/test-4" },
            { title: `[${kw.data().text}] 국내 주요 뉴스 모음`, url: "https://example.com/test-5" },
        ];

        const saved = [];
        for (const a of testArticles) {
            const hash = crypto.createHash("sha256").update(`${kw.id}|${a.url}`).digest("hex");
            await db.collection("articles").doc(hash).set({
                keywordId: kw.id, keywordText: kw.data().text,
                source: "테스트 데이터", title: a.title, url: a.url,
                publishedAt: Date.now() - Math.floor(Math.random() * 3600000),
                hash, createdAt: Date.now(),
            }, { merge: true });
            saved.push(a.title);
        }

        res.json({ success: true, keywordText: kw.data().text, saved });
    } catch (e) {
        console.error("[POST /api/seed]", e);
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/fetch-now (즉시 RSS 수집 트리거) ───────────────
app.post("/api/fetch-now", async (req, res) => {
    try {
        const kwSnap = await db.collection("keywords").get();
        if (kwSnap.empty) return res.status(400).json({ error: "키워드를 먼저 추가하세요." });

        const keywords = kwSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        let totalSaved = 0;
        const results = [];

        // 키워드별로 Google News RSS 직접 검색
        for (const kw of keywords) {
            const articles = await fetchByKeyword(kw.text);
            if (articles.length === 0) {
                results.push({ keyword: kw.text, saved: 0 });
                continue;
            }

            const batch = db.batch();
            let count = 0;
            for (const article of articles.slice(0, 499)) {
                const hash = makeHash(kw.id, article.url);
                batch.set(db.collection("articles").doc(hash), {
                    keywordId: kw.id, keywordText: kw.text,
                    source: article.source, title: article.title, url: article.url,
                    publishedAt: article.publishedAt, hash, createdAt: Date.now(),
                }, { merge: true });
                count++;
            }
            await batch.commit();
            totalSaved += count;
            results.push({ keyword: kw.text, saved: count });
        }

        res.json({ success: true, totalSaved, results });
    } catch (e) {
        console.error("[POST /api/fetch-now]", e);
        res.status(500).json({ error: e.message });
    }
});

// Cloud Function으로 export
exports.api = onRequest({ region: "us-central1" }, app);

// ══════════════════════════════════════════════════════════════
// 스케줄러 — 6시간마다 RSS 수집
// ══════════════════════════════════════════════════════════════

exports.fetchNewsScheduled = onSchedule(
    { schedule: "every 6 hours", region: "us-central1" },
    async () => {
        console.log("[fetchNewsScheduled] 시작:", new Date().toISOString());

        // 1) 모든 키워드 조회
        const kwSnap = await db.collection("keywords").get();
        if (kwSnap.empty) {
            console.log("[fetchNewsScheduled] 키워드 없음, 종료");
            return;
        }

        const keywords = kwSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // 2) 키워드별 Google News RSS 직접 검색 → Firestore upsert
        let totalSaved = 0;

        for (const kw of keywords) {
            const articles = await fetchByKeyword(kw.text);
            if (articles.length === 0) {
                console.log(`[fetchNewsScheduled] "${kw.text}" → 0건`);
                continue;
            }

            const batch = db.batch();
            let batchCount = 0;

            for (const article of articles) {
                const hash = makeHash(kw.id, article.url);
                const ref = db.collection("articles").doc(hash);

                batch.set(ref, {
                    keywordId: kw.id,
                    keywordText: kw.text,
                    source: article.source,
                    title: article.title,
                    url: article.url,
                    publishedAt: article.publishedAt,
                    hash,
                    createdAt: Date.now(),
                }, { merge: true });

                batchCount++;
                if (batchCount === 499) break;
            }

            await batch.commit();
            totalSaved += batchCount;
            console.log(`[fetchNewsScheduled] "${kw.text}" → ${batchCount}건 저장`);
        }

        console.log(`[fetchNewsScheduled] 완료. 총 저장: ${totalSaved}건`);
    }
);
