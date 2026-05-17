(function () {
  async function readJsonResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.error || `Запрос завершился с ошибкой ${response.status}`);
    }

    return body;
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return readJsonResponse(response);
  }

  function createRunEventSource(runId, handlers) {
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'progress' && handlers.onProgress) {
        handlers.onProgress(payload);
      }

      if (payload.type === 'done' && handlers.onDone) {
        handlers.onDone(payload.result);
        source.close();
      }
    };
    source.onerror = () => {
      if (handlers.onError) {
        handlers.onError(new Error('Соединение с локальным сервером потеряно'));
      }
      source.close();
    };
    return source;
  }

  function createPrintRunEventSource(runId, handlers) {
    const source = new EventSource(`/api/print/runs/${encodeURIComponent(runId)}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'progress' && handlers.onProgress) {
        handlers.onProgress(payload);
      }

      if (payload.type === 'done' && handlers.onDone) {
        handlers.onDone(payload.result);
        source.close();
      }
    };
    source.onerror = () => {
      if (handlers.onError) {
        handlers.onError(new Error('Соединение с локальным сервером потеряно'));
      }
      source.close();
    };
    return source;
  }

  window.ApiClient = {
    async loadSettings() {
      const response = await fetch('/api/settings');
      return readJsonResponse(response);
    },

    async saveSettings(settings) {
      return postJson('/api/settings', { settings });
    },

    async fetchOrganizations(settings) {
      return postJson('/api/organizations', { settings });
    },

    async startRun(payload) {
      return postJson('/api/runs', payload);
    },

    async stopRun(runId) {
      return postJson(`/api/runs/${encodeURIComponent(runId)}/stop`, {});
    },

    async browserLogin() {
      return postJson('/api/browser/login', {});
    },

    async browserStatus() {
      const response = await fetch('/api/browser/status');
      return readJsonResponse(response);
    },

    async validatePrint(payload) {
      return postJson('/api/print/validate', payload);
    },

    async startPrintRun(payload) {
      return postJson('/api/print/run', payload);
    },

    getPrintDownloadUrl(runId) {
      return `/api/print/runs/${encodeURIComponent(runId)}/download`;
    },

    createRunEventSource,
    createPrintRunEventSource,
  };
}());
