// Cloudflare Pages Functions가 정상 작동하는지 확인하는 함수입니다.
// 배포 후 /api/health 주소로 접속하면 JSON 응답을 볼 수 있습니다.
// 공공데이터 API 연결 함수는 이후 이 폴더에 추가합니다.

export function onRequestGet(context) {
    const serviceKey = context.env.SERVICE_KEY;

    if (!serviceKey) {
        return new Response(
            JSON.stringify({
                message: "인증키가 설정되지 않았습니다."
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json; charset=utf-8"
                }
            }
        );
    }

    return new Response(
        JSON.stringify({
            message: "서버 연결 및 인증키 설정 확인 완료"
        }),
        {
            headers: {
                "Content-Type": "application/json; charset=utf-8"
            }
        }
    );
}