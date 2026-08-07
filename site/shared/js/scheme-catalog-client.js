(() => {
  'use strict';

  let catalogPromise = null;

  function interfaceName() {
    return window.location.pathname.includes('/mobile/') ? 'mobile' : 'desktop';
  }

  function catalogUrl() {
    return `../shared/data/${interfaceName()}-scheme-catalog.json`;
  }

  async function loadCatalog(options = {}) {
    if (options.catalog) return options.catalog;
    if (!catalogPromise || options.reload) {
      catalogPromise = fetch(options.url || catalogUrl(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: options.reload ? 'no-store' : 'default',
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Scheme catalog unavailable: HTTP ${response.status}`);
        const catalog = await response.json();
        if (!catalog || !Array.isArray(catalog.schemes)) throw new Error('Invalid scheme catalog');
        window.CoilMasterSchemeCatalog = catalog;
        document.dispatchEvent(new CustomEvent('coilmaster:scheme-catalog-ready', {
          detail: { catalog, sourceUrl: response.url },
        }));
        return catalog;
      });
    }
    return catalogPromise;
  }

  function equalNumber(a, b, tolerance = 0) {
    if (a == null || b == null || a === '' || b === '') return true;
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tolerance;
  }

  function normalized(value) {
    return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
  }

  function includesNormalized(values, expected) {
    if (expected == null || expected === '') return true;
    const needle = normalized(expected);
    return (values || []).some((value) => normalized(value) === needle);
  }

  function branchMatches(values, expected) {
    if (expected == null || expected === '') return true;
    const target = Number(expected);
    return Number.isFinite(target) && (values || []).some((value) => Number(value) === target);
  }

  function pitchMatches(value, expected) {
    if (expected == null || expected === '') return true;
    if (value == null || value === '') return true;
    return normalized(value).replace(/\s+/g, '') === normalized(expected).replace(/\s+/g, '');
  }

  function strictBaseMatch(scheme, motor) {
    if (motor?.slots != null && !equalNumber(scheme.slots, motor.slots)) return false;
    if (motor?.rpm != null && !equalNumber(scheme.rpm, motor.rpm)) return false;
    return true;
  }

  function refineMatch(scheme, motor) {
    if (motor?.q != null && scheme.q != null && !equalNumber(scheme.q, motor.q, 0.001)) return false;
    if (motor?.poles != null && scheme.poles != null && !equalNumber(scheme.poles, motor.poles)) return false;
    if (motor?.winding_type && scheme.winding_types?.length && !includesNormalized(scheme.winding_types, motor.winding_type)) return false;
    if (motor?.parallel_branches != null && scheme.parallel_branches?.length && !branchMatches(scheme.parallel_branches, motor.parallel_branches)) return false;
    if (motor?.winding_pitch != null && !pitchMatches(scheme.pitch, motor.winding_pitch)) return false;
    return true;
  }

  function candidatesFromCatalog(catalog, motor = {}) {
    const schemes = Array.isArray(catalog?.schemes) ? catalog.schemes : [];
    const base = schemes.filter((scheme) => strictBaseMatch(scheme, motor));
    return base.filter((scheme) => refineMatch(scheme, motor));
  }

  async function findCandidates(motor = {}, options = {}) {
    const catalog = await loadCatalog(options);
    const candidates = candidatesFromCatalog(catalog, motor);
    document.dispatchEvent(new CustomEvent('coilmaster:scheme-candidates-ready', {
      detail: { motor, candidates, catalogVersion: catalog.version || null },
    }));
    return candidates;
  }

  async function getScheme(schemeId, options = {}) {
    if (!schemeId) return null;
    const catalog = await loadCatalog(options);
    return catalog.schemes.find((item) => item.scheme_id === schemeId) || null;
  }

  async function getConnection(schemeId, connectionId, options = {}) {
    if (!connectionId) return null;
    const scheme = await getScheme(schemeId, options);
    return scheme?.connection_options?.find((item) => item.connection_id === connectionId) || null;
  }

  window.CoilMasterSchemeCatalogClient = Object.freeze({
    loadCatalog,
    findCandidates,
    getScheme,
    getConnection,
    candidatesFromCatalog,
  });
})();
