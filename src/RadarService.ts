import Radar from 'react-native-radar';
import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';

let currentTripId: string | null = null;
let locationCount: number = 0;
let trackingStatus: 'Efficient' | 'Continuous' | 'Paused' = 'Efficient';

let updateCount: (count: number) => void = () => {};
let updateStatus: (status: 'Efficient' | 'Continuous' | 'Paused') => void = () => {};
let updateGeofenceStatus: (geofence: 'pickup' | 'drop' | 'none') => void = () => {};

const subscriptions: EmitterSubscription[] = [];
let usingRadarOn = false;
let radarEventEmitter: NativeEventEmitter | null = null;
let pickupExitTimeout: NodeJS.Timeout | null = null;
const RESET_COUNT_ON_TRIP_END = true;

let backgroundInterval: NodeJS.Timeout | null = null;

export const setUpdateCallbacks = (
  countCallback: (count: number) => void,
  statusCallback: (status: 'Efficient' | 'Continuous' | 'Paused') => void,
  geofenceCallback: (geofence: 'pickup' | 'drop' | 'none') => void
) => {
  updateCount = countCallback;
  updateStatus = statusCallback;
  updateGeofenceStatus = geofenceCallback;
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
  await Radar.initialize(publishableKey);
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

  // Geofence events
  addListenerJS('events', (result: any) => {
    if (!result?.events?.length) return;

    result.events.forEach((event: any) => {
      if (event.type === 'user.entered_geofence') {
        if (event.geofence?.tag === 'pickup') {
          updateGeofenceStatus('pickup');
          startContinuousTracking();
        } else if (event.geofence?.tag === 'drop') {
          updateGeofenceStatus('drop');
          pauseTracking();
        }
      } else if (event.type === 'user.exited_geofence') {
        if (event.geofence?.tag === 'pickup') {
          updateGeofenceStatus('none');
          // if exited pickup, wait 5 min → fallback efficient
          if (pickupExitTimeout) clearTimeout(pickupExitTimeout);
          pickupExitTimeout = setTimeout(() => {
            if (trackingStatus === 'Continuous') {
              startEfficientTracking();
              updateGeofenceStatus('none');
            }
          }, 5 * 60 * 1000);
        } else if (event.geofence?.tag === 'drop') {
          updateGeofenceStatus('none');
        }
      }
    });
  });

  // Background location updates
  addListenerJS('location', (result: any) => {
    if (result?.location?.latitude && result?.location?.longitude) {
      locationCount += 1;
      updateCount(locationCount);
    }
  });

  // Foreground location updates
  addListenerJS('clientLocation', (result: any) => {
    if (result?.location?.latitude && result?.location?.longitude) {
      locationCount += 1;
      updateCount(locationCount);
    }
  });

  // Errors
  addListenerJS('error', (error: any) => {
    console.error('[RADAR ERROR]', error);
  });

  // initial state
  await Radar.trackOnce();

  // background 2-min updater
  if (backgroundInterval) clearInterval(backgroundInterval);
  backgroundInterval = setInterval(async () => {
    try {
      await Radar.trackOnce();
    } catch {}
  }, 120000);
};

export const requestPermissions = async (background = false) => {
  try {
    return await Radar.requestPermissions(background);
  } catch {
    return 'DENIED';
  }
};

export const getPermissionsStatus = async () => {
  try {
    return await Radar.getPermissionsStatus();
  } catch {
    return 'UNKNOWN';
  }
};

export const startEfficientTracking = () => {
  Radar.startTrackingEfficient();
  trackingStatus = 'Efficient';
  updateStatus('Efficient');
};

export const startContinuousTracking = () => {
  if (trackingStatus !== 'Continuous') {
    currentTripId = `trip-${Date.now()}`;
    Radar.startTrip({
      externalId: currentTripId,
      destinationGeofenceTag: 'drop',
      mode: 'car',
    });
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
  }
};

export const isTracking = async (): Promise<boolean> => {
  try {
    return await Radar.isTracking();
  } catch {
    return false;
  }
};

export const trackOnce = async () => {
  try {
    const result = await Radar.trackOnce();
    return result;
  } catch (e) {
    throw e;
  }
};

export const removeListeners = () => {
  removeAllListenersJS();
  if (backgroundInterval) clearInterval(backgroundInterval);
};
