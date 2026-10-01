const ENDPOINTS = {
    basic: "https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo",
    list: "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2",
    live: "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2"
};
const clean = value => value == null || ["", "-", "null"].includes(String(value).trim()) ? null : String(value).trim();
const number = value => clean(value) !== null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
// 구역 번호와 방향은 보존합니다. 비슷한 이름을 추측해서 합치지 않습니다.
export const nameKey = value => (clean(value) || "").normalize("NFKC").replace(/공영주차장|공영|주차장/g, "").replace(/\s/g, "");
async function getAll(endpoint, key) {
    const result = [];
    for (let page = 1; page <= 30; page++) {
        const url = new URL(endpoint);
        url.searchParams.set("serviceKey", key);
        url.searchParams.set("resultType", "json");
        url.searchParams.set("numOfRows", "100");
        url.searchParams.set("pageNo", String(page));
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error("API 요청 실패");
        const data = await response.json();
        if (String(data.response?.header?.resultCode) !== "00") throw new Error("API 응답 오류");
        const body = data.response.body;
        const raw = body?.items?.item;
        const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
        result.push(...items);
        const total = number(body?.totalCount);
        if (total !== null && result.length >= total) return result;
        if (!items.length) {
            if (total !== null && result.length < total) throw new Error("목록 일부 누락");
            return result;
        }
    }
    throw new Error("목록 조회 범위 초과");
}
function liveInfo(row) {
    if (!row) return null;
    const available = number(row.curravacnt), total = number(row.maxcnt), occupied = number(row.parkingcnt);
    const valid = available !== null && total !== null && total > 0 && available <= total
        && occupied !== null && occupied <= total && available + occupied === total;
    return { valid, available: valid ? available : null, total: total > 0 ? total : null,
        occupied: valid ? occupied : null, updatedAt: clean(row.lastupdatetime) };
}
export function mergeParking(basic, list, live, liveFailed = false) {
    const rows = basic.map((r, i) => ({
        id: `basic-${clean(r.mgntNum) || i}`, name: clean(r.pkNam) || "이름 없음",
        address: clean(r.doroAddr) || clean(r.jibunAddr), roadAddress: clean(r.doroAddr), lotAddress: clean(r.jibunAddr),
        capacity: number(r.pkCnt), type: clean(r.pkFm), operator: clean(r.guNm), phone: clean(r.tponNum),
        basicMinutes: number(r.pkBascTime), basicFee: number(r.tenMin), additionalMinutes: number(r.pkAddTime), additionalFee: number(r.feeAdd),
        dayFee: number(r.ftDay), monthFee: number(r.ftMon), feeNote: clean(r.feeInfo), payment: clean(r.payMtd), note: clean(r.spclNote),
        hours: { weekday: [clean(r.svcSrtTe), clean(r.svcEndTe)], saturday: [clean(r.satSrtTe), clean(r.satEndTe)], holiday: [clean(r.hldSrtTe), clean(r.hldEndTe)] },
        live: null, liveStatus: liveFailed ? "unavailable" : "unsupported", aliases: []
    }));
    const byName = new Map();
    for (const r of rows) { const k = nameKey(r.name); if (k) byName.set(k, [...(byName.get(k) || []), r]); }
    const realtime = new Map(list.filter(r => clean(r.parkgcd)).map(r => [String(r.parkgcd), r]));
    const liveByCode = new Map(live.filter(r => clean(r.parkgcd)).map(r => [String(r.parkgcd), r]));
    for (const r of live) if (clean(r.parkgcd) && !realtime.has(String(r.parkgcd))) realtime.set(String(r.parkgcd), r);
    const counts = new Map();
    for (const r of realtime.values()) { const k = nameKey(r.parknm); counts.set(k, (counts.get(k) || 0) + 1); }
    for (const [code, r] of realtime) {
        const k = nameKey(r.parknm), matches = byName.get(k) || [];
        let target = matches.length === 1 && counts.get(k) === 1 ? matches[0] : null;
        if (!target) { target = { id: `live-${code}`, name: clean(r.parknm) || "이름 없음", address: null, capacity: null, hours: {}, aliases: [] }; rows.push(target); }
        target.aliases.push(clean(r.parknm));
        target.live = liveInfo(liveByCode.get(code));
        target.liveStatus = liveFailed || !target.live || !target.live.valid ? "unavailable" : "available";
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
export async function onRequestGet(context) {
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    let key = context.env.SERVICE_KEY?.trim();
    const send = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (!key) return send({ message: "인증키가 설정되지 않았습니다. SERVICE_KEY를 확인해 주세요." }, 503);
    try { key = decodeURIComponent(key); } catch { /* 원래 키 사용 */ }
    const results = await Promise.allSettled(Object.values(ENDPOINTS).map(endpoint => getAll(endpoint, key)));
    if (results.every(r => r.status === "rejected")) return send({ message: "주차장 정보를 불러오지 못했습니다. 인증키와 API 활용 승인 상태를 확인해 주세요." }, 502);
    const values = results.map(r => r.status === "fulfilled" ? r.value : []);
    const warnings = [];
    if (results[0].status === "rejected") warnings.push("전체 기본 목록 조회에 실패했습니다. 현재 일부 주차장만 표시합니다.");
    if (results[1].status === "rejected") warnings.push("실시간 제공 주차장 목록 조회에 실패했습니다.");
    if (results[2].status === "rejected") warnings.push("실시간 현황 조회에 실패했습니다. 기본 정보는 확인할 수 있습니다.");
    const parkingList = mergeParking(...values, results[2].status === "rejected");
    return send({ parkingList, totalCount: parkingList.length, warnings, fetchedAt: new Date().toISOString() });
}
