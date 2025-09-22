import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, StatusBar, useColorScheme, TouchableOpacity, Linking } from 'react-native';
import {
  requestPermissions,
  getPermissionsStatus,
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
  const [permissionStatus, setPermissionStatus] = useState<string>('UNKNOWN');
  const publishableKey = 'prj_test_pk_c91b1261f51cbb972b484a618df4609e326452ef'; // Replace with your Radar publishable key
  const userId = 'TestDriver903';

  useEffect(() => {
    const init = async () => {
      console.log('[APP] Starting app init');
      try {
        setUpdateCallbacks(setPinnedCount, setStatus, () => {});
        await initializeRadar(publishableKey, userId);
        
        let permStatus = await getPermissionsStatus();
        setPermissionStatus(permStatus);
        console.log('[PERM-INIT] Initial permission status:', permStatus);
        if (permStatus !== 'GRANTED_BACKGROUND' && permStatus !== 'GRANTED_FOREGROUND') {
          console.log('[APP] Requesting background permissions');
          permStatus = await requestPermissions(true);
          setPermissionStatus(permStatus);
          if (permStatus === 'GRANTED_BACKGROUND' || permStatus === 'GRANTED_FOREGROUND') {
            await initializeRadar(publishableKey, userId);
          } else {
            console.log('[APP] Opening location settings');
            Linking.openSettings().catch(err => console.error('[APP-ERROR] Failed to open settings:', err.message));
          }
        }
      } catch (err: any) {
        console.error('[APP-INIT-ERROR]', err.message || 'No message');
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
        console.log('[TRACKING-STATUS] Tracking active:', active);
        const permStatus = await getPermissionsStatus();
        if (permStatus !== permissionStatus) {
          setPermissionStatus(permStatus);
          console.log('[PERM-UPDATE] Permission status updated to:', permStatus);
        }
      } catch (err: any) {
        console.error('[TRACKING-ERROR]', err.message || 'No message');
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [permissionStatus]);

  return (
    <View style={styles.container}>
      {permissionStatus !== 'GRANTED_BACKGROUND' && permissionStatus !== 'GRANTED_FOREGROUND' && (
        <TouchableOpacity style={styles.permissionTab} onPress={() => Linking.openSettings()}>
          <Text style={styles.permissionText}>Enable Location</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.label}>📍 Pinned locations: {pinnedCount}</Text>
      <Text style={styles.label}>⚡ Tracking status: {status}</Text>
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