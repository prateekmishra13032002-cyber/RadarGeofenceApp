import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, StatusBar, useColorScheme, TouchableOpacity, Linking } from 'react-native';
import {
  requestPermissions,
  getPermissionsStatus,
  startEfficientTracking,
  setUpdateCallbacks,
  isTracking,
  removeListeners,
  initializeRadar,
} from './src/RadarService';

const App: React.FC = () => {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </>
  );
};

const AppContent: React.FC = () => {
  const [pinnedCount, setPinnedCount] = useState<number>(0);
  const [status, setStatus] = useState<'Efficient' | 'Continuous' | 'Paused'>('Efficient');
  const [trackingActive, setTrackingActive] = useState<boolean>(false);
  const [currentGeofence, setCurrentGeofence] = useState<'pickup' | 'drop' | 'none'>('none');
  const [permissionStatus, setPermissionStatus] = useState<string>('UNKNOWN');

  const publishableKey = 'prj_test_pk_c91b1261f51cbb972b484a618df4609e326452ef';
  const userId = 'New Personal Driver2';

  useEffect(() => {
    const init = async () => {
      try {
        setUpdateCallbacks(setPinnedCount, setStatus, setCurrentGeofence);
        await initializeRadar(publishableKey, userId);
        
        let permStatus = await getPermissionsStatus();
        setPermissionStatus(permStatus);
        console.log('[PERM-INIT] Initial permission status:', permStatus, 'at', new Date().toISOString());

        if (permStatus === 'GRANTED_BACKGROUND' || permStatus === 'GRANTED_FOREGROUND') {
          startEfficientTracking();
        } else {
          permStatus = await requestPermissions(true);
          setPermissionStatus(permStatus);
          console.log('[PERM-REQUEST] Requested background permissions, result:', permStatus);
          if (permStatus === 'GRANTED_BACKGROUND' || permStatus === 'GRANTED_FOREGROUND') {
            startEfficientTracking();
          }
        }
      } catch (err: any) {
        console.error('[INIT-ERROR] Initialization error at', new Date().toISOString(), ':', {
          message: err.message || 'No message provided',
          stack: err.stack || 'No stack trace',
        });
      }
    };
    init();

    return () => removeListeners();
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const active = await isTracking();
        setTrackingActive(active);
        console.log('[TRACKING-STATUS] Tracking active:', active, 'at', new Date().toISOString());

        // Periodically check permission status
        const permStatus = await getPermissionsStatus();
        if (permStatus !== permissionStatus) {
          setPermissionStatus(permStatus);
          console.log('[PERM-UPDATE] Permission status updated to:', permStatus);
        }
      } catch (err: any) {
        console.error('[TRACKING-ERROR] Status check error at', new Date().toISOString(), ':', {
          message: err.message || 'No message provided',
          stack: err.stack || 'No stack trace',
        });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [permissionStatus]);

  const handlePermissionRequest = async () => {
    try {
      const permStatus = await requestPermissions(true);
      setPermissionStatus(permStatus);
      console.log('[PERM-REQUEST] User re-requested permissions, result:', permStatus);
      if (permStatus === 'GRANTED_BACKGROUND' || permStatus === 'GRANTED_FOREGROUND') {
        startEfficientTracking();
      }
    } catch (err: any) {
      console.error('[PERM-ERROR] Permission re-request error at', new Date().toISOString(), ':', {
        message: err.message || 'No message provided',
        stack: err.stack || 'No stack trace',
      });
    }
  };

  return (
    <View style={styles.container}>
      {permissionStatus !== 'GRANTED_BACKGROUND' && permissionStatus !== 'GRANTED_FOREGROUND' && (
        <TouchableOpacity
          style={styles.permissionTab}
          onPress={() => Linking.openSettings()}
        >
          <Text style={styles.permissionText}>Enable Location</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.label}>📍 Pinned locations: {pinnedCount}</Text>
      <Text style={styles.label}>⚡ Tracking status: {status}</Text>
      <Text style={styles.label}>🛰️ Current Geofence: {currentGeofence}</Text>
      <Text style={styles.label}>📡 Tracking active: {trackingActive ? 'Yes' : 'No'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    padding: 20,
  },
  label: {
    fontSize: 18,
    marginVertical: 8,
    color: '#333',
    textAlign: 'center',
  },
  permissionTab: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#ff4444',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  permissionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default App;