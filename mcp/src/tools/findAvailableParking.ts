import { searchParking } from './searchParking.js';
export async function findAvailableParking(keyword: string, limit = 5) {
    const result = await searchParking(keyword);
    const sorted = result.parkingList.sort((a, b) => (b.curravacnt ?? -1) - (a.curravacnt ?? -1));
    return { ...result, totalMatches: result.count, count: Math.min(limit, sorted.length), parkingList: sorted.slice(0, limit) };
}
