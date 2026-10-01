const parkingList = document.querySelector("#parking-list");
const statusMessage = document.querySelector("#status-message");
const reloadButton = document.querySelector("#reload-button");

async function loadParkingList() {
    reloadButton.disabled = true;
    parkingList.replaceChildren();
    parkingList.setAttribute("aria-busy", "true");
    statusMessage.textContent = "주차장 목록을 불러오는 중입니다.";

    try {
        // 인증키 없이 우리 서버에 요청합니다. 공공 API 호출은 parking.js가 담당합니다.
        const response = await fetch("/api/parking", {
            signal: AbortSignal.timeout(20000)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "조회에 실패했습니다.");

        for (const parking of data.parkingList) {
            const card = document.createElement("article");
            card.className = "parking-card";
            const name = document.createElement("h3");
            name.textContent = parking.name || "이름 없음";
            const code = document.createElement("p");
            code.textContent = `주차장 코드: ${parking.code || "정보 없음"}`;
            card.append(name, code);
            parkingList.append(card);
        }

        statusMessage.textContent = data.parkingList.length
            ? `총 ${data.totalCount}곳 중 ${data.parkingList.length}곳을 표시합니다. (1페이지)`
            : "제공된 주차장 정보가 없습니다.";
    } catch (error) {
        statusMessage.textContent = error.name === "TimeoutError"
            ? "조회 시간이 초과되었습니다. 다시 시도해 주세요."
            : error.message;
    } finally {
        reloadButton.disabled = false;
        parkingList.setAttribute("aria-busy", "false");
    }
}

reloadButton.addEventListener("click", loadParkingList);
loadParkingList();
