import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const pause=()=>new Promise(r=>setTimeout(r,15));
async function setup({speech=true,gpsError=false,extraRows=[]}={}){
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const dom=new JSDOM(html,{url:'https://parking.test/',runScripts:'outside-only'});const w=dom.window;
    const requests=[];
    const rows=Array.from({length:6},(_,i)=>({id:String(i),name:`주차장${i}`,address:'부산',xCdnt:35+i*.01,yCdnt:129,liveStatus:'available',live:{available:i===5?99:i,total:100,occupied:100-i}}));
    rows.push(...extraRows);
    Object.defineProperty(w,'isSecureContext',{value:true});
    w.AbortSignal=AbortSignal;
    w.fetch=async(url,options)=>{requests.push({url,body:options?.body});return {ok:true,json:async()=>url==='/api/parking'?{parkingList:rows,warnings:[]}:{success:true,summary:'조건으로 1곳을 찾았습니다.',parkingList:[rows[0]]}};};
    let gpsCount=0;
    Object.defineProperty(w.navigator,'geolocation',{value:{getCurrentPosition:resolve=>{gpsCount++;setTimeout(()=>resolve({coords:{latitude:35,longitude:129}}),0);}}});
    if(gpsError)Object.defineProperty(w.navigator.geolocation,'getCurrentPosition',{value:(_resolve,reject)=>{gpsCount++;reject({code:1});}});
    if(speech){w.SpeechRecognition=class{start(){w.mockRecognition=this;this.onstart();}stop(){this.onend();}abort(){this.onerror({error:'aborted'});}};}
    w.eval(readFileSync(new URL('../location.js',import.meta.url),'utf8'));
    w.eval(readFileSync(new URL('../script.js',import.meta.url),'utf8'));
    await pause();
    return {dom,w,requests,gpsCount:()=>gpsCount};
}
test('GPS nearest 5, availability sorting within those 5, refresh retains GPS; text resets',async()=>{
    const s=await setup();const d=s.w.document;
    assert.equal(s.gpsCount(),0);
    d.querySelector('#location-button').click();await pause();
    assert.equal(s.gpsCount(),1);assert.equal(d.querySelectorAll('#parking-list .parking-card').length,5);
    assert.match(d.querySelector('.distance-badge').textContent,/직선거리/);
    d.querySelector('#available-sort').click();assert.equal(d.querySelector('#parking-list h2').textContent,'주차장4');
    d.querySelector('#reload-button').click();await pause();assert.equal(d.querySelector('#parking-list h2').textContent,'주차장4');
    assert.ok(!s.requests.some(r=>r.body?.includes('latitude')));
    const input=d.querySelector('#search-input');input.value='주차장5';input.dispatchEvent(new s.w.Event('input'));
    assert.equal(d.querySelectorAll('#parking-list .parking-card').length,1);assert.equal(d.querySelector('#default-sort').textContent,'기본순');
    s.dom.window.close();
});
test('AI text request uses existing card and always re-enables send',async()=>{
    const s=await setup();const d=s.w.document;d.querySelector('#ai-input').value='화명역 요금 알려줘';
    d.querySelector('#ai-form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await pause();
    assert.equal(d.querySelectorAll('#ai-parking-list .parking-card').length,1);assert.equal(d.querySelector('#ai-send').disabled,false);
    assert.equal(s.requests.at(-1).url,'/api/ai-parking');assert.deepEqual(JSON.parse(s.requests.at(-1).body),{message:'화명역 요금 알려줘'});
    s.dom.window.close();
});
test('Korean voice→text→AI; nearby voice→GPS without AI request',async()=>{
    const s=await setup();const d=s.w.document;
    d.querySelector('#voice-button').click();assert.equal(s.w.mockRecognition.lang,'ko-KR');assert.equal(s.w.mockRecognition.interimResults,false);assert.equal(d.querySelector('#voice-button').getAttribute('aria-pressed'),'true');
    s.w.mockRecognition.onresult({results:[[{transcript:'화명역 요금 알려줘'}]]});await pause();
    assert.equal(d.querySelector('#ai-input').value,'화명역 요금 알려줘');assert.equal(s.requests.at(-1).url,'/api/ai-parking');
    const before=s.requests.length;d.querySelector('#voice-button').click();s.w.mockRecognition.onresult({results:[[{transcript:'내 주변에서 빈자리 많은 주차장 찾아줘'}]]});await pause();
    assert.equal(s.gpsCount(),1);assert.equal(s.requests.length,before);assert.equal(d.querySelector('#parking-list h2').textContent,'주차장4');
    s.dom.window.close();
});
test('permission refusal, unsupported speech and microphone errors preserve search',async()=>{
    const s=await setup({speech:false,gpsError:true});const d=s.w.document;
    d.querySelector('#location-button').click();await pause();assert.match(d.querySelector('#location-message').textContent,/위치 권한/);
    d.querySelector('#voice-button').click();assert.match(d.querySelector('#voice-status').textContent,/지원하지/);
    assert.equal(d.querySelectorAll('#parking-list .parking-card').length,6);s.dom.window.close();
    const v=await setup();v.w.document.querySelector('#voice-button').click();v.w.mockRecognition.onerror({error:'not-allowed'});
    assert.match(v.w.document.querySelector('#voice-status').textContent,/마이크 권한/);assert.equal(v.w.document.querySelector('#voice-button').getAttribute('aria-pressed'),'false');v.dom.window.close();
});

test('unknown zone entries are excluded and normal search is preserved',async()=>{
    const s=await setup({extraRows:[
        {name:'3구역 2소',address:'기장군 기장읍 38-0',capacity:30,liveStatus:'unsupported'},
        {name:'사하구 주소시험',address:'부산 사하구 괴정동 123-4',liveStatus:'unsupported'}
    ]});
    const cards=[...s.w.document.querySelectorAll('#parking-list .parking-card')];
    assert.ok(!cards.some(p=>p.querySelector('h2').textContent==='3구역 2소'));
    const normal=cards.find(p=>p.querySelector('h2').textContent==='사하구 주소시험');
    assert.match(decodeURIComponent(normal.querySelector('a.map-link').href),/사하구 괴정동 123-4/);
    const coordinateCard=cards.find(p=>p.querySelector('h2').textContent==='주차장0');
    assert.match(coordinateCard.querySelector('a.map-link').href,/link\/map\/.*35,129/);
    const input=s.w.document.querySelector('#search-input');input.value='사하';input.dispatchEvent(new s.w.Event('input'));
    assert.equal(s.w.document.querySelectorAll('#parking-list .parking-card').length,1);
    s.dom.window.close();
});
