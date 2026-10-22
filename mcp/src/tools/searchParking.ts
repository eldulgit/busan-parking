import { getParkingData, normalize, summarize, type Parking } from '../parkingApi.js';
export function searchMatches(list: Parking[], keyword: string): Parking[] {
    const key = normalize(keyword);
    return list.filter(p => normalize(p.name).includes(key)).sort((a, b) =>
        Number(!normalize(a.name).startsWith(key)) - Number(!normalize(b.name).startsWith(key))
        || a.name.localeCompare(b.name, 'ko'));
}
export async function searchParking(keyword: string) {
    const data = await getParkingData();
    const matches = searchMatches(data.parkingList, keyword);
    return { keyword, count: matches.length, parkingList: matches.map(summarize), warnings: data.warnings };
}
