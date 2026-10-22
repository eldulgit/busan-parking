import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { normalize } from './parkingApi.js';
import { searchParking } from './tools/searchParking.js';
import { findAvailableParking } from './tools/findAvailableParking.js';
import { getParkingDetail } from './tools/getParkingDetail.js';

const server = new McpServer({ name: 'busan-parking', version: '6.2.0' });
const keyword = z.string().trim().min(1).max(100).refine(value => normalize(value).length > 0, '검색어를 입력하세요.');
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
async function result(run: () => Promise<object>) {
    try {
        const data = await run();
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
    } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '주차정보 조회 실패' }] };
    }
}
server.registerTool('search_parking', {
    description: '부산 공영주차장을 이름 또는 이름 일부로 검색합니다. 앞부분 일치를 우선하며 공백·괄호·쉼표 차이를 정리합니다.',
    inputSchema: { keyword }, annotations
}, ({ keyword }) => result(() => searchParking(keyword)));
server.registerTool('find_available_parking', {
    description: '이름 검색 결과를 실시간 빈자리 많은 순으로 반환합니다. 실시간 미제공·조회 불가 항목은 뒤에 표시하며 빈자리를 추측하지 않습니다.',
    inputSchema: { keyword, limit: z.number().int().min(1).max(100).default(5) }, annotations
}, ({ keyword, limit }) => result(() => findAvailableParking(keyword, limit)));
server.registerTool('get_parking_detail', {
    description: '주차장의 빈자리·총 면수·요금·운영시간·관리기관·주소·갱신시간을 조회합니다. 정확한 이름을 우선하며 복수 일치는 후보로 반환합니다. 누락 정보와 0원만으로 무료 여부를 단정하지 마세요.',
    inputSchema: { name: keyword }, annotations
}, ({ name }) => result(() => getParkingDetail(name)));
await server.connect(new StdioServerTransport());
