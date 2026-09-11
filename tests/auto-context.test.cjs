const assert = require('node:assert/strict');
const AutoContext = require('../sorter 2025/auto-context.js');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function position(latitude, longitude, accuracy = 10) {
  return { coords: { latitude, longitude, accuracy } };
}

function geolocationReturning(value) {
  return {
    getCurrentPosition(resolve) { resolve(value); },
  };
}

(async function run() {
  assert.equal(AutoContext.isAutoUrl('https://example.test/tasks?auto'), true);
  assert.equal(AutoContext.isAutoUrl('https://example.test/tasks.html?auto=1'), true);
  assert.equal(AutoContext.isAutoUrl('https://example.test/tasks/auto'), true);
  assert.equal(AutoContext.isAutoUrl('https://example.test/tasks'), false);

  assert.equal(
    AutoContext.matchesSelectedContexts(['ноут'], ['ноут', 'дом'], 'or'),
    true,
  );
  assert.equal(
    AutoContext.matchesSelectedContexts(['ноут'], ['ноут', 'дом'], 'and'),
    false,
  );
  assert.equal(
    AutoContext.matchesSelectedContexts(['дом', 'ноут'], ['@ноут', '@дом'], 'and'),
    true,
  );
  assert.equal(AutoContext.matchesSelectedContexts([], [], 'and'), true);

  const settings = createStorage();
  assert.equal(AutoContext.getContextOperator(settings), 'or');
  assert.equal(AutoContext.setContextOperator(settings, 'and'), 'and');
  assert.equal(AutoContext.getContextOperator(settings), 'and');

  assert.equal(
    AutoContext.detectDeviceContext({ userAgentData: { mobile: true } }, 1280),
    AutoContext.CONFIG.contexts.mobile,
  );
  assert.equal(
    AutoContext.detectDeviceContext({ userAgent: 'Desktop', maxTouchPoints: 0 }, 390),
    AutoContext.CONFIG.contexts.desktop,
  );

  const homeStorage = createStorage();
  AutoContext.saveHomeCoordinates(homeStorage, position(52.52, 13.405, 12), 1234);
  assert.deepEqual(AutoContext.getHomeCoordinates(homeStorage), {
    latitude: 52.52,
    longitude: 13.405,
    accuracy: 12,
    savedAt: 1234,
  });

  assert.equal(
    AutoContext.classifyLocation(
      { latitude: 52.5205, longitude: 13.405, accuracy: 10 },
      AutoContext.getHomeCoordinates(homeStorage),
    ),
    'home',
  );
  assert.equal(
    AutoContext.classifyLocation(
      { latitude: 52.53, longitude: 13.405, accuracy: 10 },
      AutoContext.getHomeCoordinates(homeStorage),
    ),
    'away',
  );

  const resolvedHome = await AutoContext.resolveAutoContexts({
    storage: homeStorage,
    geolocation: geolocationReturning(position(52.5205, 13.405, 10)),
    navigatorLike: { userAgentData: { mobile: false } },
    viewportWidth: 1280,
  });
  assert.deepEqual(resolvedHome.contexts, [AutoContext.CONFIG.contexts.desktop, AutoContext.CONFIG.contexts.home]);

  const resolvedAway = await AutoContext.resolveAutoContexts({
    storage: homeStorage,
    geolocation: geolocationReturning(position(52.53, 13.405, 10)),
    navigatorLike: { userAgentData: { mobile: true } },
    viewportWidth: 390,
  });
  assert.deepEqual(resolvedAway.contexts, [AutoContext.CONFIG.contexts.mobile, AutoContext.CONFIG.contexts.away]);

  const unset = await AutoContext.resolveAutoContexts({
    storage: createStorage(),
    geolocation: null,
    navigatorLike: { userAgentData: { mobile: false } },
    viewportWidth: 1280,
  });
  assert.deepEqual(unset.contexts, [AutoContext.CONFIG.contexts.desktop]);
  assert.equal(unset.location, 'unset');

  console.log('auto context tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
