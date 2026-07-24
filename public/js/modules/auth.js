// auth.js
export async function initClerk() {
    window.addEventListener('load', async function () {
        try {
            if (typeof Clerk !== 'undefined') {
                await Clerk.load();
                if (Clerk.user) {
                    const userButtonDiv = document.getElementById('user-button');
                    if (userButtonDiv) {
                        userButtonDiv.innerHTML = '';
                        Clerk.mountUserButton(userButtonDiv);
                    }
                }
            }
        } catch (err) {
            console.error("Clerk init failed", err);
        }
    });
}
