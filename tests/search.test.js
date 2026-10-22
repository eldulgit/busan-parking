import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interpretLocal, validateConditions, selectParking, answerRequest, interpretGemini, onRequestPost } from '../functions/api/ai-parking.js';
import { mergeParking } from '../functions/api/parking.js';
const data={parkingList:[
    {name:'화명역',address:'부산 북구',liveStatus:'available',live:{available:15,total:37}},
    {name:'부산대역(남측)',liveStatus:'available',live:{available:25,total:50}},
    {name:'부산대역(북측)',liveStatus:'available',live:{available:0,total:10}},
    {name:'부산대 미제공',liveStatus:'unsupported'}
],warnings:['일부 데이터 갱신 지연']};
test('document examples use local parsing without a Gemini dependency',async()=>{
    for(const [message,keyword,intent,min,limit] of [
        ['화명역 주차장을 찾아줘','화명역','search_parking',null,5],
        ['부산대에서 빈자리 10대 이상인 곳 3개만 찾아','부산대','find_available_parking',10,3],
        ['부산대에서 제일 여유 있는 곳 알려줘','부산대','find_available_parking',null,1],
        ['화명역 주차장 요금과 운영시간 알려줘','화명역','get_parking_detail',null,5],
        ['빈자리 10대 이상인 곳 3개만 찾아줘','','find_available_parking',10,3]
    ]){
        const {confident,info}=interpretLocal(message);assert.equal(confident,true,message);assert.equal(info.keyword,keyword);assert.equal(info.intent,intent);assert.equal(info.minAvailable,min);assert.equal(info.limit,limit);
        const result=await answerRequest(message,{},async()=>data,{fetchImpl:()=>{throw Error('must not call Gemini');}});assert.equal(result.localRuleUsed,true);
    }
});
test('conditions, missing/zero values, names and duplicate candidates',()=>{
    const query=validateConditions({intent:'find_available_parking',keyword:'부산대',limit:100,minAvailable:0});assert.equal(query.limit,20);
    const r=selectParking(data.parkingList,query);assert.deepEqual(r.parkingList.map(p=>p.live.available),[25,0]);
    const all=selectParking(data.parkingList,validateConditions({intent:'find_available_parking',keyword:'부산대'}));assert.equal(all.parkingList.at(-1).name,'부산대 미제공');
    const ambiguous=selectParking([...data.parkingList,{...data.parkingList[0],address:'다른 주소'}],validateConditions({intent:'get_parking_detail',name:'화명역 주차장'}));assert.equal(ambiguous.needClarification,true);assert.equal(ambiguous.totalMatches,2);
    assert.equal(selectParking(data.parkingList,validateConditions({intent:'get_parking_detail',name:'화명역 주차장'})).parkingList.length,1);
    assert.equal(selectParking(data.parkingList,validateConditions({intent:'search_parking',keyword:'없는주차장123'})).parkingList.length,0);
    assert.throws(()=>validateConditions({intent:'delete'}));assert.throws(()=>validateConditions({intent:'search_parking',limit:'NaN'}));
});
test('unrelated requests clarify; complex requests use actual Gemini JSON path',async()=>{
    const unrelated=await answerRequest('오늘 점심 뭐 먹을까',{},async()=>{throw Error('must not fetch');});assert.equal(unrelated.needClarification,true);
    let called=0;
    const r=await answerRequest('화명에서 잠깐 차를 둘 만한 장소가 있을까',{GEMINI_API_KEY:'secret'},async()=>data,{fetchImpl:async(_url,options)=>{
        called++;assert.ok(!options.body.includes('latitude'));return Response.json({candidates:[{content:{parts:[{thought:true,text:'hidden'},{text:JSON.stringify({intent:'search_parking',keyword:'화명',limit:2})}]}}]});
    }});assert.equal(called,1);assert.equal(r.parkingList[0].name,'화명역');assert.equal(r.localRuleUsed,false);
});
test('temporary Gemini overload retries twice and gives Korean fallback',async()=>{
    let calls=0,waits=0;
    const r=await answerRequest('편안하게 차를 둘 만한 데가 어딜까',{GEMINI_API_KEY:'secret'},async()=>data,{fetchImpl:async()=>{calls++;return Response.json({error:{message:'high demand secret'}},{status:503});},pause:async()=>{waits++;}});
    assert.equal(calls,3);assert.equal(waits,2);assert.match(r.summary,/요청이 몰려/);assert.ok(!JSON.stringify(r).includes('secret'));
});
test('invalid Gemini schema, empty response, HTTP validation',async()=>{
    await assert.rejects(()=>interpretGemini('복잡한 요청',{GEMINI_API_KEY:'k'},{fetchImpl:async()=>Response.json({candidates:[]})}));
    const context=message=>({env:{},request:new Request('https://example.test/api/ai-parking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})})});
    assert.equal((await onRequestPost(context(''))).status,400);assert.equal((await onRequestPost(context('x'.repeat(1001)))).status,400);
});
test('coordinate integrity, swapped values, Haversine and nearest five',()=>{
    const context={};vm.createContext(context);vm.runInContext(readFileSync(new URL('../location.js',import.meta.url),'utf8'),context);
    const loc=context.ParkingLocation;
    assert.equal(loc.coordinates({xCdnt:'',yCdnt:'129'}),null);assert.equal(loc.coordinates({xCdnt:'-',yCdnt:'129'}),null);
    assert.equal(loc.coordinates({xCdnt:'129',yCdnt:'35'}).latitude,35);assert.equal(loc.coordinates({xCdnt:'999',yCdnt:'35'}),null);
    assert.equal(loc.distance({latitude:35,longitude:129},{latitude:35,longitude:129}),0);
    const list=Array.from({length:6},(_,i)=>({name:`P${i}`,xCdnt:35+i*.01,yCdnt:129}));
    assert.equal(loc.nearest(list,{latitude:35,longitude:129}).length,5);assert.equal(loc.nearest(list,{latitude:35,longitude:129})[0].name,'P0');
    assert.equal(loc.format(.42),'420m');assert.equal(loc.format(1.84),'1.8km');
    const merged=mergeParking([{mgntNum:'a',pkNam:'좌표시험',xCdnt:'35.1',yCdnt:'129.1'}],[],[]);assert.equal(merged[0].xCdnt,'35.1');
});
