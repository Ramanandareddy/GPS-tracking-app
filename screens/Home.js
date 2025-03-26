import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Switch,
  Dimensions,
  StatusBar,
  Clipboard,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import * as Location from 'expo-location';
import { 
  isConnected, 
  cacheUserLocation, 
  getCachedUserLocation, 
  processPendingUpdates 
} from '../utils/offlineManager';

const { width, height } = Dimensions.get('window');

const generateTrackingCode = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

export default function HomeScreen({ navigation }) {
  const [location, setLocation] = useState(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [trackingCode, setTrackingCode] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);

  // Check connectivity and load from cache if offline
  useEffect(() => {
    const checkConnectivity = async () => {
      try {
        const connected = await isConnected();
        setIsOffline(!connected);
        
        if (!connected) {
          console.log('Device is offline, loading cached data');
          const cachedLocationData = await getCachedUserLocation();
          if (cachedLocationData) {
            setLocation(cachedLocationData.location);
            setLastUpdateTime(cachedLocationData.timestamp);
          }
        } else {
          // Process any pending updates when back online
          processPendingUpdates();
        }
      } catch (error) {
        console.error('Error checking connectivity:', error);
      } finally {
        setLoadingInitialData(false);
      }
    };
    
    checkConnectivity();
  }, []);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      try {
        // Always try to get user data from Firestore first
        if (await isConnected()) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setShareLocation(data.shareLocation || false);
            setTrackingCode(data.trackingCode || null);
            setLocation(data.location || null);
            setLastUpdateTime(data.location?.timestamp || null);
          }
        } else {
          // If offline, already loaded from cache in previous useEffect
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        setErrorMsg('Failed to load user data. Using cached data if available.');
      }
    })();
  }, []);

  useEffect(() => {
    let subscription;
    const updateLocationInFirestore = async (newLocation, code) => {
      setIsUpdating(true);
      try {
        const timestamp = new Date().toISOString();
        // Optimistic UI update
        setLocation(newLocation);
        setLastUpdateTime(timestamp);

        // Always cache location locally
        await cacheUserLocation({
          latitude: newLocation.coords.latitude,
          longitude: newLocation.coords.longitude,
          timestamp: timestamp
        });

        // Only update Firestore if online
        const connected = await isConnected();
        if (connected) {
          await setDoc(doc(db, 'users', auth.currentUser.uid), {
            location: {
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
              timestamp: timestamp
            },
            shareLocation: true,
            trackingCode: code
          }, { merge: true });
        } else {
          setIsOffline(true);
          // Location is already cached with pending updates in cacheUserLocation
        }
      } catch (error) {
        console.error('Firestore/cache update failed:', error);
        setErrorMsg('Failed to update location');
      } finally {
        setIsUpdating(false);
      }
    };

    (async () => {
      if (shareLocation) {
        let currentCode = trackingCode;
        if (!currentCode) {
          currentCode = generateTrackingCode();
          setTrackingCode(currentCode);
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000, // Update every 1 second (changed from 5000)
            distanceInterval: 5, // Update every 5 meters (changed from 10)
          },
          (newLocation) => {
            updateLocationInFirestore(newLocation, currentCode);
          }
        );
      } else {
        setIsUpdating(true);
        try {
          setLocation(null);
          setTrackingCode(null);
          await setDoc(doc(db, 'users', auth.currentUser.uid), {
            location: null,
            shareLocation: false,
            trackingCode: null
          }, { merge: true });
        } catch (error) {
          console.error('Firestore clear failed:', error);
          setErrorMsg('Failed to stop sharing');
        } finally {
          setIsUpdating(false);
        }
      }
    })();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [shareLocation]);

  const toggleShareLocation = () => {
    setShareLocation(prev => !prev);
  };

  const copyToClipboard = () => {
    Clipboard.setString(trackingCode);
    alert('Tracking code copied to clipboard!');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={styles.header}>
        <Text style={styles.title}>Welcome Home!</Text>
        {isOffline && (
          <Text style={styles.offlineText}>Offline Mode</Text>
        )}
      </View>

      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          region={location ? {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          } : undefined}
        >
          {location && shareLocation && (
            <Marker
              coordinate={{
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }}
              title="Your Location"
            />
          )}
        </MapView>
      </View>

      <View style={styles.controlsContainer}>
        {errorMsg && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}
        
        <View style={styles.shareToggle}>
          <Text style={styles.toggleLabel}>Share My Location</Text>
          <Switch
            trackColor={{ false: "#767577", true: "#81b0ff" }}
            thumbColor={shareLocation ? "#007AFF" : "#f4f3f4"}
            onValueChange={toggleShareLocation}
            value={shareLocation}
            disabled={isUpdating}
          />
        </View>

        {shareLocation && (
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>
              Status: {isUpdating ? 'Updating...' : 'Location Shared'}
            </Text>
            {lastUpdateTime && (
              <Text style={styles.timestampText}>
                Last Update: {new Date(lastUpdateTime).toLocaleTimeString()}
              </Text>
            )}
          </View>
        )}

        {shareLocation && trackingCode && (
          <TouchableOpacity 
            style={styles.codeContainer}
            onPress={copyToClipboard}
          >
            <Text style={styles.codeLabel}>Your Tracking Code: </Text>
            <Text style={styles.codeText}>{trackingCode}</Text>
            <Text style={styles.codeInstruction}>(Tap to copy)</Text>
          </TouchableOpacity>
        )}
      </View>

      {isOffline && shareLocation && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Your location updates are being saved offline and will sync when you're back online.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 10,
    paddingTop:40,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  controlsContainer: {
    padding: 20,
  },
  shareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  toggleLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  codeContainer: {
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  codeLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  codeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
    marginVertical: 5,
  },
  codeInstruction: {
    fontSize: 12,
    color: '#666',
  },
  statusContainer: {
    marginBottom: 20,
  },
  statusText: {
    fontSize: 14,
    color: '#333',
  },
  timestampText: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  offlineText: {
    color: '#E34234',
    fontSize: 14,
    fontWeight: 'bold',
  },
  offlineBanner: {
    backgroundColor: '#FFF9C4',
    padding: 10,
    borderRadius: 8,
    margin: 10,
  },
  offlineBannerText: {
    color: '#F57F17',
    fontSize: 14,
    textAlign: 'center',
  },
});