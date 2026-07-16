const pipelineState = {
    status: "Idle", 
    pipelineId: null,
    currentStage: null,
    currentCompany: null,
    progress: "",
    elapsedTime: 0,
    estimatedRemainingTime: 0,
    currentAiProvider: null,
    lastRunDuration: 0,
    jobsScraped: 0,
    jobsEvaluated: 0,
    jobsMatched: 0,
    lastRunTime: null,
    nextRunTime: null,
    message: "",
    geminiStatus: "Ready",
    geminiReason: null,
    groqStatus: "Ready",
    groqReason: null
};

module.exports = pipelineState;
