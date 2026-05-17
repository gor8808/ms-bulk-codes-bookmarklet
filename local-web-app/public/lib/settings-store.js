(function () {
  const STORAGE_KEY = 'emissionOrderSettings';
  const DEFAULT_SETTINGS = {
    authMode: 'token',
    apiToken: '',
    login: '',
    password: '',
    organizationHref: '',
    organizationName: '',
    emissionType: 'REMAINS',
    trackingType: 'LP_CLOTHES',
  };

  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function save(settings) {
    const next = { ...DEFAULT_SETTINGS, ...settings };
    const browserSafeSettings = {
      authMode: next.authMode,
      organizationHref: next.organizationHref,
      organizationName: next.organizationName,
      emissionType: next.emissionType,
      trackingType: next.trackingType,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(browserSafeSettings));
    return next;
  }

  window.SettingsStore = {
    load,
    save,
    defaults: DEFAULT_SETTINGS,
  };
}());
