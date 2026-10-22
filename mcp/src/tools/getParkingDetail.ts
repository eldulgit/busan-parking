import { getParkingData, normalize, summarize } from '../parkingApi.js';
import { searchMatches } from './searchParking.js';
export async function getParkingDetail(name: string) {
    const data = await getParkingData();
    const exact = data.parkingList.filter(p => normalize(p.name) === normalize(name));
    const matches = exact.length ? exact : searchMatches(data.parkingList, name);
    return {
        status: matches.length === 1 ? 'found' : matches.length ? 'ambiguous' : 'not_found',
        message: matches.length > 1 ? '여러 주차장이 일치합니다. 후보의 이름과 주소를 확인해 주세요.' : matches.length ? '상세정보를 조회했습니다.' : '일치하는 주차장이 없습니다.',
        parking: matches.length === 1 ? summarize(matches[0]) : null,
        candidates: matches.length > 1 ? matches.map(summarize) : [],
        warnings: data.warnings
    };
}
