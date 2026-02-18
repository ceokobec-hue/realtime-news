/**
 * 테스트용 더미 기사 데이터를 Firestore에 직접 삽입하는 스크립트
 * 사용법: node seed.js
 */
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp({ projectId: 'aiacademy-36b79' });
const db = admin.firestore();

async function seed() {
    // 1) 첫 번째 키워드 조회
    const kwSnap = await db.collection('keywords').limit(1).get();
    if (kwSnap.empty) {
        console.log('❌ 키워드가 없습니다. 먼저 사이트에서 키워드를 추가하세요.');
        process.exit(0);
    }

    const kw = kwSnap.docs[0];
    console.log(`✅ 키워드 발견: "${kw.data().text}" (${kw.id})`);

    // 2) 테스트 기사 5개 삽입
    const testArticles = [
        { title: `[${kw.data().text}] AI 교육 혁신 사례 분석`, url: 'https://example.com/test-1' },
        { title: `[${kw.data().text}] 최신 트렌드 리포트 2025`, url: 'https://example.com/test-2' },
        { title: `[${kw.data().text}] 전문가 인터뷰: 미래 전망`, url: 'https://example.com/test-3' },
        { title: `[${kw.data().text}] 글로벌 시장 동향`, url: 'https://example.com/test-4' },
        { title: `[${kw.data().text}] 국내 주요 뉴스 모음`, url: 'https://example.com/test-5' },
    ];

    for (const a of testArticles) {
        const hash = crypto.createHash('sha256').update(`${kw.id}|${a.url}`).digest('hex');
        await db.collection('articles').doc(hash).set({
            keywordId: kw.id,
            keywordText: kw.data().text,
            source: '테스트 데이터',
            title: a.title,
            url: a.url,
            publishedAt: Date.now() - Math.floor(Math.random() * 3600000),
            hash,
            createdAt: Date.now(),
        }, { merge: true });
        console.log(`  📰 저장: ${a.title}`);
    }

    console.log('\n🎉 완료! https://realtime-news.web.app 에서 확인하세요.');
    process.exit(0);
}

seed().catch(e => {
    console.error('❌ 오류:', e.message);
    process.exit(1);
});
