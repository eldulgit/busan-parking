const ENDPOINTS = {
    basic: "https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo",
    list: "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2",
    live: "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2"
};
const clean = value => value == null || ["", "-", "null"].includes(String(value).trim()) ? null : String(value).trim();
const number = value => clean(value) !== null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
// 구역 번호와 방향은 보존합니다. 비슷한 이름을 추측해서 합치지 않습니다.
export const nameKey = value => (clean(value) || "").normalize("NFKC").replace(/^도시철도\s*/, "").replace(/공영주차장|공영|주차장/g, "").replace(/[\s,，·ㆍ()（）]/g, "");
// 운영 목록에서 확인한 표기 차이만 지정합니다. 코드·원래 이름이 모두 맞아야 적용합니다.
// mgntNum은 구별로 중복될 수 있으므로 그 값만으로 기본 항목을 선택하지 않습니다.
const VERIFIED_NAME_ALIASES = {
    A48: { source: "대연고가밑", basic: "대연고가도로 밑" },
    A37: { source: "롯데 광복점 뒤(2)", basic: "롯데광복점 뒤 2번" }
};
const addressKey = value => (clean(value) || "").normalize("NFKC")
    .replace(/^(?:부산광역시|부산시)\s*|^부산\s+/, "").replace(/\s+/g, " ").trim();
const districtOnly = value => /^(?:중구|서구|동구|영도구|부산진구|동래구|남구|북구|해운대구|사하구|금정구|강서구|연제구|수영구|사상구|기장군)$/.test(addressKey(value));
// 이름이 같은 중복 항목에서 구 이름만 있는 값은 같은 구의 유일한 상세 주소와 충돌하지 않습니다.
// 서로 다른 상세 주소가 둘 이상이면 연결하지 않습니다. 원본 주소 문자열은 그대로 사용합니다.
export function compatibleAddress(matches) {
    if (!matches.length || !matches.every(p => p.address)) return null;
    const full = matches.map(p => p.address).filter(a => !districtOnly(a));
    const candidates = full.length ? full : matches.map(p => p.address);
    const unique = [...new Set(candidates.map(addressKey))];
    if (unique.length !== 1) return null;
    const key = unique[0];
    if (!matches.every(p => addressKey(p.address) === key
        || (districtOnly(p.address) && key.startsWith(`${addressKey(p.address)} `)))) return null;
    return candidates[0];
}
function singleAddressField(matches, field, selectedAddress) {
    const values = matches.map(p => p[field]).filter(Boolean);
    const full = values.filter(v => !districtOnly(v));
    const unique = [...new Set((full.length ? full : values).map(addressKey))];
    if (unique.length !== 1) return null;
    // 도로명 필드에 구 이름만 있으면 상세 지번 주소와 섞어서 표시하지 않습니다.
    if (!full.length && !districtOnly(selectedAddress)) return null;
    return (full.length ? full : values)[0];
}
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
        detailsStatus: "basic", live: null, liveStatus: "unsupported", aliases: []
    }));
    const byName = new Map();
    for (const r of rows) { const k = nameKey(r.name); if (k) byName.set(k, [...(byName.get(k) || []), r]); }
    const realtime = new Map(list.filter(r => clean(r.parkgcd)).map(r => [String(r.parkgcd), r]));
    const liveByCode = new Map(live.filter(r => clean(r.parkgcd)).map(r => [String(r.parkgcd), r]));
    for (const r of live) if (clean(r.parkgcd) && !realtime.has(String(r.parkgcd))) realtime.set(String(r.parkgcd), r);
    const counts = new Map();
    for (const r of realtime.values()) { const k = nameKey(r.parknm); counts.set(k, (counts.get(k) || 0) + 1); }
    for (const [code, r] of realtime) {
        const k = nameKey(r.parknm);
        const alias = VERIFIED_NAME_ALIASES[code];
        const aliasKey = alias && k === nameKey(alias.source) ? nameKey(alias.basic) : null;
        const keys = [...new Set([k, nameKey(liveByCode.get(code)?.parknm), aliasKey].filter(Boolean))];
        const matches = [...new Set(keys.flatMap(key => byName.get(key) || []))];
        let target = matches.length === 1 && counts.get(k) === 1 ? matches[0] : null;
        if (!target) { target = { id: `live-${code}`, name: clean(r.parknm) || "이름 없음", address: null, capacity: null, hours: {}, aliases: [] }; rows.push(target); }
        // 이름이 중복되더라도 주소가 모두 같으면 일치하는 상세 항목을 보완합니다.
        // 서로 다른 값이 있는 항목은 임의로 하나를 선택하지 않습니다.
        const sharedAddress = compatibleAddress(matches);
        target.detailsStatus = target === matches[0] && matches.length === 1 ? "linked" : "unmatched";
        if (target.detailsStatus === "unmatched" && sharedAddress) {
            target.address = sharedAddress;
            target.roadAddress = singleAddressField(matches, "roadAddress", sharedAddress);
            target.lotAddress = singleAddressField(matches, "lotAddress", sharedAddress);
            const fields = ["capacity", "type", "operator", "phone",
                "basicMinutes", "basicFee", "additionalMinutes", "additionalFee", "dayFee", "monthFee",
                "feeNote", "payment", "note"];
            for (const field of fields) {
                const values = [...new Set(matches.map(p => p[field]).filter(v => v !== null && v !== undefined))];
                if (values.length === 1) target[field] = values[0];
            }
            // 시간/요금은 단위와 값을 한 쌍으로 비교해 잘못 조합하지 않습니다.
            for (const [minutes, amount] of [["basicMinutes", "basicFee"], ["additionalMinutes", "additionalFee"]]) {
                const pairs = matches.filter(p => p[minutes] > 0 && p[amount] != null).map(p => [p[minutes], p[amount]]);
                const unique = [...new Set(pairs.map(pair => JSON.stringify(pair)))];
                target[minutes] = unique.length === 1 ? JSON.parse(unique[0])[0] : null;
                target[amount] = unique.length === 1 ? JSON.parse(unique[0])[1] : null;
            }
            for (const day of ["weekday", "saturday", "holiday"]) {
                const pairs = matches.map(p => p.hours[day]).filter(pair => pair?.[0] && pair?.[1]);
                const unique = [...new Set(pairs.map(pair => JSON.stringify(pair)))];
                target.hours[day] = unique.length === 1 ? JSON.parse(unique[0]) : [null, null];
            }
            target.detailsStatus = "shared-address";
        }
        target.aliases.push(clean(r.parknm), clean(liveByCode.get(code)?.parknm));
        if (aliasKey) target.aliases.push(...matches.map(p => p.name));
        target.realtimeSupported = true;
        target.live = liveInfo(liveByCode.get(code));
        target.liveStatus = liveFailed || !target.live || !target.live.valid ? "unavailable" : "available";
    }
    return rows.sort((a, b) => {
        const priority = p => p.liveStatus === "available" ? 0 : p.id.startsWith("live-") || p.live ? 1 : 2;
        return priority(a) - priority(b) || a.name.localeCompare(b.name, "ko");
    });
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
    for (const p of parkingList) p.addressStatus = p.address ? "available" : results[0].status === "rejected" ? "source-failed" : p.realtimeSupported && p.detailsStatus === "unmatched" ? "unmatched" : "missing";
    const unmatched = parkingList.filter(p => p.addressStatus === "unmatched").length;
    if (unmatched) warnings.push(`실시간 주차장 ${unmatched}곳은 기본 정보 연결을 확인하지 못했습니다. 이름·구역 차이 또는 중복 주소 확인이 필요합니다.`);
    const sourceMissing = parkingList.filter(p => p.realtimeSupported && p.addressStatus === "missing").length;
    if (sourceMissing) warnings.push(`실시간 주차장 ${sourceMissing}곳은 기본 정보가 연결됐지만 공공데이터에 주소가 없습니다.`);
    return send({ parkingList, totalCount: parkingList.length, warnings, fetchedAt: new Date().toISOString() });
}
