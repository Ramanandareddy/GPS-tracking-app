import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity,
  StatusBar,
  PanResponder,
  Animated,
  FlatList,
  Alert,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import * as Location from 'expo-location';
import axios from 'axios';
import Ionicons from '@expo/vector-icons/Ionicons';
import { 
  isConnected, 
  getCachedFriendsLocations, 
  cacheFriendsLocations 
} from '../utils/offlineManager';

// Define API key
const GOOGLE_MAPS_API_KEY = ''; // Add your Google Maps API Key here

// Function to calculate distance between two points (in kilometers)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  return distance.toFixed(2);
};

// Function to calculate bearing (direction) between two points
const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  lat1 = lat1 * Math.PI / 180;
  lat2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
};

// Convert bearing to cardinal direction
const getDirection = (bearing) => {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
};

export default function TrackerScreen() {
  const [trackingCode, setTrackingCode] = useState('');
  const [trackedLocation, setTrackedLocation] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(null);
  const [locationSubscription, setLocationSubscription] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [friends, setFriends] = useState([]);
  const [trackingFriend, setTrackingFriend] = useState(null);
  const [isTrackingFriend, setIsTrackingFriend] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const mapRef = useRef(null);

  // Animation values for dragging
  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        // Optional: Add boundaries or snap-back behavior here if needed
      },
    })
  ).current;

  // Check connectivity on component mount
  useEffect(() => {
    const checkConnectivityAndLoadCache = async () => {
      const connected = await isConnected();
      setIsOffline(!connected);
      
      if (!connected) {
        // Load cached data if offline
        try {
          const cachedFriendsData = await getCachedFriendsLocations();
          if (cachedFriendsData && cachedFriendsData.length > 0) {
            // Set appropriate state based on cached data
            if (cachedFriendsData.tracking) {
              setIsTrackingFriend(true);
              setTrackingFriend(cachedFriendsData.tracking);
            }
            
            if (cachedFriendsData.trackedLocation) {
              setTrackedLocation(cachedFriendsData.trackedLocation);
              setIsTracking(true);
            }
            
            if (cachedFriendsData.friends) {
              setFriends(cachedFriendsData.friends);
            }
            
            setLastSyncTime(cachedFriendsData.timestamp);
          }
        } catch (error) {
          console.error('Error loading cached friends data:', error);
        }
      }
    };
    
    checkConnectivityAndLoadCache();
  }, []);

  // Get current user location and fetch friends list
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (newLocation) => {
          setCurrentLocation(newLocation.coords);
          if (mapRef.current && !trackedLocation && !isTrackingFriend) {
            mapRef.current.animateToRegion({
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
              latitudeDelta: 0.001,  // Zoom level ~20
              longitudeDelta: 0.001, // Zoom level ~20
            }, 1000);
          }
        }
      );
      setLocationSubscription(sub);
      
      // Fetch friends list if online
      const connected = await isConnected();
      if (connected && auth.currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const friendIds = userData.friends || [];
            
            // Fetch friend data
            const friendsData = await Promise.all(
              friendIds.map(async (friendId) => {
                const friendDocRef = doc(db, 'users', friendId);
                const friendDoc = await getDoc(friendDocRef);
                if (friendDoc.exists()) {
                  return { id: friendId, ...friendDoc.data() };
                }
                return null;
              })
            );
            
            const validFriends = friendsData.filter(Boolean);
            setFriends(validFriends);
            
            // Cache friends data for offline use
            await cacheFriendsLocations({
              friends: validFriends,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error('Error fetching friends:', error);
          if (!isOffline) {
            setErrorMsg('Failed to load friends. Check your connection.');
          }
        }
      }
    })();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [isOffline]);

  // Fetch routes when both locations are available
  useEffect(() => {
    if (currentLocation && (trackedLocation || trackingFriend?.location)) {
      fetchRoutes();
    }
  }, [currentLocation, trackedLocation, trackingFriend]);

  const startTracking = async () => {
    if (!trackingCode || trackingCode.length !== 6) {
      setErrorMsg('Please enter a valid 6-character tracking code');
      return;
    }

    setErrorMsg(null);
    setIsTracking(true);

    // Check if we're online
    const connected = await isConnected();
    if (!connected) {
      setErrorMsg('You are offline. Tracking is unavailable in offline mode.');
      setIsTracking(false);
      return;
    }

    if (unsubscribe) {
      unsubscribe();
    }

    const q = query(
      collection(db, 'users'),
      where('trackingCode', '==', trackingCode),
      where('shareLocation', '==', true)
    );

    const unsub = onSnapshot(q, (querySnapshot) => {
      if (!querySnapshot.empty) {
        const userData = querySnapshot.docs[0].data();
        const newLocation = userData.location;
        setTrackedLocation(newLocation);
        
        // Cache the tracked location
        cacheFriendsLocations({
          trackedLocation: newLocation,
          trackingCode: trackingCode,
          timestamp: new Date().toISOString()
        });
        
        if (mapRef.current && newLocation) {
          mapRef.current.animateToRegion({
            latitude: newLocation.latitude,
            longitude: newLocation.longitude,
            latitudeDelta: 0.001,  // Zoom level ~20
            longitudeDelta: 0.001, // Zoom level ~20
          }, 1000);
        }
        setErrorMsg(null);
      } else {
        setTrackedLocation(null);
        setErrorMsg('No active user found with this tracking code');
      }
    }, (error) => {
      setErrorMsg('Error tracking location: ' + error.message);
      setTrackedLocation(null);
    });

    setUnsubscribe(() => unsub);
  };

  // Start tracking a friend
  const startTrackingFriend = (friend) => {
    if (isTracking) {
      stopTracking();
    }
    
    if (isTrackingFriend && trackingFriend?.id === friend.id) {
      stopTrackingFriend();
      return;
    }
    
    setErrorMsg(null);
    setIsTrackingFriend(true);
    setTrackingFriend(friend);
    
    if (unsubscribe) {
      unsubscribe();
    }
    
    // Set up real-time listener for friend's location
    const unsub = onSnapshot(
      doc(db, 'users', friend.id),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const userData = docSnapshot.data();
          if (userData.location) {
            setTrackingFriend({...friend, location: userData.location});
            
            if (mapRef.current && userData.location) {
              mapRef.current.animateToRegion({
                latitude: userData.location.latitude,
                longitude: userData.location.longitude,
                latitudeDelta: 0.001,
                longitudeDelta: 0.001,
              }, 1000);
            }
          } else {
            setErrorMsg(`${friend.name} is not sharing their location`);
          }
        } else {
          setErrorMsg('Friend data no longer available');
          stopTrackingFriend();
        }
      },
      (error) => {
        setErrorMsg('Error tracking friend: ' + error.message);
        stopTrackingFriend();
      }
    );
    
    setUnsubscribe(() => unsub);
  };
  
  // Stop tracking friend
  const stopTrackingFriend = () => {
    if (unsubscribe) {
      unsubscribe();
      setUnsubscribe(null);
    }
    setIsTrackingFriend(false);
    setTrackingFriend(null);
    setErrorMsg(null);
    setRoutes([]);
    pan.setValue({ x: 0, y: 0 });
  };

  const stopTracking = () => {
    if (unsubscribe) {
      unsubscribe();
      setUnsubscribe(null);
    }
    setIsTracking(false);
    setTrackedLocation(null);
    setTrackingCode('');
    setErrorMsg(null);
    setRoutes([]); // Clear routes when stopping tracking
    pan.setValue({ x: 0, y: 0 }); // Reset position when stopping tracking
  };

  const centerOnPath = () => {
    if (mapRef.current && currentLocation) {
      let targetLocation = null;
      
      if (trackedLocation) {
        targetLocation = trackedLocation;
      } else if (trackingFriend?.location) {
        targetLocation = trackingFriend.location;
      }
      
      if (targetLocation) {
        const midLat = (currentLocation.latitude + targetLocation.latitude) / 2;
        const midLon = (currentLocation.longitude + targetLocation.longitude) / 2;
        
        mapRef.current.animateToRegion({
          latitude: midLat,
          longitude: midLon,
          latitudeDelta: 0.001,  // Zoom level ~20
          longitudeDelta: 0.001, // Zoom level ~20
        }, 1000);
      }
    }
  };

  const fetchRoutes = async () => {
    if (!currentLocation || !trackedLocation) return;

    try {
      const origin = `${currentLocation.latitude},${currentLocation.longitude}`;
      const dest = `${trackedLocation.latitude},${trackedLocation.longitude}`;

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${dest}&alternatives=true&key=${GOOGLE_MAPS_API_KEY}`
      );

      if (response.data.routes) {
        const fetchedRoutes = response.data.routes;

        // Sort routes by traffic: High traffic is SAFE (green), Low traffic is NOT SAFE (red)
        const sortedRoutes = fetchedRoutes.sort((a, b) => {
          const aDuration = a.legs[0].duration_in_traffic
            ? a.legs[0].duration_in_traffic.value
            : a.legs[0].duration.value;
          const bDuration = b.legs[0].duration_in_traffic
            ? b.legs[0].duration_in_traffic.value
            : b.legs[0].duration.value;

          return bDuration - aDuration; // Higher traffic first
        });

        setRoutes(sortedRoutes);
      }
    } catch (error) {
      console.error('Error fetching routes:', error);
      setErrorMsg('Failed to fetch routes');
    }
  };

  // Format time elapsed since last location update
  const formatTimeElapsed = (timestamp) => {
    if (!timestamp) return 'Unknown';
    
    const now = new Date();
    const locationTime = new Date(timestamp);
    const diffMs = now - locationTime;
    
    // Convert to minutes
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hr ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  // Render friend item
  const renderFriendItem = ({ item }) => (
    <TouchableOpacity 
      style={[
        styles.friendItem,
        trackingFriend?.id === item.id ? styles.selectedFriend : null
      ]}
      onPress={() => startTrackingFriend(item)}
    >
      <View style={styles.friendAvatarContainer}>
        <Text style={styles.friendAvatarText}>
          {item.name?.charAt(0)?.toUpperCase() || 'U'}
        </Text>
      </View>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{item.name}</Text>
        {item.location ? (
          <Text style={styles.friendStatus}>
            Last seen: {formatTimeElapsed(item.location.timestamp)}
          </Text>
        ) : (
          <Text style={styles.friendStatusOffline}>Not sharing location</Text>
        )}
      </View>
      <Ionicons 
        name={trackingFriend?.id === item.id ? "location" : "location-outline"} 
        size={24} 
        color={trackingFriend?.id === item.id ? "#007AFF" : "#666"} 
      />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={styles.header}>
        <Text style={styles.title}>Track Location</Text>
        {isOffline && (
          <Text style={styles.offlineText}>Offline Mode - Limited Functionality</Text>
        )}
      </View>

      {/* Friends Tracking Section */}
      {friends.length > 0 && (
        <View style={styles.friendsSection}>
          <Text style={styles.sectionTitle}>Track Friends</Text>
          <FlatList
            data={friends}
            renderItem={renderFriendItem}
            keyExtractor={item => item.id}
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.friendsList}
          />
        </View>
      )}

      {/* Code Tracking Section */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter 6-character tracking code"
          value={trackingCode}
          onChangeText={setTrackingCode}
          maxLength={6}
          keyboardType="default"
          autoCapitalize="characters"
          editable={!isTrackingFriend}
        />
        {!isTracking ? (
          <TouchableOpacity
            style={[styles.button, isTrackingFriend && styles.disabledButton]}
            onPress={startTracking}
            disabled={isTrackingFriend}
          >
            <Text style={styles.buttonText}>Start Tracking</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.stopButton]}
            onPress={stopTracking}
          >
            <Text style={styles.buttonText}>Stop Tracking</Text>
          </TouchableOpacity>
        )}
      </View>

      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

      <Animated.View 
        style={{
          flex: 1,
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
        }}
        {...panResponder.panHandlers}
      >
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
        >
          {currentLocation && (
            <Marker
              coordinate={{
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
              }}
              title="My Location"
              description="This is where you are"
              pinColor="#007AFF"
            />
          )}
          
          {trackedLocation && (
            <Marker
              coordinate={{
                latitude: trackedLocation.latitude,
                longitude: trackedLocation.longitude,
              }}
              title="Tracked Location"
              description="This is the location you're tracking"
              pinColor="#FF3B30"
            />
          )}
          
          {trackingFriend?.location && (
            <Marker
              coordinate={{
                latitude: trackingFriend.location.latitude,
                longitude: trackingFriend.location.longitude,
              }}
              title={trackingFriend.name}
              description={`Last seen: ${formatTimeElapsed(trackingFriend.location.timestamp)}`}
              pinColor="#FF9500"
            />
          )}
          
          {/* Draw route line if both points exist */}
          {currentLocation && (trackedLocation || trackingFriend?.location) && (
            <Polyline
              coordinates={[
                {
                  latitude: currentLocation.latitude,
                  longitude: currentLocation.longitude,
                },
                {
                  latitude: trackedLocation ? trackedLocation.latitude : trackingFriend.location.latitude,
                  longitude: trackedLocation ? trackedLocation.longitude : trackingFriend.location.longitude,
                },
              ]}
              strokeColor="#007AFF"
              strokeWidth={3}
              lineDashPattern={[5, 5]}
            />
          )}
          
          {/* Routes from API */}
          {routes.map((route, index) => (
            <Polyline
              key={index}
              coordinates={route.map(point => ({
                latitude: point.lat,
                longitude: point.lng,
              }))}
              strokeColor="#4CD964"
              strokeWidth={4}
            />
          ))}
        </MapView>
      </Animated.View>

      {/* Info panel */}
      {(trackedLocation || trackingFriend?.location) && currentLocation && (
        <View style={styles.infoPanel}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Distance:</Text>
            <Text style={styles.infoValue}>
              {calculateDistance(
                currentLocation.latitude,
                currentLocation.longitude,
                trackedLocation ? trackedLocation.latitude : trackingFriend.location.latitude,
                trackedLocation ? trackedLocation.longitude : trackingFriend.location.longitude
              )} km
            </Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Direction:</Text>
            <Text style={styles.infoValue}>
              {getDirection(calculateBearing(
                currentLocation.latitude,
                currentLocation.longitude,
                trackedLocation ? trackedLocation.latitude : trackingFriend.location.latitude,
                trackedLocation ? trackedLocation.longitude : trackingFriend.location.longitude
              ))}
            </Text>
          </View>
          
          <TouchableOpacity
            style={styles.centerButton}
            onPress={centerOnPath}
          >
            <Text style={styles.centerButtonText}>Center on Path</Text>
          </TouchableOpacity>
        </View>
      )}

      {isOffline && lastSyncTime && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Showing cached data from {new Date(lastSyncTime).toLocaleString()}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  header: {
    paddingTop: StatusBar.currentHeight || 40,
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginRight: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  startButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: '#ff3b30',
    padding: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 14,
    textAlign: 'center',
    padding: 10,
  },
  controlsContainer: {
    padding: 15,
    alignItems: 'center',
  },
  centerButton: {
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  centerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  draggableContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 10,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#333',
    marginTop: 5,
  },
  friendsSection: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  friendsList: {
    paddingVertical: 5,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    padding: 8,
    borderRadius: 12,
    marginRight: 10,
    width: 150,
  },
  selectedFriend: {
    backgroundColor: '#e6f2ff',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  friendAvatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  friendAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  friendInfo: {
    flex: 1,
    marginRight: 5,
  },
  friendName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  friendStatus: {
    fontSize: 12,
    color: '#666',
  },
  friendStatusOffline: {
    fontSize: 12,
    color: '#999',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  infoPanel: {
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 10,
  },
  infoValue: {
    fontSize: 14,
    color: '#666',
  },
  offlineText: {
    color: '#E34234',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 5,
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