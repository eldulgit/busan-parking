import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 실제 MCP STDIO 연결을 거쳐 도구 목록·입력 검증·API 연동을 확인합니다.
test('V6.2 MCP tools over stdio', async () => {
    let mode = 'ok';
    const fixture = [
        { name: '화명역', address: '부산 북구', liveStatus: 'available', live: { available: 5, total: 37, occupied: 32 }, basicMinutes: 10, basicFee: 100 },
        { name: '화명역(남측)', liveStatus: 'available', live: { available: 0, total: 10 } },
        { name: '신화명', liveStatus: 'available', live: { available: 12, total: 20 } },
        { name: '화명 미제공', liveStatus: 'unavailable', live: { available: 99 } },
        { name: '중복', address: '주소1' }, { name: '중복', address: '주소2' }
    ];
    const http = createServer((_req, res) => {
        if (mode === 'error') { res.writeHead(502); res.end('bad gateway'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(mode === 'invalid' ? {} : mode === 'native' ? { success: true, items: [{ parknm: '화명역', curravacnt: 0, maxcnt: 37, parkingcnt: 37, tenMin: '100', pkBascTime: '10', svcSrtTe: '08:00', svcEndTe: '20:00', doroAddr: '-', jibunAddr: '북구 화명2동', guNm: '북구청' }] } : { parkingList: fixture, warnings: ['일부 제공기관 조회 지연'] }));
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    const client = new Client({ name: 'verification', version: '1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/index.ts'], env: { ...process.env as Record<string, string>, PARKING_API_URL: `http://127.0.0.1:${address.port}/api/parking` } });
    try {
        await client.connect(transport);
        assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['find_available_parking', 'get_parking_detail', 'search_parking']);
        const call = async (name: string, args: Record<string, unknown>) => {
            const result = await client.callTool({ name, arguments: args });
            assert.ok(!result.isError, JSON.stringify(result));
            return result.structuredContent as any;
        };
        const search = await call('search_parking', { keyword: '화 명 역（남측）' });
        assert.equal(search.count, 1);
        const prefix = await call('search_parking', { keyword: '화명' });
        assert.equal(prefix.parkingList.at(-1).name, '신화명');
        assert.equal(prefix.warnings.length, 1);
        const available = await call('find_available_parking', { keyword: '화명', limit: 4 });
        assert.deepEqual(available.parkingList.map((p: any) => p.curravacnt), [12, 5, 0, null]);
        assert.equal((await call('find_available_parking', { keyword: '화명', limit: 1 })).count, 1);
        const detail = await call('get_parking_detail', { name: '화명역' });
        assert.equal(detail.status, 'found'); assert.equal(detail.parking.basicFee, 100);
        assert.equal((await call('get_parking_detail', { name: '중복' })).status, 'ambiguous');
        assert.equal((await call('get_parking_detail', { name: '없음' })).status, 'not_found');
        for (const args of [{ keyword: '' }, { keyword: '() , ' }]) assert.equal((await client.callTool({ name: 'search_parking', arguments: args })).isError, true);
        assert.equal((await client.callTool({ name: 'find_available_parking', arguments: { keyword: '화명', limit: 0 } })).isError, true);
        mode = 'native'; const native = await call('get_parking_detail', { name: '화명역' }); assert.equal(native.parking.curravacnt, 0); assert.equal(native.parking.basicFee, 100); assert.equal(native.parking.address, '북구 화명2동'); mode = 'error'; assert.equal((await client.callTool({ name: 'search_parking', arguments: { keyword: '화명' } })).isError, true);
        mode = 'invalid'; assert.equal((await client.callTool({ name: 'search_parking', arguments: { keyword: '화명' } })).isError, true);
    } finally { await client.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
});
