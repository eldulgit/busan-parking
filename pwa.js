(() => {
    const panel = document.querySelector("#install-panel");
    const button = document.querySelector("#install-button");
    const message = document.querySelector("#install-message");
    const connection = document.querySelector("#connection-message");
    const standalone = window.matchMedia("(display-mode: standalone)");
    let installedThisSession = false;
    const isInstalled = () => installedThisSession || standalone.matches || navigator.standalone === true;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    let installPrompt = null;

    function syncInstallPanel() {
        panel.hidden = isInstalled() || (!installPrompt && !isIOS);
        button.hidden = !installPrompt || isInstalled();
        message.textContent = installPrompt
            ? "홈 화면에 추가하면 앱처럼 사용할 수 있습니다."
            : "iPhone·iPad에서는 Safari의 공유 메뉴에서 ‘홈 화면에 추가’를 선택해 주세요.";
    }
    window.addEventListener("beforeinstallprompt", event => {
        if (isInstalled()) return;
        event.preventDefault();
        installPrompt = event;
        syncInstallPanel();
    });
    button.addEventListener("click", async () => {
        if (!installPrompt) return;
        const prompt = installPrompt;
        installPrompt = null;
        button.disabled = true;
        let failed = false;
        try {
            await prompt.prompt();
            await prompt.userChoice;
        } catch (error) {
            failed = true;
        } finally {
            button.disabled = false;
            syncInstallPanel();
            if (failed && !isInstalled()) {
                panel.hidden = false;
                message.textContent = "브라우저 메뉴에서 설치 또는 홈 화면 추가를 확인해 주세요.";
            }
        }
    });
    window.addEventListener("appinstalled", () => {
        installedThisSession = true;
        installPrompt = null;
        panel.hidden = true;
        button.hidden = true;
    });
    standalone.addEventListener("change", syncInstallPanel);
    syncInstallPanel();

    function syncConnection() {
        connection.textContent = navigator.onLine ? ""
            : "오프라인 상태입니다. 실시간 주차정보는 인터넷 연결이 필요합니다. 표시된 정보가 있다면 이전 조회 결과입니다.";
    }
    window.addEventListener("offline", syncConnection);
    window.addEventListener("online", () => {
        connection.textContent = "인터넷에 다시 연결되었습니다. 정보 새로고침을 눌러 최신 현황을 확인해 주세요.";
    });
    syncConnection();

    if ("serviceWorker" in navigator && window.isSecureContext) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" })
                .catch(() => {
                    // 등록 실패가 기존 검색·조회 기능을 중단시키지 않도록 합니다.
                    console.warn("앱 설치용 파일을 등록하지 못했습니다. 다음 접속 시 다시 시도합니다.");
                });
        });
    }
})();
