const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const parser = new Parser();

function makeHash(keywordId, url) {
  return crypto.createHash("sha256").update(`${keywordId}|${url}`).digest("hex");
}

// ===== API: keywords =====
app.get("/keywords", async (req, res) => {
  const snap = await db.collection("keywords").orderBy("createdAt", "desc").get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post("/keywords", async (req, res) => {
  const { text, source = "rss" } = req.body || {};
  const t = (text || "").trim();
  if (!t) return res.status(400).json({ error: "text is required" });

  const dup = await db.collection("keywords")
    .where("text", "==", t)
    .where("source", "==", source)
    .limit(1)
    .get();

  if (!dup.empty) return res.status(409).json({ error: "keyword already exists" });

  const ref = await db.collection("keywords").add({
    text: t,
    source,
    createdAt: Date.now()
  });

  res.json({ id: ref.id });
});

app.delete("/keywords/:id", async (req, res) => {
  await db.collection("keywords").doc(req.params.id).delete();
  res.json({ ok: true });
});

// ===== API: articles =====
app.get("/articles", async (req, res) => {
  const { keywordId, limit = "30" } = req.query;
  if (!keywordId) return res.status(400).json({ error: "keywordId is required" });

  const lim = Math.max(1, Math.min(100, Number(limit) || 30));
  const snap = await db.collection("articles")
    .where("keywordId", "==", keywordId)
    .orderBy("publishedAt", "desc")
    .limit(lim)
    .get();

  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

exports.api = functions.https.onRequest(app);

// ===== RSS Sources (MVP) =====
const RSS_SOURCES = [
  // 대표님이 공식 RSS 주소를 여기에 추가하면 10분 자동 수집이 돌아갑니다.
  // 예: "https://example.com/rss"
];

async function fetchRssAndStore(keywordDoc) {
  const keywordId = keywordDoc.id;
  const { text: keywordText, source } = keywordDoc.data();

  if (source !== "rss") return;
  if (!RSS_SOURCES.length) return;

  for (const rssUrl of RSS_SOURCES) {
    let feed;
    try {
      feed = await parser.parseURL(rssUrl);
    } catch (e) {
      console.error("RSS parse failed:", rssUrl, e.message);
      continue;
    }

    const items = (feed.items || []).slice(0, 50);
    for (const it of items) {
      const title = (it.title || "").trim();
      const url = (it.link || "").trim();
      if (!title || !url) continue;

      if (!title.toLowerCase().includes(String(keywordText).toLowerCase())) continue;

      const publishedAt = it.isoDate ? new Date(it.isoDate).getTime() : Date.now();
      const hash = makeHash(keywordId, url);

      const dup = await db.collection("articles").where("hash", "==", hash).limit(1).get();
      if (!dup.empty) continue;

      await db.collection("articles").add({
        keywordId,
        keywordText,
        source: "rss",
        title,
        url,
        publishedAt,
        hash,
        createdAt: Date.now()
      });
    }
  }
}

exports.fetchNewsScheduled = functions.pubsub
  .schedule("every 10 minutes")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const snap = await db.collection("keywords").get();
    for (const doc of snap.docs) await fetchRssAndStore(doc);
    return null;
  });
