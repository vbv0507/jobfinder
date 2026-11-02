const emitTelegramUpdate = async () => {
    const socketService = require("./socketService");
    const payload = await socketService.buildDashboardPayload();
    socketService.emitTelegram(payload.telegram);
};

const refreshTelegramView = (errorMessage) => {
    emitTelegramUpdate().catch((error) => {
        console.error(errorMessage, error.message);
    });
};

module.exports = { refreshTelegramView };
