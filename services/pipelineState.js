const pipelineState = {
    status: "Idle", 
    lastRunDuration: 0,
    jobsScraped: 0,
    jobsEvaluated: 0,
    jobsMatched: 0,
    lastRunTime: null,
    nextRunTime: null,
    message: ""
};

module.exports = pipelineState;
