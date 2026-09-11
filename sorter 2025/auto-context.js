// Automatic task contexts: device + locally stored home geofence.
(function initAutoContext(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SorterAutoContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAutoContextApi() {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    home: 'sorter_auto_home_coordinates',
    contextOperator: 'sorter_auto_context_operator',
  });

  // Product defaults are intentionally centralized here. A future settings UI
  // should edit these labels and the radius instead of duplicating auto logic.
  const CONFIG = Object.freeze({
    contexts: Object.freeze({
      desktop: 'ноут',
      mobile: 'телефон',
      home: 'дом',
      away: 'город',
    }),
    homeRadiusMeters: 200,
    maxLocationAccuracyMeters: 1000,
  });

  function toUrl(locationLike) {
    if (locationLike instanceof URL) return locationLike;
    const value = typeof locationLike === 'string'
      ? locationLike
      : (locationLike && locationLike.href) || 'http://localhost/';
    return new URL(value, 'http://localhost/');
  }

  function isAutoUrl(locationLike) {
    const url = toUrl(locationLike);
    return url.searchParams.has('auto') || url.pathname.split('/').includes('auto');
  }

  function normalizeContext(value) {
    return String(value || '').trim().replace(/^@/, '').toLocaleLowerCase('ru');
  }

  /**
   * Context filters form one group. "or" means a task may contain any selected
   * context; "and" requires every selected context. Other filter groups are
   * combined with this result separately by the tasks page.
   */
  function matchesSelectedContexts(taskContexts, selectedContexts, operator = 'or') {
    const selected = [...selectedContexts].map(normalizeContext).filter(Boolean);
    if (!selected.length) return true;
    const taskSet = new Set((taskContexts || []).map(normalizeContext).filter(Boolean));
    return operator === 'and'
      ? selected.every(context => taskSet.has(context))
      : selected.some(context => taskSet.has(context));
  }

  function getContextOperator(storage) {
    try {
      return storage && storage.getItem(STORAGE_KEYS.contextOperator) === 'and' ? 'and' : 'or';
    } catch (_) {
      return 'or';
    }
  }

  function setContextOperator(storage, operator) {
    const normalized = operator === 'and' ? 'and' : 'or';
    storage?.setItem(STORAGE_KEYS.contextOperator, normalized);
    return normalized;
  }

  function parseCoordinates(value) {
    if (!value) return null;
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const latitude = Number(parsed.latitude);
      const longitude = Number(parsed.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
      return {
        latitude,
        longitude,
        accuracy: Number.isFinite(Number(parsed.accuracy)) ? Math.max(0, Number(parsed.accuracy)) : null,
        savedAt: Number.isFinite(Number(parsed.savedAt)) ? Number(parsed.savedAt) : null,
      };
    } catch (_) {
      return null;
    }
  }

  function getHomeCoordinates(storage) {
    try {
      return parseCoordinates(storage?.getItem(STORAGE_KEYS.home));
    } catch (_) {
      return null;
    }
  }

  function saveHomeCoordinates(storage, position, now = Date.now()) {
    const coordinates = parseCoordinates({
      latitude: position?.coords?.latitude,
      longitude: position?.coords?.longitude,
      accuracy: position?.coords?.accuracy,
      savedAt: now,
    });
    if (!coordinates) throw new Error('Браузер не вернул корректные координаты');
    if (coordinates.accuracy !== null && coordinates.accuracy > CONFIG.maxLocationAccuracyMeters) {
      throw new Error('Геопозиция слишком неточная. Включи точное местоположение и повтори');
    }
    storage?.setItem(STORAGE_KEYS.home, JSON.stringify(coordinates));
    return coordinates;
  }

  function getCurrentPosition(geolocation) {
    return new Promise((resolve, reject) => {
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
        reject(new Error('Геолокация не поддерживается этим браузером'));
        return;
      }
      geolocation.getCurrentPosition(resolve, error => {
        const message = error?.code === 1
          ? 'Доступ к геопозиции запрещён'
          : 'Не удалось определить местоположение';
        reject(new Error(message));
      }, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 5 * 60 * 1000,
      });
    });
  }

  async function captureHomeCoordinates(storage, geolocation, now = Date.now()) {
    const position = await getCurrentPosition(geolocation);
    return saveHomeCoordinates(storage, position, now);
  }

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  function distanceMeters(left, right) {
    const earthRadius = 6371000;
    const lat1 = toRadians(left.latitude);
    const lat2 = toRadians(right.latitude);
    const deltaLat = toRadians(right.latitude - left.latitude);
    const deltaLon = toRadians(right.longitude - left.longitude);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function classifyLocation(current, home) {
    const currentCoordinates = parseCoordinates(current);
    const homeCoordinates = parseCoordinates(home);
    if (!currentCoordinates || !homeCoordinates) return 'unknown';
    if (currentCoordinates.accuracy !== null
        && currentCoordinates.accuracy > CONFIG.maxLocationAccuracyMeters) return 'unknown';
    const uncertainty = Math.min(currentCoordinates.accuracy || 0, CONFIG.homeRadiusMeters);
    return distanceMeters(currentCoordinates, homeCoordinates)
      <= CONFIG.homeRadiusMeters + uncertainty ? 'home' : 'away';
  }

  function detectDeviceContext(navigatorLike = {}, viewportWidth = Infinity) {
    const mobileHint = navigatorLike.userAgentData?.mobile;
    const ua = String(navigatorLike.userAgent || '');
    const iPadDesktopUa = navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1;
    const touchPhoneLayout = navigatorLike.maxTouchPoints > 0 && viewportWidth <= 760;
    const isMobile = mobileHint === true || /Android|iPhone|iPod|Mobile/i.test(ua)
      || iPadDesktopUa || touchPhoneLayout;
    return isMobile ? CONFIG.contexts.mobile : CONFIG.contexts.desktop;
  }

  async function resolveAutoContexts({ storage, geolocation, navigatorLike, viewportWidth }) {
    const device = detectDeviceContext(navigatorLike, viewportWidth);
    const home = getHomeCoordinates(storage);
    if (!home) return { contexts: [device], location: 'unset', error: null };
    try {
      const position = await getCurrentPosition(geolocation);
      const current = parseCoordinates(position.coords);
      const location = classifyLocation(current, home);
      if (location === 'unknown') {
        return { contexts: [device], location, error: 'Недостаточная точность геопозиции' };
      }
      const place = location === 'home' ? CONFIG.contexts.home : CONFIG.contexts.away;
      return { contexts: [device, place], location, error: null };
    } catch (error) {
      return { contexts: [device], location: 'unavailable', error: error.message };
    }
  }

  return Object.freeze({
    CONFIG,
    STORAGE_KEYS,
    isAutoUrl,
    matchesSelectedContexts,
    getContextOperator,
    setContextOperator,
    getHomeCoordinates,
    saveHomeCoordinates,
    captureHomeCoordinates,
    distanceMeters,
    classifyLocation,
    detectDeviceContext,
    resolveAutoContexts,
  });
});
