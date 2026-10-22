// 위치 좌표는 브라우저 메모리에서만 사용합니다. 서버·AI로 전송하지 않습니다.
(function(root) {
    const numeric = value => value == null || String(value).trim()==='' || String(value).trim()==='-' ? null : Number.isFinite(Number(value))?Number(value):null;
    function coordinates(p) {
        let latitude=numeric(p.xCdnt),longitude=numeric(p.yCdnt);
        if(latitude===null||longitude===null)return null;
        if(Math.abs(latitude)>90&&Math.abs(latitude)<=180&&Math.abs(longitude)<=90)[latitude,longitude]=[longitude,latitude];
        if(Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))return null;
        return {latitude,longitude};
    }
    function distance(a,b) {
        const rad=v=>v*Math.PI/180;
        const lat=rad(b.latitude-a.latitude),lon=rad(b.longitude-a.longitude);
        const h=Math.sin(lat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(lon/2)**2;
        return 6371*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
    }
    function nearest(list,position,limit=5) {
        return list.flatMap(p=>{const point=coordinates(p);return point?[{...p,distanceKm:distance(position,point)}]:[];})
            .sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,limit);
    }
    function format(km) {return km<1?`${Math.round(km*1000)}m`:`${km.toFixed(1)}km`;}
    root.ParkingLocation={coordinates,distance,nearest,format};
})(globalThis);
