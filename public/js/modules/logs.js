import { createSocket } from './socketClient.js';

let socket = null;
let allLogs = [];

document.addEventListener('DOMContentLoaded', () => {
    initSocket();
});

async function initSocket() {
    try {
        socket = await createSocket();
    } catch (error) {
        console.error(error);
        return;
    }

    socket.on('dashboard:init', (payload) => {
        if (payload.pipeline && payload.pipeline.logs) {
            allLogs = [...payload.pipeline.logs];
            renderLogs(allLogs);
        }
    });

    socket.on('logs:init', (logs) => {
        allLogs = [...(logs || [])];
        renderLogs(allLogs);
    });

    socket.on('logs:new', (logEntry) => {
        allLogs.unshift(logEntry);
        if (allLogs.length > 500) allLogs.pop();
        renderLogs(allLogs);
    });



    // Request refresh immediately after listeners are attached
    socket.emit('dashboard:refresh');
}

function renderLogs(logs) {
    const container = document.getElementById('logs-container');
    if (!container) return;

    const displayLogs = [...logs].reverse();
    const html = displayLogs.map(log => {
        const time = new Date(log.time).toISOString();
        let level = String(log.level || 'INFO').padEnd(4, ' ');
        let colorClass = 'text-primary';
        let bgClass = '';

        if (log.level === 'ERROR') {
            level = 'ERR ';
            colorClass = 'text-error';
            bgClass = 'bg-error/10 border border-error/20';
        } else if (log.level === 'WARNING') {
            level = 'WARN';
            colorClass = 'text-warning';
        } else if (log.level === 'SUCCESS') {
            level = 'SUCC';
            colorClass = 'text-success';
        }

        return `
        <div class="flex items-start gap-3 hover:bg-white/5 py-0.5 rounded px-1 transition-colors ${bgClass}">
            <span class="text-textMuted shrink-0 w-[160px] sticky left-0 bg-transparent">[${time}]</span>
            <span class="${colorClass} font-bold shrink-0 w-12">[${level}]</span>
            <span class="text-textMain break-all ${colorClass}">${log.message}</span>
        </div>`;
    }).join('');

    const wasScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
    container.innerHTML = html || '<p class="text-textMuted text-center p-4">Waiting for log stream...</p>';

    const autoScroll = document.querySelector('input[type="checkbox"]')?.checked ?? true;
    if (autoScroll && wasScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}
