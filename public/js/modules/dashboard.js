// dashboard.js
let isRunning = false;
let charts = {};
let currentMetrics = {};
let socket = null;

document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    initButtons();
    initCharts();
});

function initSocket() {
    if (!window.io) {
        console.error("Socket.IO not loaded!");
        return;
    }

    socket = io();

    // Connection Status handling
    socket.on('connect', () => {
        updateConnectionStatus("🟢 Connected");
    });
    
    socket.on('disconnect', () => {
        updateConnectionStatus("🔴 Disconnected");
    });
    
    socket.on('connect_error', () => {
        updateConnectionStatus("🟡 Reconnecting");
    });

    // Event Listeners
    socket.on('dashboard:init', (payload) => {
        currentMetrics = payload.metrics || {};
        updateDOM(payload);
        updateButtons(payload.pipeline?.running);
    });

    socket.on('dashboard:update', (payload) => {
        if (payload.metrics) currentMetrics = payload.metrics;
        updateDOM(payload);
    });

    socket.on('telemetry:update', (payload) => {
        updateDOM(payload);
        updateButtons(payload.pipeline?.running);
    });

    socket.on('pipeline:started', () => {
        isRunning = true;
        updateButtons(true);
    });

    socket.on('pipeline:finished', () => {
        isRunning = false;
        updateButtons(false);
    });

    socket.on('pipeline:stopped', () => {
        isRunning = false;
        updateButtons(false);
    });
}

function updateConnectionStatus(text) {
    const el = document.getElementById('socket-status');
    if (el) el.innerText = text;
}

function updateDOM(data) {
    const pipeline = data.pipeline || {};
    const metrics = currentMetrics; // merge from latest metrics

    const aiSuccessRate = metrics["AI Evaluations"] > 0 
        ? Math.round((metrics["Matched Jobs"] / metrics["AI Evaluations"]) * 100) 
        : 100;
        
    const cacheHitRate = metrics["Actually Scraped"] > 0 || metrics["Cached Companies"] > 0
        ? Math.round((metrics["Cached Companies"] / ((metrics["Actually Scraped"] || 0) + (metrics["Cached Companies"] || 0))) * 100) 
        : 0;

    const statsMap = {
        'stat-health-score': "100%", // Simplified for live view
        'stat-health-trend': 'Online',
        'stat-ai-accuracy': aiSuccessRate + '%',
        'stat-cache-hit': (isNaN(cacheHitRate) ? 0 : cacheHitRate) + '%',
        'stat-discovery-success': metrics["Recovered Nodes"] > 0 ? "100%" : "N/A",
        
        // Live Pipeline Stats
        'metric-companies': pipeline.running ? `${pipeline.companyIndex} / ${pipeline.totalCompanies}` : (pipeline.totalCompanies || metrics["Actually Scraped"]),
        'metric-jobs': pipeline.running ? pipeline.jobsFound : (metrics["Raw Jobs"] || 0),
        'metric-matched': pipeline.running ? pipeline.matchedJobs : (metrics["Matched Jobs"] || 0),
        'metric-ai-eval': metrics["AI Evaluations"] || 0,
        
        'metric-healthy': (metrics["Actually Scraped"] - metrics["Parser Failures"] - metrics["Validation Failures"]) || 0,
        'metric-failed': (metrics["Parser Failures"] + metrics["Validation Failures"]) || 0,
        'metric-parser-err': metrics["Parser Failures"] || 0,
        'metric-ats-changed': metrics["ATS Changed"] || 0,
        
        'metric-cached': metrics["Cached Companies"] || 0,
        'metric-scraped': metrics["Actually Scraped"] || 0,
        'metric-retry': pipeline.running ? pipeline.retryCount : (metrics["Recovered Nodes"] || 0),
        'metric-recovered': metrics["Recovered Nodes"] || 0,
        
        'metric-cf-blocks': metrics["Cloudflare Blocks"] || 0,
        'metric-headers': 'Live',
        'metric-axios': 'Live',
        'metric-puppeteer': 'Active',
        
        'metric-savings': (metrics["Cached Companies"] * 4.5).toFixed(1) + 's',
        'metric-avg-run': pipeline.running ? (pipeline.elapsedTime / 1000).toFixed(1) + 's' : (metrics["Average Runtime"] ? (metrics["Average Runtime"] / 1000).toFixed(1) + 's' : '0s'),
        'metric-avg-comp': metrics["Average Company Time"] ? (metrics["Average Company Time"] / 1000).toFixed(1) + 's' : '0s'
    };

    for (const [id, val] of Object.entries(statsMap)) {
        const el = document.getElementById(id);
        if (el && el.innerText != val) {
            el.innerText = val; // Only update DOM if value actually changed
        }
    }
}

function updateButtons(running) {
    const btnRun = document.getElementById('btn-run');
    const btnForce = document.getElementById('btn-force');
    const btnStop = document.getElementById('btn-stop');
    
    if (!btnRun || !btnForce || !btnStop) return;

    if (running) {
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Running...';
        btnForce.disabled = true;
        btnStop.disabled = false;
    } else {
        btnRun.disabled = false;
        btnRun.innerHTML = '<i class="fa-solid fa-play mr-2"></i> Run Pipeline';
        btnForce.disabled = false;
        btnStop.disabled = true;
    }
}

function initButtons() {
    const btnRun = document.getElementById('btn-run');
    const btnForce = document.getElementById('btn-force');
    const btnStop = document.getElementById('btn-stop');
    
    if (btnRun) {
        btnRun.addEventListener('click', () => {
            if (socket) socket.emit('pipeline:start', false);
        });
    }

    if (btnForce) {
        btnForce.addEventListener('click', () => {
            if (socket) socket.emit('pipeline:start', true);
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => {
            if (socket) socket.emit('pipeline:stop');
        });
    }
}

function initCharts() {
    const ctx1 = document.getElementById('chart-pipeline-runtime');
    const ctx2 = document.getElementById('chart-cache-hit');
    
    if (ctx1 && window.Chart) {
        charts.runtime = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: ['Run 1', 'Run 2', 'Run 3', 'Run 4', 'Run 5'],
                datasets: [{
                    label: 'Runtime (s)',
                    data: [120, 115, 10, 14, 110],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    if (ctx2 && window.Chart) {
        charts.cache = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: ['Run 1', 'Run 2', 'Run 3'],
                datasets: [{
                    label: 'Cached',
                    data: [0, 96, 0],
                    backgroundColor: '#f59e0b',
                }, {
                    label: 'Scraped',
                    data: [96, 0, 96],
                    backgroundColor: '#3b82f6',
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }
}
