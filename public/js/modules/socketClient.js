let socketPromise = null;

const waitForClerk = async () => {
    for (let i = 0; i < 40 && !window.Clerk; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window.Clerk) return null;
    await window.Clerk.load();
    return window.Clerk;
};

export async function createSocket() {
    if (socketPromise) return socketPromise;

    socketPromise = (async () => {
        if (!window.io) {
            throw new Error("Socket.IO client is not loaded.");
        }

        const clerk = await waitForClerk();
        const token = clerk?.session ? await clerk.session.getToken() : null;

        const socket = window.io({
            auth: { token },
            transports: ["websocket", "polling"],
            upgrade: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
            timeout: 20000
        });

        socket.io.on("reconnect", () => {
            console.info("[Socket] Reconnected");
        });

        socket.on("connect_error", async (error) => {
            console.warn("[Socket] Connection error:", error.message);
            if (error.message === "Unauthorized" && clerk?.session) {
                socket.auth.token = await clerk.session.getToken({ skipCache: true });
                socket.connect();
            }
        });

        return socket;
    })();

    return socketPromise;
}
