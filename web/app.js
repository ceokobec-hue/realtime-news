/**
 * 뉴스 대시보드 — app.js
 * 컴포넌트: TopStory · KeywordSection · NewsRow · DuplicateCluster · SummaryTooltip · TagBadge
 */

"use strict";

// ══════════════════════════════════════════════════════════════
// 1) 상태
// ══════════════════════════════════════════════════════════════
let keywords = [];   // [{ id, text, source }]
let articlesMap = {};   // { keywordId: [article, ...] }

// ══════════════════════════════════════════════════════════════
// 2) API Base
// ══════════════════════════════════════════════════════════════
const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:5001/realtime-news/us-central1/api"
    : "/api";

// ══════════════════════════════════════════════════════════════
// 3) DOM refs
// ══════════════════════════════════════════════════════════════
const $keywordInput = document.getElementById("keywordInput");
const $sourceSelect = document.getElementById("sourceSelect");
const $addBtn = document.getElementById("addBtn");
const $fetchNowBtn = document.getElementById("fetchNowBtn");
const $refreshBtn = document.getElementById("refreshBtn");
const $refreshIcon = document.getElementById("refreshIcon");
const $chips = document.getElementById("keywordChips");
const $topStory = document.getElementById("topStory");
const $newsSections = document.getElementById("newsSections");
const $emptyState = document.getElementById("emptyState");
const $lastUpdated = document.getElementById("lastUpdated");
const $statusLabel = document.getElementById("statusLabel");
const $tooltip = document.getElementById("tooltip");
const $ttTitle = document.getElementById("ttTitle");
const $ttSummary = document.getElementById("ttSummary");
const $ttSource = document.getElementById("ttSource");
const $ttTime = document.getElementById("ttTime");
const $toast = document.getElementById("toast");

// ══════════════════════════════════════════════════════════════
// 4) 유틸
// ══════════════════════════════════════════════════════════════
function nowKST() {
    return new Date().toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit"
    });
}

function fmtDate(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
    });
}

function showToast(msg, type = "success") {
    $toast.textContent = msg;
    $toast.className = `show ${type}`;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { $toast.className = ""; }, 3000);
}

function setStatus(label) { $statusLabel.textContent = label; }

// ══════════════════════════════════════════════════════════════
// 5) API 호출
// ══════════════════════════════════════════════════════════════
async function apiGetKeywords() {
    const res = await fetch(`${API_BASE}/keywords`);
    if (!res.ok) throw new Error(`키워드 조회 실패 (${res.status})`);
    return (await res.json()).keywords ?? [];
}

async function apiAddKeyword(text, source) {
    const res = await fetch(`${API_BASE}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source }),
    });
    if (!res.ok) throw new Error(`키워드 추가 실패 (${res.status})`);
    return await res.json();
}

async function apiDeleteKeyword(id) {
    const res = await fetch(`${API_BASE}/keywords/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`키워드 삭제 실패 (${res.status})`);
}

async function apiGetArticles(keywordId) {
    const res = await fetch(`${API_BASE}/articles?keywordId=${encodeURIComponent(keywordId)}`);
    if (!res.ok) throw new Error(`기사 조회 실패 (${res.status})`);
    return (await res.json()).articles ?? [];
}

async function apiFetchNow() {
    const res = await fetch(`${API_BASE}/fetch-now`, { method: "POST" });
    if (!res.ok) throw new Error(`수집 실패 (${res.status})`);
    return await res.json();
}

// ══════════════════════════════════════════════════════════════
// 6) TagBadge — 제목 기반 자동 태그
// ══════════════════════════════════════════════════════════════
const TAG_RULES = [
    { pattern: /속보|긴급|breaking/i, cls: "tag-breaking", label: "속보", barCls: "bar-red" },
    { pattern: /논란|갈등|충돌|비판|반발/i, cls: "tag-issue", label: "논란", barCls: "bar-indigo" },
    { pattern: /분석|전망|리포트|심층|해설/i, cls: "tag-analysis", label: "분석", barCls: "bar-indigo" },
    { pattern: /업데이트|수정|정정|추가/i, cls: "tag-update", label: "업데이트", barCls: "bar-gray" },
    { pattern: /급등|급락|폭등|폭락|최고|최저/i, cls: "tag-hot", label: "이슈", barCls: "bar-amber" },
];

function detectTags(title) {
    const matched = [];
    for (const rule of TAG_RULES) {
        if (rule.pattern.test(title)) matched.push(rule);
        if (matched.length >= 2) break;
    }
    return matched;
}

function renderTagBadges(tags) {
    if (!tags.length) return "";
    return tags.map(t => `<span class="tag ${t.cls}">${t.label}</span>`).join("");
}

function getBarClass(tags) {
    return tags.length ? tags[0].barCls : "";
}

// ══════════════════════════════════════════════════════════════
// 7) DuplicateCluster — 제목 유사도 기반 그룹화
// ══════════════════════════════════════════════════════════════
function tokenize(title) {
    return title.replace(/[^\w가-힣]/g, " ").split(/\s+/).filter(t => t.length > 1);
}

function similarity(a, b) {
    const ta = new Set(tokenize(a));
    const tb = new Set(tokenize(b));
    const inter = [...ta].filter(t => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size;
    return union === 0 ? 0 : inter / union;
}

function clusterArticles(articles) {
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < articles.length; i++) {
        if (used.has(i)) continue;
        const group = [articles[i]];
        used.add(i);
        for (let j = i + 1; j < articles.length; j++) {
            if (used.has(j)) continue;
            if (similarity(articles[i].title, articles[j].title) >= 0.45) {
                group.push(articles[j]);
                used.add(j);
            }
        }
        clusters.push(group);
    }
    return clusters;
}

// ══════════════════════════════════════════════════════════════
// 8) NewsRow 컴포넌트
// ══════════════════════════════════════════════════════════════
function createNewsRow(article, isCompact = false) {
    const tags = detectTags(article.title);
    const barCls = getBarClass(tags);
    const tagsHtml = renderTagBadges(tags);

    const li = document.createElement("li");
    li.className = `news-row${isCompact ? " compact" : ""}`;
    li.innerHTML = `
      <div class="news-bar ${barCls}"></div>
      <div class="news-body">
        <a class="news-title" href="${article.url}" target="_blank" rel="noopener noreferrer">${article.title}</a>
        <div class="news-meta">
          <span class="news-source">${article.source}</span>
          <span class="news-time">${fmtDate(article.publishedAt)}</span>
        </div>
      </div>
      ${!isCompact ? `<div class="news-right"><div class="tags">${tagsHtml}</div></div>` : ""}
    `;

    // 링크 클릭이 row 이벤트와 충돌 방지
    li.querySelector(".news-title").addEventListener("click", e => e.stopPropagation());

    // Hover Tooltip
    if (!isCompact) {
        li.addEventListener("mouseenter", e => showTooltip(article, e));
        li.addEventListener("mousemove", e => moveTooltip(e));
        li.addEventListener("mouseleave", hideTooltip);
    }

    return li;
}

// ══════════════════════════════════════════════════════════════
// 9) SummaryTooltip
// ══════════════════════════════════════════════════════════════
let tooltipTimer = null;

function showTooltip(article, e) {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
        $ttTitle.textContent = article.title;
        $ttSummary.textContent = article.description
            ? article.description.slice(0, 120) + (article.description.length > 120 ? "…" : "")
            : "기사 원문에서 내용을 확인하세요.";
        $ttSource.textContent = article.source;
        $ttTime.textContent = fmtDate(article.publishedAt);
        moveTooltip(e);
        $tooltip.classList.add("visible");
    }, 300);
}

function moveTooltip(e) {
    const tw = $tooltip.offsetWidth || 320;
    const th = $tooltip.offsetHeight || 120;
    let x = e.clientX + 16;
    let y = e.clientY + 16;
    if (x + tw > window.innerWidth - 12) x = e.clientX - tw - 12;
    if (y + th > window.innerHeight - 12) y = e.clientY - th - 12;
    $tooltip.style.left = x + "px";
    $tooltip.style.top = y + "px";
}

function hideTooltip() {
    clearTimeout(tooltipTimer);
    $tooltip.classList.remove("visible");
}

// ══════════════════════════════════════════════════════════════
// 10) DuplicateCluster 컴포넌트
// ══════════════════════════════════════════════════════════════
function createCluster(cluster) {
    const frag = document.createDocumentFragment();
    const [main, ...subs] = cluster;

    // 대표 기사
    frag.appendChild(createNewsRow(main, false));

    if (subs.length > 0) {
        // 토글 행
        const toggleRow = document.createElement("div");
        toggleRow.className = "dup-toggle-row";
        const btn = document.createElement("button");
        btn.className = "dup-toggle-btn";
        btn.innerHTML = `<span class="dup-arrow">▼</span> 유사 기사 ${subs.length}개 펼치기`;
        toggleRow.appendChild(btn);
        frag.appendChild(toggleRow);

        // 하위 기사 목록
        const subList = document.createElement("ul");
        subList.className = "news-list dup-sub-list";
        subs.forEach(a => subList.appendChild(createNewsRow(a, true)));
        frag.appendChild(subList);

        // 토글 이벤트
        btn.addEventListener("click", () => {
            const arrow = btn.querySelector(".dup-arrow");
            const isOpen = subList.classList.toggle("open");
            arrow.classList.toggle("open", isOpen);
            btn.innerHTML = `<span class="dup-arrow ${isOpen ? "open" : ""}">▼</span> 유사 기사 ${subs.length}개 ${isOpen ? "접기" : "펼치기"}`;
        });
    }

    return frag;
}

// ══════════════════════════════════════════════════════════════
// 11) TopStory 컴포넌트
// ══════════════════════════════════════════════════════════════
function renderTopStory(article) {
    if (!article) { $topStory.innerHTML = ""; return; }
    const tags = detectTags(article.title);
    const tagsHtml = renderTagBadges(tags);

    $topStory.innerHTML = `
      <a class="top-story-card" href="${article.url}" target="_blank" rel="noopener noreferrer">
        <div class="top-story-header">
          <span class="top-badge">⭐ Top Story</span>
          ${tagsHtml}
        </div>
        <h2>${article.title}</h2>
        <div class="top-story-meta">
          <span style="font-weight:600;color:var(--primary)">${article.source}</span>
          <span>${fmtDate(article.publishedAt)}</span>
          ${article.keywordText ? `<span style="color:var(--text-dim)">키워드: ${article.keywordText}</span>` : ""}
        </div>
      </a>
    `;
}

// ══════════════════════════════════════════════════════════════
// 12) KeywordSection 컴포넌트
// ══════════════════════════════════════════════════════════════
function renderKeywordSection(kw, articles) {
    const section = document.createElement("div");
    section.className = "keyword-section";
    section.dataset.kwId = kw.id;

    // 섹션 헤더
    const header = document.createElement("div");
    header.className = "section-header";
    header.innerHTML = `
      <div class="section-header-left">
        <span class="section-kw-name">${kw.text}</span>
        <span class="section-count">${articles.length}건</span>
      </div>
      <div class="section-header-right">
        <button class="section-toggle-btn" data-collapsed="false">접기 ▲</button>
        <select class="sort-select" data-kwid="${kw.id}">
          <option value="date">최신순</option>
          <option value="title">제목순</option>
          <option value="source">소스순</option>
        </select>
      </div>
    `;
    section.appendChild(header);

    // 기사 목록 컨테이너
    const listWrap = document.createElement("div");
    listWrap.className = "section-list-wrap";
    section.appendChild(listWrap);

    // 기사 렌더
    function renderList(sortedArticles) {
        listWrap.innerHTML = "";
        if (!sortedArticles.length) {
            listWrap.innerHTML = `<div style="padding:20px 16px;font-size:13px;color:var(--text-dim)">기사가 없습니다.</div>`;
            return;
        }
        const clusters = clusterArticles(sortedArticles);
        const ul = document.createElement("ul");
        ul.className = "news-list";
        clusters.forEach(cluster => ul.appendChild(createCluster(cluster)));
        listWrap.appendChild(ul);
    }

    function getSorted(order) {
        const arr = [...articles];
        if (order === "date") arr.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
        if (order === "title") arr.sort((a, b) => a.title.localeCompare(b.title, "ko"));
        if (order === "source") arr.sort((a, b) => a.source.localeCompare(b.source, "ko"));
        return arr;
    }

    renderList(getSorted("date"));

    // 접기/펼치기
    const toggleBtn = header.querySelector(".section-toggle-btn");
    toggleBtn.addEventListener("click", () => {
        const collapsed = toggleBtn.dataset.collapsed === "true";
        toggleBtn.dataset.collapsed = String(!collapsed);
        listWrap.style.display = collapsed ? "" : "none";
        toggleBtn.textContent = collapsed ? "접기 ▲" : "펼치기 ▼";
    });

    // 정렬
    const sortSel = header.querySelector(".sort-select");
    sortSel.addEventListener("change", () => renderList(getSorted(sortSel.value)));

    return section;
}

// ══════════════════════════════════════════════════════════════
// 13) 스켈레톤 로더
// ══════════════════════════════════════════════════════════════
function renderSkeleton(count = 6) {
    $newsSections.innerHTML = "";
    $topStory.innerHTML = "";
    const ul = document.createElement("ul");
    ul.className = "news-list";
    for (let i = 0; i < count; i++) {
        const li = document.createElement("li");
        li.className = "skeleton-row";
        li.innerHTML = `
          <div class="skeleton sk-bar" style="height:48px;"></div>
          <div class="sk-body">
            <div class="skeleton sk-title"></div>
            <div class="skeleton sk-meta"></div>
          </div>
        `;
        ul.appendChild(li);
    }
    $newsSections.appendChild(ul);
    $emptyState.style.display = "none";
}

// ══════════════════════════════════════════════════════════════
// 14) 전체 렌더
// ══════════════════════════════════════════════════════════════
function renderChips() {
    $chips.innerHTML = "";
    const MAX_VISIBLE = 8;
    const visible = keywords.slice(0, MAX_VISIBLE);
    const hidden = keywords.slice(MAX_VISIBLE);

    visible.forEach(k => {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `
          <span>${k.text}</span>
          <span class="chip-source">${k.source}</span>
          <button class="x" title="삭제" aria-label="삭제">×</button>
        `;
        chip.querySelector(".x").addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                await apiDeleteKeyword(k.id);
                keywords = keywords.filter(x => x.id !== k.id);
                delete articlesMap[k.id];
                renderAll();
            } catch (err) { showToast(err.message, "error"); }
        });
        $chips.appendChild(chip);
    });

    if (hidden.length > 0) {
        const more = document.createElement("span");
        more.className = "chip-more";
        more.textContent = `+${hidden.length} 더보기`;
        $chips.appendChild(more);
    }
}

function renderAll() {
    renderChips();

    const allArticles = Object.entries(articlesMap).flatMap(([kwId, arts]) => {
        const kw = keywords.find(k => k.id === kwId);
        return arts.map(a => ({ ...a, keywordText: kw?.text }));
    });

    if (!keywords.length) {
        $topStory.innerHTML = "";
        $newsSections.innerHTML = "";
        $emptyState.style.display = "block";
        return;
    }

    $emptyState.style.display = "none";

    // Top Story: 전체 기사 중 가장 최신
    const topArticle = allArticles.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))[0];
    renderTopStory(topArticle || null);

    // 키워드별 섹션
    $newsSections.innerHTML = "";
    keywords.forEach(kw => {
        const arts = articlesMap[kw.id] || [];
        const section = renderKeywordSection(kw, arts);
        $newsSections.appendChild(section);
    });
}

// ══════════════════════════════════════════════════════════════
// 15) 데이터 로드
// ══════════════════════════════════════════════════════════════
async function loadAllArticles() {
    setStatus("수집 중…");
    renderSkeleton(6);

    await Promise.all(keywords.map(async kw => {
        try {
            articlesMap[kw.id] = await apiGetArticles(kw.id);
        } catch {
            articlesMap[kw.id] = [];
        }
    }));

    $lastUpdated.textContent = nowKST();
    setStatus("대기 중");
    renderAll();
}

async function loadKeywords() {
    try {
        keywords = await apiGetKeywords();
        await loadAllArticles();
    } catch (err) {
        $emptyState.style.display = "block";
        $emptyState.innerHTML = `
          <div class="icon">⚠️</div>
          <h3>연결 오류</h3>
          <p>${err.message}</p>
          <button class="retry-btn" onclick="init()">재시도</button>
        `;
    }
}

// ══════════════════════════════════════════════════════════════
// 16) 이벤트
// ══════════════════════════════════════════════════════════════

// 키워드 추가
$addBtn.addEventListener("click", async () => {
    const text = $keywordInput.value.trim();
    const source = $sourceSelect.value;
    if (!text) return;
    if (keywords.some(k => k.text === text)) {
        showToast("이미 같은 키워드가 있습니다.", "error"); return;
    }
    try {
        $addBtn.disabled = true;
        const newKw = await apiAddKeyword(text, source);
        keywords.push(newKw);
        articlesMap[newKw.id] = [];
        $keywordInput.value = "";
        renderChips();
        // 새 키워드 기사 즉시 로드
        articlesMap[newKw.id] = await apiGetArticles(newKw.id);
        $lastUpdated.textContent = nowKST();
        renderAll();
        showToast(`"${text}" 키워드 추가 완료`);
    } catch (err) { showToast(err.message, "error"); }
    finally { $addBtn.disabled = false; }
});

$keywordInput.addEventListener("keydown", e => { if (e.key === "Enter") $addBtn.click(); });

// 즉시 검색
$fetchNowBtn.addEventListener("click", async () => {
    $fetchNowBtn.disabled = true;
    $fetchNowBtn.classList.add("loading");
    $fetchNowBtn.querySelector(".btn-icon").textContent = "↻";
    setStatus("수집 중…");
    try {
        const result = await apiFetchNow();
        const total = result.totalSaved ?? 0;
        showToast(`✅ ${total}건 수집 완료!`);
        await loadAllArticles();
    } catch (err) { showToast(`수집 실패: ${err.message}`, "error"); }
    finally {
        $fetchNowBtn.disabled = false;
        $fetchNowBtn.classList.remove("loading");
        $fetchNowBtn.querySelector(".btn-icon").textContent = "⚡";
        setStatus("대기 중");
    }
});

// 새로고침
$refreshBtn.addEventListener("click", async () => {
    $refreshIcon.classList.add("spinning");
    try { await loadAllArticles(); }
    finally { setTimeout(() => $refreshIcon.classList.remove("spinning"), 600); }
});

// ══════════════════════════════════════════════════════════════
// 17) 초기화
// ══════════════════════════════════════════════════════════════
async function init() {
    $emptyState.style.display = "block";
    await loadKeywords();
}

init();

// 60초마다 자동 새로고침 (UI만)
setInterval(() => {
    if (keywords.length) loadAllArticles();
}, 60 * 1000);
