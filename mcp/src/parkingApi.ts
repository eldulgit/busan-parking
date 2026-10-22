import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export interface Parking {
    name: string;
    address?: string | null;
    liveStatus?: string;
    capacity?: number | null;
    live?: { available?: number | null; total?: number | null; occupied?: number | null; updatedAt?: string | null } | null;
    [key: string]: unknown;
}
export interface ParkingData { parkingList: Parking[]; warnings: string[] }
export const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s,，·ㆍ()（）]/g, '');
export function validCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
export function summarize(p: Parking) {
    return {
        ...p,
        // 현재 통합 API의 live.available을 문서의 curravacnt에 대응시킨다.
        curravacnt: p.liveStatus === 'available' ? validCount(p.live?.available) : null,
        total: validCount(p.live?.total) ?? validCount(p.capacity),
        occupied: p.liveStatus === 'available' ? validCount(p.live?.occupied) : null,
        updatedAt: p.live?.updatedAt ?? null
    };
}
export async function getParkingData(): Promise<ParkingData> {
    const url = process.env.PARKING_API_URL || 'https://new-busan-parking.pages.dev/api/parking';
    let response: Response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(60000), cache: 'no-store' }); }
    catch { throw new Error('주차정보 API에 연결하지 못했습니다. PARKING_API_URL과 네트워크를 확인하세요.'); }
    if (!response.ok) throw new Error(`주차정보 API 조회 실패 (HTTP ${response.status})`);
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error('주차정보 API 응답이 JSON이 아닙니다.'); }
    const body = data as { parkingList?: unknown; items?: unknown; warnings?: unknown; success?: boolean } | null;
    if (!body || body.success === false) throw new Error('주차정보 API가 조회 실패를 반환했습니다.');
    // 첨부 ZIP의 parkingList 형식과 문서의 운영 API items 형식을 모두 지원한다.
    let list: Parking[];
    if (Array.isArray(body.parkingList) && body.parkingList.every(p => p && typeof p.name === 'string')) {
        list = body.parkingList;
    } else if (Array.isArray(body.items) && body.items.every(p => p && typeof p.parknm === 'string')) {
        const clean = (v: unknown): string | null => v == null || ['', '-'].includes(String(v).trim()) ? null : String(v).trim();
        const number = (v: unknown) => { const t = clean(v); return t === null ? null : validCount(Number(t)); };
        list = body.items.map(p => {
            const available = number(p.curravacnt), total = number(p.maxcnt), occupied = number(p.parkingcnt);
            const liveValid = available !== null && total !== null && occupied !== null && available <= total && occupied <= total && available + occupied === total;
            const start = clean(p.svcSrtTe), end = clean(p.svcEndTe);
            return {
                ...p, name: p.parknm, address: clean(p.doroAddr) ?? clean(p.jibunAddr),
                roadAddress: clean(p.doroAddr), lotAddress: clean(p.jibunAddr),
                liveStatus: liveValid ? 'available' : 'unavailable',
                live: { available, total, occupied, updatedAt: clean(p.lastupdatetime) },
                capacity: number(p.pkCnt), basicMinutes: number(p.pkBascTime), basicFee: number(p.tenMin),
                additionalMinutes: number(p.pkAddTime), additionalFee: number(p.feeAdd),
                dayFee: number(p.ftDay), monthFee: number(p.ftMon),
                hours: { weekday: start && end ? [start, end] : null }, operator: clean(p.guNm)
            };
        });
    } else { throw new Error('주차정보 API의 parkingList/items 형식이 올바르지 않습니다.'); }
    return { parkingList: list, warnings: Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === 'string') : [] };
}
