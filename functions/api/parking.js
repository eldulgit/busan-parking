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
// URL·인증키·제공기관 원문 오류는 반환하거나 기록하지 않습니다.
function sourceError(reason, details = {}) {
    const error = new Error(reason);
    error.sourceFailure = { reason, ...details };
    return error;
}
function safeFailure(error) {
    return error?.sourceFailure || { reason: "request-failed" };
}
function failureMessage(failure) {
    if (failure.reason === "timeout") return "제공기관의 응답이 지연되어 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    if (failure.reason === "network") return "제공기관에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    if (failure.reason === "http") return "제공기관 서버가 요청을 정상 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    if (["invalid-json", "invalid-body"].includes(failure.reason)) return "제공기관의 응답 형식을 확인할 수 없습니다.";
    if (failure.reason === "api-error") return "공공데이터 API가 오류를 반환했습니다. 제공기관의 오류 코드 확인이 필요합니다.";
    if (["incomplete-list", "page-limit"].includes(failure.reason)) return "주차장 전체 목록을 끝까지 조회하지 못했습니다.";
    return "주차정보 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
async function getAll(endpoint, key) {
    const result = [];
    for (let page = 1; page <= 30; page++) {
        const url = new URL(endpoint);
        url.searchParams.set("serviceKey", key);
        url.searchParams.set("resultType", "json");
        url.searchParams.set("numOfRows", "100");
        url.searchParams.set("pageNo", String(page));
        let response;
        try {
            response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        } catch (error) {
            throw sourceError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network");
        }
        if (!response.ok) throw sourceError("http", { httpStatus: response.status });
        let data;
        try { data = await response.json(); }
        catch (error) { throw sourceError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "invalid-json"); }
        const resultCode = String(data?.response?.header?.resultCode ?? "");
        if (resultCode !== "00") {
            // 숫자 코드만 허용하며 원문 메시지는 절대 포함하지 않습니다.
            throw sourceError("api-error", /^\d{1,3}$/.test(resultCode) ? { apiCode: resultCode } : {});
        }
        const body = data.response.body;
        if (!body || typeof body !== "object") throw sourceError("invalid-body");
        const raw = body.items?.item;
        const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (!items.every(item => item && typeof item === "object" && !Array.isArray(item))) throw sourceError("invalid-body");
        result.push(...items);
        const total = number(body.totalCount);
        if (total !== null && result.length >= total) return result;
        if (!items.length) {
            if (total !== null && result.length < total) throw sourceError("incomplete-list");
            return result;
        }
    }
    throw sourceError("page-limit");
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
    const sourceStatus = Object.fromEntries(Object.keys(ENDPOINTS).map((name, i) => [name,
        results[i].status === "fulfilled"
            ? { status: "ok", count: results[i].value.length }
            : { status: "failed", ...safeFailure(results[i].reason) }
    ]));
    if (results.every(r => r.status === "rejected")) {
        const failures = results.map(r => safeFailure(r.reason));
        const explanations = [...new Set(failures.map(failureMessage))];
        return send({ message: `주차장 정보를 불러오지 못했습니다. ${explanations.join(" ")}`, sourceStatus }, 502);
    }
    const values = results.map(r => r.status === "fulfilled" ? r.value : []);
    const warnings = [];
    if (results[0].status === "rejected") warnings.push(`전체 기본 목록 조회에 실패했습니다. 현재 일부 주차장만 표시합니다. ${failureMessage(safeFailure(results[0].reason))}`);
    if (results[1].status === "rejected") warnings.push(`실시간 제공 주차장 목록 조회에 실패했습니다. ${failureMessage(safeFailure(results[1].reason))}`);
    if (results[2].status === "rejected") warnings.push(`실시간 현황 조회에 실패했습니다. 기본 정보는 확인할 수 있습니다. ${failureMessage(safeFailure(results[2].reason))}`);
    const parkingList = mergeParking(...values, results[2].status === "rejected");
    for (const p of parkingList) p.addressStatus = p.address ? "available" : results[0].status === "rejected" ? "source-failed" : p.realtimeSupported && p.detailsStatus === "unmatched" ? "unmatched" : "missing";
    const unmatched = parkingList.filter(p => p.addressStatus === "unmatched").length;
    if (unmatched) warnings.push(`실시간 주차장 ${unmatched}곳은 기본 정보 연결을 확인하지 못했습니다. 이름·구역 차이 또는 중복 주소 확인이 필요합니다.`);
    const sourceMissing = parkingList.filter(p => p.realtimeSupported && p.addressStatus === "missing").length;
    if (sourceMissing) warnings.push(`실시간 주차장 ${sourceMissing}곳은 기본 정보가 연결됐지만 공공데이터에 주소가 없습니다.`);
    return send({ parkingList, totalCount: parkingList.length, warnings, sourceStatus, fetchedAt: new Date().toISOString() });
}
