const listElement = document.querySelector("#parking-list");
const statusElement = document.querySelector("#status-message");
const warningElement = document.querySelector("#warning-message");
const input = document.querySelector("#search-input");
const reload = document.querySelector("#reload-button");
const more = document.querySelector("#more-button");
let parkingList = [], filtered = [], shown = 30, loading = false;
let currentLocation = null, currentSort = "default", locationRequest = 0;
const locationMessage = document.querySelector("#location-message");
const locationButton = document.querySelector("#location-button");
const defaultSort = document.querySelector("#default-sort");
const availableSort = document.querySelector("#available-sort");
const availableCount = p => p.liveStatus === "available" && typeof p.live?.available === "number" ? p.live.available : -1;
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
function addDetail(parent, label, value) {
    if (value == null || value === "" || value === "-" || String(value).includes("정보 없음")) return;
    parent.append(element("dt", label), element("dd", String(value)));
}
function kakaoSearchUrl(name) {
    const placeName = String(name || "").normalize("NFKC").trim().replace(/^도시철도\s*/, "");
    const parkingName = placeName.includes("주차장") ? placeName : `${placeName} 공영주차장`;
    return "https://map.kakao.com/link/search/" + encodeURIComponent(`부산 ${parkingName}`);
}
function card(p) {
    const article = element("article", "", "parking-card");
    const top = element("div", "", "card-top");
    const isLive = p.liveStatus === "available";
    top.append(element("h2", p.name), element("span", isLive ? "실시간 제공" : p.liveStatus === "unavailable" ? "현황 조회 불가" : "실시간 정보 미제공", `badge ${isLive ? "live" : "muted"}`));
    article.append(top);
    if (Number.isFinite(p.distanceKm)) article.append(element("p", `현재 위치에서 약 ${ParkingLocation.format(p.distanceKm)} · 직선거리`, "distance-badge"));
    const addressBox = element("div", "", "address-box");
    addressBox.append(element("span", "주소(공공데이터 기준)", "field-label"));
    addressBox.append(element("p", text(p.address, "주소가 제공되지 않았습니다. 지도에서 위치를 확인하세요."), "address"));
    article.append(addressBox);
    if (isLive) {
        article.append(element("p", p.live.available === 0 ? `만차${p.live.total == null ? "" : ` · 전체 ${p.live.total}면`}` : `주차 가능 ${p.live.available}면${p.live.total == null ? "" : ` / 전체 ${p.live.total}면`}`, `availability ${p.live.available === 0 ? "full" : ""}`));
        article.append(element("p", [p.live.occupied == null ? null : `주차 중 ${p.live.occupied}대`, p.live.updatedAt ? `갱신 ${p.live.updatedAt}` : "제공기관에서 실시간 갱신시각을 제공하지 않았습니다."].filter(Boolean).join(" · "), "updated"));
    } else {
        const capacity = p.capacity ?? p.live?.total;
        article.append(element("p", capacity == null ? "주차면수 정보 없음" : `전체 ${capacity}면`, "capacity"));
        if (p.live?.updatedAt) article.append(element("p", `현황 갱신 ${p.live.updatedAt} · 수치 확인 필요`, "updated"));
    }
    if (p.basicMinutes > 0 && p.basicFee != null) article.append(element("p", fee(p)));
    const weekday = hours(p.hours?.weekday);
    if (weekday !== "정보 없음") article.append(element("p", `평일 운영 ${weekday}`));
    const details = element("details", ""); details.append(element("summary", "상세 정보"));
    const dl = element("dl", "");
    addDetail(dl, "도로명 주소", p.roadAddress); addDetail(dl, "지번 주소", p.lotAddress);
    addDetail(dl, "주차장 형태", p.type); addDetail(dl, "관리기관", p.operator); addDetail(dl, "전화번호", p.phone);
    addDetail(dl, "기본요금", fee(p));
    addDetail(dl, "추가요금", p.additionalMinutes > 0 && p.additionalFee != null ? `${p.additionalMinutes}분당 ${money(p.additionalFee)}` : null);
    addDetail(dl, "일 주차요금", p.dayFee > 0 ? money(p.dayFee) : "정보 없음 / 적용 여부 확인 필요");
    addDetail(dl, "월 주차요금", p.monthFee > 0 ? money(p.monthFee) : "정보 없음 / 적용 여부 확인 필요");
    addDetail(dl, "평일", hours(p.hours?.weekday)); addDetail(dl, "토요일", hours(p.hours?.saturday)); addDetail(dl, "공휴일", hours(p.hours?.holiday));

    if (dl.children.length) {
        details.append(dl);
        if (p.detailsStatus === "unmatched") details.append(element("p", "요금·운영시간 등 기본 정보를 확인하지 못했습니다.", "updated"));
        if (p.basicFee === 0 || p.additionalFee === 0) details.append(element("small", "0원 항목의 무료 이용 여부는 관리기관에 확인해 주세요."));
    } else {
        const message = p.addressStatus === "source-failed"
            ? "기본 정보 조회에 실패했습니다. 정보 새로고침으로 다시 시도해 주세요."
            : p.detailsStatus === "unmatched"
                ? "이 주차장의 주소·요금·운영시간은 아직 확인되지 않았습니다. 실시간 주차 현황만 확인할 수 있습니다."
                : "제공기관에서 이 주차장의 상세정보를 제공하지 않았습니다.";
        details.append(element("p", message, "updated"));
    }
    article.append(details);
    const footer = element("div", "", "card-footer");
    footer.append(element("p", "주소는 공공데이터 기준이며 실제 위치와 다를 수 있습니다. 지도에서 위치를 확인하세요.", "address-note"));
    if (p.name && p.name !== "이름 없음") {
        const mapLink = element("a", "카카오맵에서 위치 확인 ↗", "map-link");
        mapLink.href = kakaoSearchUrl(p.name);
        mapLink.target = "_blank";
        mapLink.rel = "noopener noreferrer";
        mapLink.setAttribute("aria-label", `${p.name} 카카오맵에서 위치 확인 (새 창)`);
        footer.append(mapLink);
    }
    article.append(footer);
    return article;
}
function render() {
    if (loading) return;
    const query = normalize(input.value);
    if (currentLocation) {
        // 가까운 5곳을 먼저 확정한 뒤 그 안에서 빈자리순으로 바꿉니다.
        filtered = ParkingLocation.nearest(parkingList,currentLocation,5);
        locationMessage.textContent = !filtered.length ? "위치 검색에 사용할 좌표가 있는 주차장이 없습니다." : filtered[0].distanceKm > 50 ? "현재 위치가 부산 주차장 데이터 범위와 멉니다. 가장 가까운 곳을 표시합니다." : "현재 위치에서 가까운 5곳입니다. 거리는 직선거리이며 실제 이동거리와 다릅니다.";
    } else {
        filtered = parkingList.filter(p => [p.name,p.address,p.roadAddress,p.lotAddress,...(p.aliases || [])].some(v => normalize(v).includes(query))).sort((a,b) => {
            const rank = p => p.liveStatus === "available" ? 0 : p.realtimeSupported || p.live ? 1 : 2;
            return rank(a)-rank(b) || a.name.localeCompare(b.name,"ko");
        });
    }
    if (currentSort === "available") filtered.sort((a,b) => availableCount(b)-availableCount(a));
    defaultSort.textContent = currentLocation ? "가까운 순" : "기본순";
    defaultSort.setAttribute("aria-pressed",String(currentSort === "default"));
    availableSort.setAttribute("aria-pressed",String(currentSort === "available"));
    listElement.replaceChildren(...filtered.slice(0, shown).map(card));
    statusElement.textContent = `전체 ${parkingList.length}곳 · 검색 결과 ${filtered.length}곳 · ${Math.min(shown, filtered.length)}곳 표시`;
    if (!filtered.length) listElement.append(element("p", "검색 결과가 없습니다. 다른 이름이나 주소로 검색해 주세요.", "empty"));
    more.hidden = shown >= filtered.length;
}
async function load() {
    loading = true; reload.disabled = true; locationButton.disabled = true; more.hidden = true;
    listElement.setAttribute("aria-busy", "true");
    statusElement.textContent = "전체 주차장 정보를 불러오는 중입니다."; warningElement.textContent = "";
    try {
        const response = await fetch("/api/parking", { cache: "no-store", signal: AbortSignal.timeout(60000) });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.parkingList)) throw new Error(data.message || "조회에 실패했습니다.");
        parkingList = data.parkingList; shown = 30; loading = false; render();
        warningElement.textContent = (data.warnings || []).join(" ");
    } catch (error) {
        loading = false;
        statusElement.textContent = !navigator.onLine ? "인터넷 연결이 없어 주차정보를 조회할 수 없습니다. 연결 후 정보 새로고침을 눌러 주세요." : error.name === "TimeoutError" ? "조회 시간이 초과되었습니다. 다시 시도해 주세요." : error.message;
        if (parkingList.length) warningElement.textContent = "이전에 조회한 정보가 표시되어 있습니다. 최신 현황이 아닐 수 있습니다.";
    } finally { loading = false; reload.disabled = false; locationButton.disabled = false; listElement.setAttribute("aria-busy", "false"); }
}
document.querySelector("#search-form").addEventListener("submit", e => { e.preventDefault(); leaveLocation(); shown = 30; render(); });
input.addEventListener("input", () => { leaveLocation(); shown = 30; render(); });
document.querySelector("#reset-button").addEventListener("click", () => { input.value = ""; leaveLocation(); currentSort = "default"; shown = 30; render(); });
more.addEventListener("click", () => { shown += 30; render(); });
reload.addEventListener("click", load);
load();

// V6.4.1: 단순 요청은 로컬 규칙, 복잡한 표현은 서버의 Gemini가 해석합니다.
const aiForm = document.querySelector("#ai-form");
const aiInput = document.querySelector("#ai-input");
const aiSend = document.querySelector("#ai-send");
const aiResult = document.querySelector("#ai-result");
const voiceButton = document.querySelector("#voice-button");
const voiceStatus = document.querySelector("#voice-status");
let aiBusy = false, recognition = null, listening = false;
function renderAiResult(explanation, rows = []) {
    document.querySelector("#ai-explanation").textContent = explanation;
    document.querySelector("#ai-parking-list").replaceChildren(...rows.map(card));
}
function leaveLocation() { locationRequest++; currentLocation=null; locationMessage.textContent=""; }
defaultSort.addEventListener("click",()=>{currentSort="default";render();});
availableSort.addEventListener("click",()=>{currentSort="available";render();});
async function findNearby(sortAvailable=false) {
    if (loading) { locationMessage.textContent="주차장 정보를 불러온 뒤 다시 눌러 주세요."; return; }
    if (!window.isSecureContext || !navigator.geolocation) { locationMessage.textContent="이 브라우저에서는 위치 기능을 사용할 수 없습니다. HTTPS 주소에서 다시 시도해 주세요."; return; }
    const token=++locationRequest;
    locationMessage.textContent="현재 위치를 확인하고 있습니다…";
    locationButton.disabled=true;
    try {
        const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:60000}));
        if(token!==locationRequest)return;
        currentLocation={latitude:position.coords.latitude,longitude:position.coords.longitude};
        input.value="";currentSort=sortAvailable?"available":"default";shown=30;render();
    } catch(error) {
        if(token!==locationRequest)return;
        locationMessage.textContent=error.code===1?"브라우저 또는 앱 설정에서 위치 권한을 허용해 주세요.":error.code===3?"위치 확인 시간이 초과되었습니다. 잠시 후 GPS 버튼을 다시 눌러 주세요.":"현재 위치를 확인하지 못했습니다. 기기의 위치 기능(GPS)을 확인해 주세요.";
    } finally {locationButton.disabled=loading;}
}
locationButton.addEventListener("click",()=>findNearby());
const isNearbyRequest = message => /주차/.test(message) && /내\s*주변|내\s*근처|현재\s*위치|가까운|근처/.test(message);
async function submitAiRequest() {
    const message=aiInput.value.trim();
    if(aiBusy)return;
    if(!message){renderAiResult("원하는 지역이나 주차장을 입력해 주세요.");aiInput.focus();return;}
    if(isNearbyRequest(message)) {
        renderAiResult("현재 위치 기준 검색 결과는 아래 주차장 목록에 표시합니다.");
        await findNearby(/빈\s*자리|여유|주차\s*가능/.test(message));return;
    }
    if(!navigator.onLine){renderAiResult("인터넷 연결 후 다시 요청해 주세요.");return;}
    aiBusy=true;aiSend.disabled=true;voiceButton.disabled=true;aiSend.textContent="찾는 중…";aiResult.setAttribute("aria-busy","true");
    renderAiResult("요청하신 조건으로 주차장 정보를 확인하고 있어요.");
    try {
        const response=await fetch("/api/ai-parking",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message}),signal:AbortSignal.timeout(125000),cache:"no-store"});
        const data=await response.json();
        if(!response.ok || !data.success || !Array.isArray(data.parkingList))throw new Error(data.message || "요청을 처리하지 못했습니다.");
        renderAiResult([data.summary,...(data.warnings||[])].join("\n\n"),data.parkingList);
    } catch(error) {renderAiResult(error.name==="TimeoutError"?"응답 시간이 초과되었습니다. 잠시 후 다시 요청해 주세요.":error.message || "연결에 실패했습니다.");}
    finally {aiBusy=false;aiSend.disabled=false;voiceButton.disabled=false;aiSend.textContent="보내기";aiResult.setAttribute("aria-busy","false");}
}
aiForm.addEventListener("submit",event=>{event.preventDefault();if(listening)recognition?.abort();submitAiRequest();});
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function voiceState(active) {
    listening=active;voiceButton.classList.toggle("listening",active);voiceButton.setAttribute("aria-pressed",String(active));
    voiceButton.setAttribute("aria-label",active?"음성 입력 중지":"음성으로 주차장 찾기");
}
voiceButton.addEventListener("click",()=>{
    if(aiBusy)return;
    if(!SpeechRecognition){voiceStatus.textContent="이 브라우저는 음성 입력을 지원하지 않습니다. Chrome 계열 브라우저에서 시도하거나 텍스트로 입력해 주세요.";return;}
    if(listening){recognition.stop();return;}
    recognition=new SpeechRecognition();recognition.lang="ko-KR";recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
    let received=false,errored=false;
    recognition.onstart=()=>{voiceState(true);voiceStatus.textContent="듣고 있습니다… 말씀해 주세요.";};
    recognition.onresult=event=>{
        const transcript=event.results?.[0]?.[0]?.transcript?.trim();
        if(!transcript)return;received=true;aiInput.value=transcript.slice(0,1000);voiceStatus.textContent=`인식한 내용: ${aiInput.value}`;
        voiceState(false);submitAiRequest();
    };
    recognition.onerror=event=>{
        errored=true;voiceState(false);
        const messages={"not-allowed":"브라우저 또는 앱 설정에서 마이크 권한을 허용해 주세요.","service-not-allowed":"이 환경에서는 음성 입력을 허용하지 않습니다. 텍스트로 입력해 주세요.","no-speech":"음성이 들리지 않았습니다. 마이크 버튼을 다시 누르고 말해 주세요.","audio-capture":"마이크를 사용할 수 없습니다. 연결 상태와 다른 앱의 사용 여부를 확인해 주세요.","network":"음성 인식 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.","language-not-supported":"이 브라우저는 한국어 음성 인식을 지원하지 않습니다.","aborted":"음성 입력을 중지했습니다."};
        voiceStatus.textContent=messages[event.error] || "음성을 인식하지 못했습니다. 다시 시도해 주세요.";
    };
    recognition.onend=()=>{voiceState(false);if(!received&&!errored)voiceStatus.textContent="음성이 들리지 않았습니다. 다시 말하거나 텍스트로 입력해 주세요.";};
    try{recognition.start();}catch{voiceState(false);voiceStatus.textContent="마이크를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";}
});
