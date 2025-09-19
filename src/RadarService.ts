import Radar from 'react-native-radar';
import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';

let currentTripId: string | null = null;
let locationCount: number = 0;
let trackingStatus: 'Efficient' | 'Continuous' | 'Paused' = 'Efficient';
let updateCount: (count: number) => void = () => {};
let updateStatus: (status: 'Efficient' | 'Continuous' | 'Paused') => void = () => {};
let updateGeofenceStatus: (geofence: 'pickup' | 'drop' | 'none') => void = () => {};
let pickupExitTimeout: NodeJS.Timeout | null = null;
let stationaryTimer: NodeJS.Timeout | null = null;
const RESET_COUNT_ON_TRIP_END = true;
let backgroundInterval: NodeJS.Timeout | null = null;
const subscriptions: EmitterSubscription[] = [];
let usingRadarOn = false;
let radarEventEmitter: NativeEventEmitter | null = null;

// Haversine distance (meters)
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const setUpdateCallbacks = (
  countCallback: (count: number) => void,
  statusCallback: (status: 'Efficient' | 'Continuous' | 'Paused') => void,
  geofenceCallback: (geofence: 'pickup' | 'drop' | 'none') => void
) => {
  updateCount = countCallback;
  updateStatus = statusCallback;
  updateGeofenceStatus = geofenceCallback;
};

const searchCurrentGeofences = async (): Promise<'pickup' | 'drop' | 'none'> => {
  let loc: any = null;
  try {
    console.log('[GEOFENCE-SEARCH] Getting location for search');
    loc = await Radar.trackOnce();
    console.log('[GEOFENCE-SEARCH] Search location:', !!loc?.location ? `${loc.location.latitude}, ${loc.location.longitude}` : 'No location');
    if (!loc?.location?.latitude || !loc?.location?.longitude) {
      console.warn('[GEOFENCE-SEARCH-WARN] No location for search - enable GPS/services');
      return 'none';
    }
    if (loc?.location?.latitude && loc?.location?.longitude) {
      locationCount += 1;
      updateCount(locationCount);
      console.log('[GEOFENCE-SEARCH] Pinned location from search, count:', locationCount);
    }
  } catch (e: any) {
    console.error('[GEOFENCE-SEARCH-LOC-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
    return 'none';
  }

  try {
    const result = await Radar.searchGeofences({
      latitude: loc.location.latitude,
      longitude: loc.location.longitude,
      tags: ['pickup', 'drop'],
      radius: 1000,
      limit: 10,
    });
    const geofences = result.geofences || [];
    console.log('[GEOFENCE-SEARCH] Found', geofences.length, 'geofences');
    geofences.forEach((g: any) => {
      if (g.type === 'circle') {
        const dist = haversineDistance(
          loc.location.latitude, loc.location.longitude,
          g.center.latitude, g.center.longitude
        );
        console.log(`[GEOFENCE-SEARCH] ${g.tag}: dist=${dist.toFixed(0)}m, radius=${g.radius}m, inside=${dist <= g.radius}`);
      }
    });
    for (const g of geofences) {
      if (g.type !== 'circle') continue;
      const dist = haversineDistance(
        loc.location.latitude, loc.location.longitude,
        g.center.latitude, g.center.longitude
      );
      if (dist <= g.radius) {
        if (g.tag === 'pickup') return 'pickup';
        else if (g.tag === 'drop') return 'drop';
      }
    }
    return 'none';
  } catch (e: any) {
    console.error('[GEOFENCE-SEARCH-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
    return 'none';
  }
};

function addListenerJS(name: string, fn: (...args: any[]) => void) {
  if (Radar && typeof (Radar as any).on === 'function') {
    usingRadarOn = true;
    (Radar as any).on(name, fn);
    return;
  }

  const native = (NativeModules as any).RNRadar;
  if (!radarEventEmitter && native) {
    radarEventEmitter = new NativeEventEmitter(native);
  }

  if (radarEventEmitter) {
    const sub = radarEventEmitter.addListener(name, fn);
    subscriptions.push(sub);
  }
}

function removeAllListenersJS() {
  if (usingRadarOn && Radar && typeof (Radar as any).off === 'function') {
    try {
      (Radar as any).off('clientLocation');
      (Radar as any).off('location');
      (Radar as any).off('events');
      (Radar as any).off('error');
    } catch {}
  }
  subscriptions.forEach((s) => {
    try {
      s.remove();
    } catch {}
  });
  subscriptions.length = 0;
}

export const initializeRadar = async (publishableKey: string, userId: string) => {
  console.log('[INIT-START] Initializing Radar');
  try {
    await Radar.initialize(publishableKey);
    console.log('[INIT-SUCCESS] SDK initialized');
    Radar.setUserId(userId);
    Radar.setMetadata({ app: 'RadarGeofenceApp' });
    Radar.setLogLevel('debug');
    if (typeof Radar.setForegroundServiceOptions === 'function') {
      Radar.setForegroundServiceOptions({
        text: 'Tracking driver route',
        title: 'Driver Location Tracking',
        importance: 2,
        activity: 'com.anonymous.RadarGeofenceApp.MainActivity',
      });
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    let locationReady = false;
    let retryCount = 0;
    const maxRetries = 3;
    while (!locationReady && retryCount < maxRetries) {
      try {
        const result = await Radar.trackOnce();
        console.log('[INIT] TrackOnce result:', JSON.stringify(result, null, 2));
        if (result?.location?.latitude && result?.location?.longitude) {
          locationCount += 1;
          updateCount(locationCount);
          console.log('[INIT] Initial location pinned, count:', locationCount);
          locationReady = true;
        } else {
          console.warn('[INIT] No valid location, retrying...', retryCount + 1);
          await new Promise(resolve => setTimeout(resolve, 2000));
          retryCount++;
        }
      } catch (e: any) {
        console.error('[INIT-TRACKONCE-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
        await new Promise(resolve => setTimeout(resolve, 2000));
        retryCount++;
      }
    }

    if (!locationReady) {
      console.error('[INIT] Failed to get valid location after retries - check GPS/services');
      startEfficientTracking();
      updateStatus('Efficient');
      return;
    }

    // Geofence events
    addListenerJS('events', (result: any) => {
      if (!result?.events?.length) return;
      console.log('[EVENTS] Received', result.events.length, 'events');
      result.events.forEach((event: any) => {
        console.log('[EVENT]', event.type, event.geofence?.tag || 'no tag');
        if (event.type === 'user.entered_geofence') {
          if (event.geofence?.tag === 'pickup') {
            console.log('[GEOFENCE-ENTER] User entered pickup geofence');
            updateGeofenceStatus('pickup');
            startContinuousTracking();
            updateStatus('Continuous');
            if (stationaryTimer) clearTimeout(stationaryTimer);
            stationaryTimer = setTimeout(() => {
              startEfficientTracking();
              console.log('[STATIONARY-TIMER] Switched to Efficient after 5 mins in geofence');
              updateGeofenceStatus('none'); // Reset geofence status after switching
            }, 5 * 60 * 1000); // 5 minutes
          } else if (event.geofence?.tag === 'drop') {
            console.log('[GEOFENCE-ENTER] User entered drop geofence');
            updateGeofenceStatus('drop');
            pauseTracking();
            updateStatus('Paused');
            if (stationaryTimer) clearTimeout(stationaryTimer);
          }
        } else if (event.type === 'user.exited_geofence') {
          if (event.geofence?.tag === 'pickup') {
            console.log('[GEOFENCE-EXIT] User exited pickup geofence');
            updateGeofenceStatus('none');
            if (pickupExitTimeout) clearTimeout(pickupExitTimeout);
            pickupExitTimeout = setTimeout(() => {
              if (trackingStatus === 'Continuous') {
                startEfficientTracking();
                updateGeofenceStatus('none');
              }
            }, 5 * 60 * 1000);
            if (stationaryTimer) clearTimeout(stationaryTimer);
          } else if (event.geofence?.tag === 'drop') {
            console.log('[GEOFENCE-EXIT] User exited drop geofence');
            updateGeofenceStatus('none');
          }
        }
      });
    });

    // Background location updates
    addListenerJS('location', (result: any) => {
      console.log('[LOCATION-UPDATE] Received location event');
      if (result?.location?.latitude && result?.location?.longitude) {
        locationCount += 1;
        updateCount(locationCount);
        console.log('[LOCATION-UPDATE] Pinned to', locationCount, 'mode:', trackingStatus, 'lat:', result.location.latitude, 'lng:', result.location.longitude);
      }
    });

    // Foreground location updates
    addListenerJS('clientLocation', (result: any) => {
      console.log('[CLIENT-LOCATION] Received client location event');
      if (result?.location?.latitude && result?.location?.longitude) {
        locationCount += 1;
        updateCount(locationCount);
        console.log('[CLIENT-LOCATION] Pinned to', locationCount, 'mode:', trackingStatus, 'lat:', result.location.latitude, 'lng:', result.location.longitude);
      }
    });

    // Errors
    addListenerJS('error', (error: any) => {
      console.error('[RADAR-ERROR]', error?.code || 'UNKNOWN', error?.message || 'No message');
    });

    const initialGeofence = await searchCurrentGeofences();
    updateGeofenceStatus(initialGeofence);
    if (initialGeofence === 'pickup') {
      startContinuousTracking();
      updateStatus('Continuous');
      if (stationaryTimer) clearTimeout(stationaryTimer);
      stationaryTimer = setTimeout(() => {
        startEfficientTracking();
        console.log('[STATIONARY-TIMER] Switched to Efficient after 5 mins in geofence');
        updateGeofenceStatus('none'); // Reset geofence status after switching
      }, 5 * 60 * 1000);
    } else if (initialGeofence === 'drop') {
      pauseTracking();
      updateStatus('Paused');
    } else {
      startEfficientTracking();
      updateStatus('Efficient');
    }

    if (backgroundInterval) clearInterval(backgroundInterval);
    console.log('[INIT] Setting 2-min background interval');
    backgroundInterval = setInterval(async () => {
      console.log('[2-MIN-TICK] Interval fired');
      try {
        const result = await Radar.trackOnce();
        if (result?.location?.latitude && result?.location?.longitude) {
          locationCount += 1;
          updateCount(locationCount);
          console.log('[2-MIN-UPDATE] Pinned to', locationCount, 'lat:', result.location.latitude, 'lng:', result.location.longitude);
        }
        if (result?.events?.length > 0) {
          result.events.forEach((event: any) => {
            if (event.type === 'user.entered_geofence') {
              if (event.geofence?.tag === 'pickup') {
                updateGeofenceStatus('pickup');
                startContinuousTracking();
                updateStatus('Continuous');
                if (stationaryTimer) clearTimeout(stationaryTimer);
                stationaryTimer = setTimeout(() => {
                  startEfficientTracking();
                  console.log('[STATIONARY-TIMER] Switched to Efficient after 5 mins in geofence');
                  updateGeofenceStatus('none'); // Reset geofence status after switching
                }, 5 * 60 * 1000);
              } else if (event.geofence?.tag === 'drop') {
                updateGeofenceStatus('drop');
                pauseTracking();
                updateStatus('Paused');
                if (stationaryTimer) clearTimeout(stationaryTimer);
              }
            } else if (event.type === 'user.exited_geofence') {
              if (event.geofence?.tag === 'pickup') {
                updateGeofenceStatus('none');
                if (pickupExitTimeout) clearTimeout(pickupExitTimeout);
                pickupExitTimeout = setTimeout(() => {
                  if (trackingStatus === 'Continuous') {
                    startEfficientTracking();
                    updateGeofenceStatus('none');
                  }
                }, 5 * 60 * 1000);
                if (stationaryTimer) clearTimeout(stationaryTimer);
              } else if (event.geofence?.tag === 'drop') {
                updateGeofenceStatus('none');
              }
            }
          });
        }
      } catch (e: any) {
        console.error('[2-MIN-UPDATE-ERROR]', e?.message || 'No message');
      }
    }, 120000);
    console.log('[INIT-SUCCESS] Init complete');
  } catch (e: any) {
    console.error('[INIT-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
  }
};

export const requestPermissions = async (background = false) => {
  console.log('[PERM-REQUEST] Requesting', background ? 'background' : 'foreground', 'permissions');
  try {
    const result = await Radar.requestPermissions(background);
    console.log('[PERM-SUCCESS]', result);
    return result;
  } catch (e: any) {
    console.error('[PERM-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
    return 'DENIED';
  }
};

export const getPermissionsStatus = async () => {
  console.log('[PERM-STATUS] Checking status');
  try {
    const status = await Radar.getPermissionsStatus();
    console.log('[PERM-STATUS]', status);
    return status;
  } catch (e: any) {
    console.error('[PERM-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
    return 'UNKNOWN';
  }
};

export const startEfficientTracking = () => {
  console.log('[TRACKING-START] Starting Efficient mode');
  Radar.startTrackingEfficient();
  trackingStatus = 'Efficient';
  updateStatus('Efficient');
};

export const startContinuousTracking = () => {
  if (trackingStatus !== 'Continuous') {
    console.log('[TRACKING-START] Starting Continuous mode');
    currentTripId = `trip-${Date.now()}`;
    Radar.startTrip({ externalId: currentTripId, destinationGeofenceTag: 'drop', mode: 'car' });
    Radar.startTrackingCustom({
      desiredMovingUpdateInterval: 120,
      fastestMovingUpdateInterval: 120,
      desiredStoppedUpdateInterval: 120,
      fastestStoppedUpdateInterval: 120,
      desiredSyncInterval: 120,
      sync: 'all',
      desiredAccuracy: 'high',
      stopDuration: 140,
      stopDistance: 70,
      replay: 'none',
      showBlueBar: true,
      foregroundServiceEnabled: true,
    });
    trackingStatus = 'Continuous';
    updateStatus('Continuous');
  }
};

export const pauseTracking = () => {
  console.log('[TRACKING-PAUSE] Stopping tracking');
  if (currentTripId) {
    Radar.completeTrip();
    currentTripId = null;
  }
  Radar.stopTracking();
  trackingStatus = 'Paused';
  updateStatus('Paused');
  if (RESET_COUNT_ON_TRIP_END) {
    locationCount = 0;
    updateCount(0);
    console.log('[COUNT-RESET] Pinned locations reset to 0');
  }
};

export const isTracking = async (): Promise<boolean> => {
  try {
    const result = await Radar.isTracking();
    return result;
  } catch {
    return false;
  }
};

export const trackOnce = async () => {
  console.log('[TRACKONCE] Running trackOnce');
  try {
    const result = await Radar.trackOnce();
    console.log('[TRACKONCE] Full result:', JSON.stringify(result, null, 2));
    return result;
  } catch (e: any) {
    console.error('[TRACKONCE-ERROR]', e?.code || 'UNKNOWN', e?.message || 'No message');
    throw e;
  }
};

export const removeListeners = () => {
  removeAllListenersJS();
  if (backgroundInterval) {
    clearInterval(backgroundInterval);
    backgroundInterval = null;
  }
  if (pickupExitTimeout) {
    clearTimeout(pickupExitTimeout);
    pickupExitTimeout = null;
  }
  if (stationaryTimer) {
    clearTimeout(stationaryTimer);
    stationaryTimer = null;
  }
};