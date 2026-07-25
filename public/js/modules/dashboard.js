import { createSocket } from './socketClient.js';

let isRunning = false;
let charts = {};
let currentMetrics = {};
let socket = null;

document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    initButtons();
    initCharts();
});

async function initSocket() {
    try {
        socket = await createSocket();
    } catch (error) {
        console.error(error);
        updateConnectionStatus("Disconnected");
        return;
    }

    // Connection Status handling
    socket.on('connect', () => {
        updateConnectionStatus("🟢 Connected");
        // Ask for the current state to avoid missing init payloads sent prior to listener attachment
        socket.emit('dashboard:refresh');
    });
    socket.on('disconnect', () => updateConnectionStatus("Disconnected"));
    socket.on('connect_error', () => updateConnectionStatus("Reconnecting"));

    socket.on('dashboard:init', (payload) => {
        currentMetrics = payload.metrics || {};
        updateDOM(payload);
        updateButtons(payload.pipeline?.running);
        updateCharts(payload.charts || {});
    });

    socket.on('dashboard:update', (payload) => {
        if (payload.metrics) currentMetrics = payload.metrics;
        updateDOM(payload);
        updateCharts(payload.charts || {});
    });

    socket.on('pipeline:update', (payload) => {
        updateDOM(payload);
        updateButtons(payload.pipeline?.running);
    });

    socket.on('pipeline:init', (pipeline) => {
        updateDOM({ pipeline });
        updateButtons(pipeline?.running);
    });

    socket.on('analytics:update', (payload) => {
        currentMetrics = payload.metrics || currentMetrics;
        updateDOM({ metrics: currentMetrics });
        updateCharts(payload.charts || {});
    });
    
    socket.on('validation_funnel_update', (payload) => {
        // payload = { company, funnel: { parsed, duplicate, ..., passed, aiEvaluated, aiRejected, matched, saved } }
        updateFunnelChart(payload.company, payload.funnel);
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

    socket.on('pipeline:error', (payload) => {
        updateConnectionStatus(payload?.message || payload || "Pipeline error");
        isRunning = false;
        updateButtons(false);
    });
}

function updateConnectionStatus(text) {
    const el = document.getElementById('socket-status');
    if (el) el.innerText = text;
}

function updateDOM(data) {
    if (data.metrics) currentMetrics = data.metrics;

    const pipeline = data.pipeline || {};
    const metrics = currentMetrics;

    const aiSuccessRate = metrics["AI Evaluations"] > 0
        ? Math.round((metrics["Matched Jobs"] / metrics["AI Evaluations"]) * 100)
        : 100;

    const cacheHitRate = metrics["Actually Scraped"] > 0 || metrics["Cached Companies"] > 0
        ? Math.round((metrics["Cached Companies"] / ((metrics["Actually Scraped"] || 0) + (metrics["Cached Companies"] || 0))) * 100)
        : 0;

    const totalScraped = metrics["Actually Scraped"] || 0;
    const successful = metrics["Successful Companies"] || 0;
    const healthScore = totalScraped > 0 ? Math.round((successful / totalScraped) * 100) : 100;

    const statsMap = {
        'stat-health-score': healthScore + "%",
        'stat-health-trend': healthScore >= 90 ? 'Healthy' : (healthScore >= 70 ? 'Degraded' : 'Critical'),
        'stat-ai-accuracy': aiSuccessRate + '%',
        'stat-cache-hit': (isNaN(cacheHitRate) ? 0 : cacheHitRate) + '%',
        'stat-discovery-success': metrics["Recovered Nodes"] > 0 ? "100%" : "N/A",

        // Live Pipeline Stats
        'metric-companies': pipeline.running ? `${pipeline.companyIndex} / ${pipeline.totalCompanies}` : (pipeline.totalCompanies || metrics["Actually Scraped"]),
        'metric-jobs': pipeline.running ? pipeline.jobsFound : (metrics["Raw Jobs"] || 0),
        'metric-matched': pipeline.running ? pipeline.matchedJobs : (metrics["Matched Jobs"] || 0),
        'metric-ai-eval': metrics["AI Evaluations"] || 0,

        'metric-healthy': metrics["Successful Companies"] || 0,
        'metric-failed': metrics["Failed Companies"] || 0,
        'metric-parser-err': metrics["Parser Failures"] || 0,
        'metric-ats-changed': metrics["ATS Changed"] || 0,

        'metric-cached': data.cache ? (data.cache.cachedCompanies || 0) : (metrics["Cached Companies"] || 0),
        'metric-scraped': metrics["Actually Scraped"] || 0,
        'metric-retry': pipeline.running ? pipeline.retryCount : (metrics["Recovered Nodes"] || 0),
        'metric-recovered': metrics["Recovered Nodes"] || 0,

        'metric-cf-blocks': metrics["Cloudflare Blocks"] || 0,
        'metric-headers': 'Live',
        'metric-axios': 'Live',
        'metric-puppeteer': pipeline.running ? 'Active' : 'Ready',

        'metric-savings': data.cache ? (data.cache.cacheSavings / 1000).toFixed(1) + 's' : ((metrics["Cached Companies"] || 0) * 4.5).toFixed(1) + 's',
        'metric-avg-run': pipeline.running ? ((pipeline.elapsedTime || 0) / 1000).toFixed(1) + 's' : (metrics["Average Runtime"] ? (metrics["Average Runtime"] / 1000).toFixed(1) + 's' : '0s'),
        'metric-avg-comp': metrics["Average Company Time"] ? (metrics["Average Company Time"] / 1000).toFixed(1) + 's' : '0s'
    };

    for (const [id, val] of Object.entries(statsMap)) {
        const el = document.getElementById(id);
        if (el && el.innerText !== String(val)) {
            el.innerText = val;
        }
    }
}

function updateButtons(running) {
    const btnRun = document.getElementById('btn-run');
    const btnForce = document.getElementById('btn-force');
    const btnStop = document.getElementById('btn-stop');

    if (!btnRun || !btnForce || !btnStop) return;

    isRunning = !!running;
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
    const ctx3 = document.getElementById('chart-validation-funnel');

    if (ctx1 && window.Chart) {
        charts.runtime = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Jobs Found',
                    data: [],
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
                labels: ['Live'],
                datasets: [{
                    label: 'Cached',
                    data: [0],
                    backgroundColor: '#f59e0b',
                }, {
                    label: 'Scraped',
                    data: [0],
                    backgroundColor: '#3b82f6',
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }

    if (ctx3 && window.Chart) {
        charts.funnel = new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: ['Parsed', 'Passed', 'Matched'],
                datasets: [{
                    label: 'Jobs',
                    data: [0, 0, 0],
                    backgroundColor: ['#94a3b8', '#3b82f6', '#22c55e']
                }]
            },
            options: { 
                indexAxis: 'y',
                responsive: true, 
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

function updateCharts(chartData) {
    if (charts.runtime && chartData.dailyTrend) {
        charts.runtime.data.labels = chartData.dailyTrend.map(item => item._id);
        charts.runtime.data.datasets[0].data = chartData.dailyTrend.map(item => item.jobsFound || 0);
        charts.runtime.update();
    }

    if (charts.cache && currentMetrics) {
        charts.cache.data.datasets[0].data = [currentMetrics["Cached Companies"] || 0];
        charts.cache.data.datasets[1].data = [currentMetrics["Actually Scraped"] || 0];
        charts.cache.update();
    }
}

// Global function to update funnel chart
window.updateFunnelChart = function(companyName, funnelData) {
    if (!charts.funnel) return;
    
    const nameEl = document.getElementById('funnel-company-name');
    if (nameEl) nameEl.innerText = companyName;

    charts.funnel.data.labels = [
        'Parsed', 
        'Valid (Pre-AI)', 
        'AI Rejected',
        'AI Matched'
    ];
    
    charts.funnel.data.datasets[0].data = [
        funnelData.parsed || 0,
        funnelData.passed || 0,
        funnelData.aiRejected || 0,
        funnelData.matched || 0
    ];
    
    charts.funnel.data.datasets[0].backgroundColor = [
        '#64748b', // Parsed (gray)
        '#3b82f6', // Valid (blue)
        '#ef4444', // AI Rejected (red)
        '#22c55e'  // AI Matched (green)
    ];

    charts.funnel.update();
};
