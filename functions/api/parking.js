// Cloudflare에 등록한 SERVICE_KEY를 사용해 주차장 목록을 조회합니다.
export async function onRequestGet(context) {
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };
    const serviceKey = context.env.SERVICE_KEY?.trim();

    if (!serviceKey) {
        return new Response(JSON.stringify({
            message: "인증키가 설정되지 않았습니다. SERVICE_KEY를 확인해 주세요."
        }), { status: 503, headers });
    }

    try {
        const url = new URL("https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2");
        // Decoding 키를 권장하며 Encoding 키를 넣어도 이중 인코딩하지 않습니다.
        let key = serviceKey;
        try { key = decodeURIComponent(key); } catch { /* 원래 값 사용 */ }
        url.searchParams.set("serviceKey", key);
        url.searchParams.set("pageNo", "1");
        url.searchParams.set("numOfRows", "50");
        url.searchParams.set("resultType", "json");

        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("공공 API 요청 실패");

        const data = await response.json();
        if (String(data.response?.header?.resultCode) !== "00") {
            throw new Error("공공 API 응답 오류");
        }

        const body = data.response.body;
        const item = body?.items?.item;
        const items = Array.isArray(item) ? item : item ? [item] : [];
        // 화면에 필요한 이름과 코드만 반환합니다. 인증키는 반환하지 않습니다.
        const parkingList = items.map(parking => ({
            code: parking.parkgcd,
            name: parking.parknm
        }));

        return new Response(JSON.stringify({
            parkingList,
            totalCount: Number(body.totalCount ?? parkingList.length),
            pageNo: 1
        }), { headers });
    } catch {
        // 인증키가 포함될 수 있는 요청 URL이나 원본 오류는 출력하지 않습니다.
        return new Response(JSON.stringify({
            message: "주차장 목록을 불러오지 못했습니다. 인증키와 API 활용 승인 상태를 확인해 주세요."
        }), { status: 502, headers });
    }
}
