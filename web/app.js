// ===== 1) 상태(state) =====
let keywords = [];              // { id, text, source }
let activeKeywordId = null;

// ===== 2) DOM =====
const $keywordInput = document.getElementById("keywordInput");
const $sourceSelect = document.getElementById("sourceSelect");
const $addBtn = document.getElementById("addBtn");
const $chips = document.getElementById("keywordChips");
const $articles = document.getElementById("articles");
const $emptyState = document.getElementById("emptyState");
const $activeLabel = document.getElementById("activeKeywordLabel");
const $lastUpdated = document.getElementById("lastUpdated");

// ===== 3) 유틸 =====
function nowKST() {
    const d = new Date();
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}
function uid() {
    return Math.random().toString(36).slice(2, 10);
}

// ===== 4) 렌더 =====
function renderChips() {
    $chips.innerHTML = "";
    keywords.forEach(k => {
        const chip = document.createElement("div");
        chip.className = "chip" + (k.id === activeKeywordId ? " active" : "");
        chip.innerHTML = `
      <span>${k.text}</span>
      <small style="color:#666">(${k.source})</small>
      <button class="x" title="삭제" aria-label="삭제">×</button>
    `;

        chip.addEventListener("click", (e) => {
            // X 버튼 클릭은 삭제로 처리
            if (e.target && e.target.classList.contains("x")) return;
            activeKeywordId = k.id;
            renderAll();
            loadArticles(); // 키워드 선택하면 기사 로드
        });

        chip.querySelector(".x").addEventListener("click", () => {
            keywords = keywords.filter(x => x.id !== k.id);
            if (activeKeywordId === k.id) activeKeywordId = keywords[0]?.id ?? null;
            renderAll();
            loadArticles();
        });

        $chips.appendChild(chip);
    });
}

function renderMeta() {
    const active = keywords.find(k => k.id === activeKeywordId);
    $activeLabel.textContent = active ? `${active.text} / ${active.source}` : "없음";
}

function renderArticles(items) {
    $articles.innerHTML = "";

    if (!activeKeywordId) {
        $emptyState.style.display = "block";
        return;
    }

    if (!items || items.length === 0) {
        $emptyState.style.display = "block";
        $emptyState.textContent = "기사가 없습니다. (지금은 더미 데이터/연결 전 단계입니다)";
        return;
    }

    $emptyState.style.display = "none";

    items.forEach(it => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
      <a href="${it.url}" target="_blank" rel="noopener noreferrer">
        <h3>${it.title}</h3>
        <div class="sub">
          <span>출처: ${it.source}</span>
          <span>시간: ${it.published_at}</span>
        </div>
      </a>
    `;
        $articles.appendChild(card);
    });
}

function renderAll() {
    renderChips();
    renderMeta();
}

// ===== 5) 더미 기사(지금 단계) =====
function getDummyArticles(keywordText) {
    return [
        {
            title: `[${keywordText}] 관련 기사 1 (더미)`,
            url: "https://example.com",
            source: "demo",
            published_at: nowKST(),
        },
        {
            title: `[${keywordText}] 관련 기사 2 (더미)`,
            url: "https://example.com",
            source: "demo",
            published_at: nowKST(),
        },
    ];
}

// ===== 6) 기사 로드(나중에 API로 교체) =====
async function loadArticles() {
    const active = keywords.find(k => k.id === activeKeywordId);
    if (!active) {
        renderArticles([]);
        return;
    }

    // 지금은 더미 데이터로 표시
    const items = getDummyArticles(active.text);

    $lastUpdated.textContent = nowKST();
    renderArticles(items);
}

// ===== 7) 이벤트 =====
$addBtn.addEventListener("click", () => {
    const text = $keywordInput.value.trim();
    const source = $sourceSelect.value;

    if (!text) return;

    // 중복 방지(텍스트+소스)
    const exists = keywords.some(k => k.text === text && k.source === source);
    if (exists) {
        alert("이미 같은 키워드가 있습니다.");
        return;
    }

    const item = { id: uid(), text, source };
    keywords.push(item);

    // 첫 키워드는 자동 선택
    if (!activeKeywordId) activeKeywordId = item.id;

    $keywordInput.value = "";
    renderAll();
    loadArticles();
});

// 엔터로도 추가
$keywordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $addBtn.click();
});

// ===== 8) 초기 화면 =====
function init() {
    renderAll();
    renderArticles([]);
}
init();

// ===== 9) "실시간처럼 보이게": 60초마다 새로고침 (나중에 API 붙이면 진짜 실시간)
// 지금은 더미라도 업데이트 시간 변화가 보임
setInterval(() => {
    if (activeKeywordId) loadArticles();
}, 60 * 1000);
