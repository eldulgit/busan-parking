const listElement = document.querySelector("#parking-list");
const statusElement = document.querySelector("#status-message");
const warningElement = document.querySelector("#warning-message");
const input = document.querySelector("#search-input");
const reload = document.querySelector("#reload-button");
const more = document.querySelector("#more-button");
let parkingList = [], filtered = [], shown = 30, loading = false;
const text = (value, fallback = "정보 없음") => value === null || value === undefined || value === "" ? fallback : String(value);
const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s/g, "");
function element(tag, content, className) { const e = document.createElement(tag); e.textContent = content; if (className) e.className = className; return e; }
function money(value) { return value === null || value === undefined ? "정보 없음" : `${Number(value).toLocaleString("ko-KR")}원`; }
function fee(p) { return p.basicMinutes > 0 && p.basicFee != null ? `기본 ${p.basicMinutes}분 ${money(p.basicFee)}` : "기본요금 정보 없음"; }
function hours(pair) {
    if (!pair || !pair[0] || !pair[1]) return "정보 없음";
    const valid = s => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s) || s === "24:00";
    if (!pair.every(valid)) return "제공 시간 확인 필요";
    return pair[0] === "00:00" && pair[1] === "24:00" ? "24시간" : pair.join(" ~ ");
}
function addDetail(parent, label, value) { parent.append(element("dt", label), element("dd", text(value))); }
function card(p) {
    const article = element("article", "", "parking-card");
    const top = element("div", "", "card-top");
    const isLive = p.liveStatus === "available";
    top.append(element("h2", p.name), element("span", isLive ? "실시간 제공" : p.liveStatus === "unavailable" ? "현황 조회 불가" : "실시간 정보 미제공", `badge ${isLive ? "live" : "muted"}`));
    article.append(top, element("p", text(p.address, p.addressStatus === "source-failed" ? "주소 조회 실패 · 기본 정보 API 확인 필요" : p.addressStatus === "unmatched" ? "주소 연결 필요 · 기본 목록과 이름 불일치" : "주소 정보 미제공"), "address"));
    if (isLive) {
        article.append(element("p", p.live.available === 0 ? `만차 · 전체 ${p.live.total}면` : `주차 가능 ${p.live.available}면 / 전체 ${p.live.total}면`, `availability ${p.live.available === 0 ? "full" : ""}`));
        article.append(element("p", `주차 중 ${p.live.occupied}대 · 갱신 ${text(p.live.updatedAt)}`, "updated"));
    } else {
        const capacity = p.capacity ?? p.live?.total;
        article.append(element("p", capacity == null ? "주차면수 정보 없음" : `전체 ${capacity}면`, "capacity"));
        if (p.live?.updatedAt) article.append(element("p", `현황 갱신 ${p.live.updatedAt} · 수치 확인 필요`, "updated"));
    }
    article.append(element("p", fee(p)), element("p", `평일 운영 ${hours(p.hours?.weekday)}`));
    const details = element("details", ""); details.append(element("summary", "상세 정보"));
    const dl = element("dl", "");
    addDetail(dl, "도로명 주소", p.roadAddress); addDetail(dl, "지번 주소", p.lotAddress);
    addDetail(dl, "주차장 형태", p.type); addDetail(dl, "관리기관", p.operator); addDetail(dl, "전화번호", p.phone);
    addDetail(dl, "기본요금", fee(p));
    addDetail(dl, "추가요금", p.additionalMinutes > 0 && p.additionalFee != null ? `${p.additionalMinutes}분당 ${money(p.additionalFee)}` : null);
    addDetail(dl, "일 주차요금", p.dayFee > 0 ? money(p.dayFee) : "정보 없음 / 적용 여부 확인 필요");
    addDetail(dl, "월 주차요금", p.monthFee > 0 ? money(p.monthFee) : "정보 없음 / 적용 여부 확인 필요");
    addDetail(dl, "평일", hours(p.hours?.weekday)); addDetail(dl, "토요일", hours(p.hours?.saturday)); addDetail(dl, "공휴일", hours(p.hours?.holiday));
    addDetail(dl, "요금 안내", p.feeNote); addDetail(dl, "결제 방법", p.payment); addDetail(dl, "특이사항", p.note);
    details.append(dl, element("small", "요금과 운영시간은 제공기관 정보입니다. 0원 항목의 무료 이용 여부는 관리기관에 확인해 주세요."));
    article.append(details); return article;
}
function render() {
    if (loading) return;
    const query = normalize(input.value);
    filtered = parkingList.filter(p => [p.name, p.address, p.roadAddress, p.lotAddress, ...(p.aliases || [])].some(v => normalize(v).includes(query))).sort((a, b) => {
        const rank = p => p.liveStatus === "available" ? 0 : p.realtimeSupported || p.live ? 1 : 2;
        return rank(a) - rank(b) || a.name.localeCompare(b.name, "ko");
    });
    listElement.replaceChildren(...filtered.slice(0, shown).map(card));
    statusElement.textContent = `전체 ${parkingList.length}곳 · 검색 결과 ${filtered.length}곳 · ${Math.min(shown, filtered.length)}곳 표시`;
    if (!filtered.length) listElement.append(element("p", "검색 결과가 없습니다. 다른 이름이나 주소로 검색해 주세요.", "empty"));
    more.hidden = shown >= filtered.length;
}
async function load() {
    loading = true; reload.disabled = true; more.hidden = true;
    listElement.setAttribute("aria-busy", "true");
    statusElement.textContent = "전체 주차장 정보를 불러오는 중입니다."; warningElement.textContent = "";
    try {
        const response = await fetch("/api/parking", { signal: AbortSignal.timeout(60000) });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.parkingList)) throw new Error(data.message || "조회에 실패했습니다.");
        parkingList = data.parkingList; shown = 30; loading = false; render();
        warningElement.textContent = (data.warnings || []).join(" ");
    } catch (error) {
        loading = false;
        statusElement.textContent = error.name === "TimeoutError" ? "조회 시간이 초과되었습니다. 다시 시도해 주세요." : error.message;
        if (parkingList.length) warningElement.textContent = "이전에 조회한 정보가 표시되어 있습니다. 최신 현황이 아닐 수 있습니다.";
    } finally { loading = false; reload.disabled = false; listElement.setAttribute("aria-busy", "false"); }
}
document.querySelector("#search-form").addEventListener("submit", e => { e.preventDefault(); shown = 30; render(); });
input.addEventListener("input", () => { shown = 30; render(); });
document.querySelector("#reset-button").addEventListener("click", () => { input.value = ""; shown = 30; render(); });
more.addEventListener("click", () => { shown += 30; render(); });
reload.addEventListener("click", load);
load();
