const crypto = require('node:crypto');

class RunManager {
  constructor(service) {
    this.service = service;
    this.runs = new Map();
  }

  start(input) {
    const runId = crypto.randomUUID();
    const run = {
      id: runId,
      input,
      events: [],
      clients: new Set(),
      done: false,
      result: null,
      stopRequested: false,
    };

    this.runs.set(runId, run);
    this.process(run);
    setTimeout(() => this.prune(runId), 30 * 60 * 1000);
    return runId;
  }

  get(runId) {
    return this.runs.get(runId) || null;
  }

  hasActiveRuns() {
    for (const run of this.runs.values()) {
      if (!run.done) {
        return true;
      }
    }

    return false;
  }

  stop(runId) {
    const run = this.get(runId);
    if (!run) {
      return false;
    }

    run.stopRequested = true;
    return true;
  }

  addClient(runId, res) {
    const run = this.get(runId);
    if (!run) {
      return null;
    }

    run.clients.add(res);
    for (const event of run.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    return run;
  }

  removeClient(runId, res) {
    const run = this.get(runId);
    if (run) {
      run.clients.delete(res);
    }
  }

  sendEvent(run, event) {
    run.events.push(event);
    if (run.events.length > 500) {
      run.events.shift();
    }

    for (const client of run.clients) {
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  finishRun(run, result) {
    run.done = true;
    run.result = result;
    this.sendEvent(run, { type: 'done', result });
  }

  async process(run) {
    try {
      const result = await this.service.run(run.input, {
        isStopped: () => run.stopRequested,
        onProgress: (payload) => this.sendEvent(run, { type: 'progress', ...payload }),
      });
      this.finishRun(run, result);
    } catch (error) {
      this.finishRun(run, {
        ok: false,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  prune(runId) {
    const run = this.get(runId);
    if (run && run.done && run.clients.size === 0) {
      this.runs.delete(runId);
    }
  }
}

module.exports = {
  RunManager,
};
