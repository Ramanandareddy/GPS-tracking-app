import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  StatusBar,
  Modal,
} from 'react-native';
import { auth, db } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
  arrayUnion,
  arrayRemove,
  onSnapshot,
} from 'firebase/firestore';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isConnected, getCachedFriendsLocations, cacheFriendsLocations } from '../utils/offlineManager';

export default function FriendsScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [locationSubscription, setLocationSubscription] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const mapRef = useRef(null);

  // Check network connectivity on mount
  useEffect(() => {
    const checkConnectivity = async () => {
      const connected = await isConnected();
      setIsOffline(!connected);
      
      if (!connected) {
        try {
          // Load cached friends data if offline
          const cachedData = await getCachedFriendsLocations();
          if (cachedData && cachedData.friends) {
            setFriends(cachedData.friends);
            setLastSyncTime(cachedData.timestamp);
          }
          setLoading(false);
        } catch (error) {
          console.error('Error loading cached friends data:', error);
          setLoading(false);
        }
      }
    };
    
    checkConnectivity();
  }, []);

  // Fetch current user data, friends, and friend requests
  useEffect(() => {
    const fetchUserData = async () => {
      if (auth.currentUser) {
        try {
          // Only set up real-time listener if online
          if (await isConnected()) {
            // Set up real-time listener for current user's friends and requests
            const unsubscribe = onSnapshot(
              doc(db, 'users', auth.currentUser.uid),
              async (docSnapshot) => {
                if (docSnapshot.exists()) {
                  const userData = docSnapshot.data();
                  const friendIds = userData.friends || [];
                  const requestIds = userData.friendRequests || [];
                  
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
                  
                  // Fetch friend request data
                  const requestsData = await Promise.all(
                    requestIds.map(async (requestId) => {
                      const requestDocRef = doc(db, 'users', requestId);
                      const requestDoc = await getDoc(requestDocRef);
                      if (requestDoc.exists()) {
                        return { id: requestId, ...requestDoc.data() };
                      }
                      return null;
                    })
                  );
                  
                  const validFriends = friendsData.filter(Boolean);
                  setFriends(validFriends);
                  setFriendRequests(requestsData.filter(Boolean));
                  
                  // Cache friends data for offline use
                  await cacheFriendsLocations({
                    friends: validFriends,
                    timestamp: new Date().toISOString()
                  });
                  
                  setLoading(false);
                }
              }
            );
            
            return unsubscribe;
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setLoading(false);
        }
      }
    };
    
    const unsubscribe = fetchUserData();
    
    // Get and monitor current location
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Permission to access location was denied');
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
          
          // Update user's location in Firestore
          if (auth.currentUser) {
            updateDoc(doc(db, 'users', auth.currentUser.uid), {
              location: {
                latitude: newLocation.coords.latitude,
                longitude: newLocation.coords.longitude,
                timestamp: new Date().toISOString(),
              }
            });
          }
        }
      );
      setLocationSubscription(sub);
    })();
    
    return () => {
      if (unsubscribe) unsubscribe();
      if (locationSubscription) locationSubscription.remove();
    };
  }, [isOffline]);

  // Search for users
  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    
    // Don't allow search in offline mode
    if (isOffline) {
      Alert.alert('Offline Mode', 'Searching for users is not available in offline mode.');
      return;
    }
    
    setIsSearching(true);
    try {
      // Get current user data to check sent requests
      const currentUserDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      const currentUserData = currentUserDoc.data();
      const sentRequestsIds = currentUserData.sentRequests || [];
      
      // Search by email - relaxed to "contains" instead of exact match
      const usersRef = collection(db, 'users');
      const allUsers = await getDocs(usersRef);
      
      // Combine results with manual filtering
      const results = [];
      allUsers.forEach((doc) => {
        const userData = doc.data();
        // Skip current user
        if (doc.id === auth.currentUser.uid) return;
        
        // Skip existing friends
        if (currentUserData.friends && currentUserData.friends.includes(doc.id)) return;
        
        // Check if email or name contains the search query (case insensitive)
        const searchLower = searchQuery.trim().toLowerCase();
        const emailMatch = userData.email && userData.email.toLowerCase().includes(searchLower);
        const nameMatch = userData.name && userData.name.toLowerCase().includes(searchLower);
        
        if (emailMatch || nameMatch) {
          // Add requestSent flag to each user
          results.push({ 
            id: doc.id, 
            ...userData,
            requestSent: sentRequestsIds.includes(doc.id)
          });
        }
      });
      
      setSearchResults(results);
      
      // Alert user if no results found
      if (results.length === 0) {
        Alert.alert('No Results', 'No users found matching your search query');
      }
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('Error', 'Failed to search for users');
    } finally {
      setIsSearching(false);
    }
  };

  // Send friend request
  const sendFriendRequest = async (userId) => {
    // Don't allow sending requests in offline mode
    if (isOffline) {
      Alert.alert('Offline Mode', 'Sending friend requests is not available in offline mode.');
      return;
    }
    
    try {
      // Add to recipient's friend requests
      await updateDoc(doc(db, 'users', userId), {
        friendRequests: arrayUnion(auth.currentUser.uid)
      });
      
      // Add to current user's sent requests
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        sentRequests: arrayUnion(userId)
      });
      
      Alert.alert('Success', 'Friend request sent');
      
      // Remove user from search results
      setSearchResults(prev => prev.filter(user => user.id !== userId));
    } catch (error) {
      console.error('Error sending friend request:', error);
      Alert.alert('Error', 'Failed to send friend request');
    }
  };

  // Accept friend request
  const acceptFriendRequest = async (userId) => {
    try {
      // Add to current user's friends
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        friends: arrayUnion(userId),
        friendRequests: arrayRemove(userId)
      });
      
      // Add current user to the other user's friends
      await updateDoc(doc(db, 'users', userId), {
        friends: arrayUnion(auth.currentUser.uid),
        sentRequests: arrayRemove(auth.currentUser.uid)
      });
      
      // Update the local state
      const userToAccept = friendRequests.find(req => req.id === userId);
      if (userToAccept) {
        setFriends(prev => [...prev, userToAccept]);
        setFriendRequests(prev => prev.filter(req => req.id !== userId));
      }
    } catch (error) {
      console.error('Error accepting friend request:', error);
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  // Decline friend request
  const declineFriendRequest = async (userId) => {
    try {
      // Remove from current user's friend requests
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        friendRequests: arrayRemove(userId)
      });
      
      // Remove from sender's sent requests
      await updateDoc(doc(db, 'users', userId), {
        sentRequests: arrayRemove(auth.currentUser.uid)
      });
      
      // Update the local state
      setFriendRequests(prev => prev.filter(req => req.id !== userId));
    } catch (error) {
      console.error('Error declining friend request:', error);
      Alert.alert('Error', 'Failed to decline friend request');
    }
  };

  // Remove friend
  const removeFriend = async (userId) => {
    try {
      // Remove from current user's friends
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        friends: arrayRemove(userId)
      });
      
      // Remove current user from the other user's friends
      await updateDoc(doc(db, 'users', userId), {
        friends: arrayRemove(auth.currentUser.uid)
      });
      
      // Update the local state
      setFriends(prev => prev.filter(friend => friend.id !== userId));
    } catch (error) {
      console.error('Error removing friend:', error);
      Alert.alert('Error', 'Failed to remove friend');
    }
  };

  // Toggle friend selection for map
  const toggleFriendSelection = (friendId) => {
    setSelectedFriends(prev => {
      if (prev.includes(friendId)) {
        return prev.filter(id => id !== friendId);
      } else {
        return [...prev, friendId];
      }
    });
  };

  // Show map with selected friends
  const showFriendsOnMap = () => {
    if (selectedFriends.length === 0) {
      Alert.alert('No Friends Selected', 'Please select at least one friend to view on the map');
      return;
    }
    
    setShowMap(true);
    
    // Small delay to ensure map is rendered before fitting bounds
    setTimeout(() => {
      fitMapToMarkers();
    }, 500);
  };
  
  // Fit map to show all markers (user + selected friends)
  const fitMapToMarkers = () => {
    if (!mapRef.current || !currentLocation) return;
    
    const allCoordinates = [
      { 
        latitude: currentLocation.latitude, 
        longitude: currentLocation.longitude 
      }
    ];
    
    // Add coordinates for all selected friends with valid locations
    friends.forEach(friend => {
      if (
        selectedFriends.includes(friend.id) && 
        friend.location && 
        friend.location.latitude && 
        friend.location.longitude
      ) {
        allCoordinates.push({
          latitude: friend.location.latitude,
          longitude: friend.location.longitude
        });
      }
    });
    
    // Only proceed if we have at least two points (user + at least one friend)
    if (allCoordinates.length >= 2) {
      mapRef.current.fitToCoordinates(allCoordinates, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true
      });
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
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {item.name?.charAt(0)?.toUpperCase() || 'U'}
          </Text>
        </View>
        <View style={styles.friendDetails}>
          <Text style={styles.friendName}>{item.name}</Text>
          <Text style={styles.friendEmail}>{item.email}</Text>
          <Text style={styles.locationStatus}>
            {item.location ? 
              `Last seen: ${formatTimeElapsed(item.location.timestamp)}` : 
              'Location not shared'}
          </Text>
        </View>
      </View>
      
      <View style={styles.friendActions}>
        <TouchableOpacity 
          style={[
            styles.actionButton, 
            selectedFriends.includes(item.id) ? styles.selectedButton : null
          ]}
          onPress={() => toggleFriendSelection(item.id)}
        >
          <Ionicons 
            name={selectedFriends.includes(item.id) ? "checkmark-circle" : "map-outline"} 
            size={22} 
            color={selectedFriends.includes(item.id) ? "#fff" : "#007AFF"} 
          />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionButton, styles.removeButton]}
          onPress={() => {
            Alert.alert(
              'Remove Friend',
              `Are you sure you want to remove ${item.name} from your friends?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', onPress: () => removeFriend(item.id), style: 'destructive' }
              ]
            );
          }}
        >
          <Ionicons name="person-remove-outline" size={22} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Render friend request item
  const renderRequestItem = ({ item }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {item.name?.charAt(0)?.toUpperCase() || 'U'}
          </Text>
        </View>
        <View style={styles.friendDetails}>
          <Text style={styles.friendName}>{item.name}</Text>
          <Text style={styles.friendEmail}>{item.email}</Text>
        </View>
      </View>
      
      <View style={styles.friendActions}>
        <TouchableOpacity 
          style={[styles.actionButton, styles.acceptButton]}
          onPress={() => acceptFriendRequest(item.id)}
        >
          <Ionicons name="checkmark-outline" size={22} color="#ffffff" />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionButton, styles.declineButton]}
          onPress={() => declineFriendRequest(item.id)}
        >
          <Ionicons name="close-outline" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Render search result item
  const renderSearchItem = ({ item }) => {
    const isFriend = friends.some(friend => friend.id === item.id);
    const isRequested = item.requestSent || false;
    
    return (
      <View style={styles.friendItem}>
        <View style={styles.friendInfo}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {item.name?.charAt(0)?.toUpperCase() || 'U'}
            </Text>
          </View>
          <View style={styles.friendDetails}>
            <Text style={styles.friendName}>{item.name}</Text>
            <Text style={styles.friendEmail}>{item.email}</Text>
          </View>
        </View>
        
        <View style={styles.friendActions}>
          {isFriend ? (
            <View style={[styles.actionButton, styles.alreadyFriendButton]}>
              <Text style={styles.actionButtonText}>Friends</Text>
            </View>
          ) : isRequested ? (
            <View style={[styles.actionButton, styles.requestedButton]}>
              <Text style={styles.actionButtonText}>Requested</Text>
            </View>
          ) : (
            <TouchableOpacity 
              style={[styles.actionButton, styles.addButton]}
              onPress={() => sendFriendRequest(item.id)}
            >
              <Ionicons name="person-add-outline" size={22} color="#ffffff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.header}>
        <Text style={styles.title}>Friends</Text>
        {isOffline && (
          <Text style={styles.offlineText}>Offline Mode - Limited Functionality</Text>
        )}
      </View>
      
      {isOffline && lastSyncTime && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Showing cached friends data from {new Date(lastSyncTime).toLocaleString()}
          </Text>
        </View>
      )}
      
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        <TouchableOpacity 
          style={styles.searchButton}
          onPress={searchUsers}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </TouchableOpacity>
      </View>
      
      {searchResults.length > 0 && (
        <View style={styles.resultsContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Search Results</Text>
            <TouchableOpacity onPress={() => setSearchResults([])}>
              <Ionicons name="close-circle" size={24} color="#999" />
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={searchResults}
            renderItem={renderSearchItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}
      
      {friendRequests.length > 0 && (
        <View style={styles.requestsContainer}>
          <Text style={styles.sectionTitle}>Friend Requests ({friendRequests.length})</Text>
          <FlatList
            data={friendRequests}
            renderItem={renderRequestItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}
      
      <View style={styles.friendsContainer}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Your Friends ({friends.length})
          </Text>
          {selectedFriends.length > 0 && (
            <TouchableOpacity 
              style={styles.viewMapButton}
              onPress={showFriendsOnMap}
            >
              <Text style={styles.viewMapButtonText}>
                View on Map ({selectedFriends.length})
              </Text>
            </TouchableOpacity>
          )}
        </View>
        
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : friends.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people" size={64} color="#ccc" />
            <Text style={styles.emptyStateText}>
              You don't have any friends yet.
            </Text>
            <Text style={styles.emptyStateSubText}>
              Search for friends using the search bar above.
            </Text>
          </View>
        ) : (
          <FlatList
            data={friends}
            renderItem={renderFriendItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
      
      {/* Map Modal */}
      <Modal
        visible={showMap}
        animationType="slide"
        onRequestClose={() => setShowMap(false)}
      >
        <View style={styles.mapContainer}>
          <View style={styles.mapHeader}>
            <Text style={styles.mapTitle}>Friends on Map</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowMap(false)}
            >
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>
          
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={
              currentLocation
                ? {
                    latitude: currentLocation.latitude,
                    longitude: currentLocation.longitude,
                    latitudeDelta: 0.0222,
                    longitudeDelta: 0.0121,
                  }
                : {
                    latitude: 37.78825,
                    longitude: -122.4324,
                    latitudeDelta: 0.0222,
                    longitudeDelta: 0.0121,
                  }
            }
          >
            {/* Current user marker */}
            {currentLocation && (
              <Marker
                coordinate={{
                  latitude: currentLocation.latitude,
                  longitude: currentLocation.longitude,
                }}
                title="You"
                description="Your current location"
                pinColor="#007AFF"
              />
            )}
            
            {/* Friend markers */}
            {friends
              .filter(friend => 
                selectedFriends.includes(friend.id) && 
                friend.location && 
                friend.location.latitude && 
                friend.location.longitude
              )
              .map(friend => (
                <React.Fragment key={friend.id}>
                  <Marker
                    coordinate={{
                      latitude: friend.location.latitude,
                      longitude: friend.location.longitude,
                    }}
                    title={friend.name}
                    description={`Last updated: ${formatTimeElapsed(friend.location.timestamp)}`}
                    pinColor="#FF9500"
                  />
                  
                  {/* Polyline connecting user to friend */}
                  {currentLocation && (
                    <Polyline
                      coordinates={[
                        {
                          latitude: currentLocation.latitude,
                          longitude: currentLocation.longitude,
                        },
                        {
                          latitude: friend.location.latitude,
                          longitude: friend.location.longitude,
                        }
                      ]}
                      strokeColor="#007AFF"
                      strokeWidth={3}
                      lineDashPattern={[5, 5]}
                    />
                  )}
                </React.Fragment>
              ))}
          </MapView>
          
          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#007AFF' }]} />
              <Text style={styles.legendText}>You</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#FF9500' }]} />
              <Text style={styles.legendText}>Friends</Text>
            </View>
          </View>
          
          {/* Recenter button */}
          <TouchableOpacity
            style={styles.recenterButton}
            onPress={fitMapToMarkers}
          >
            <Ionicons name="locate-outline" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </Modal>
      
      {isOffline && (
        <View style={styles.offlineFooter}>
          <Text style={styles.offlineFooterText}>
            Some features are limited while offline. Connect to the internet to use all features.
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
    paddingTop: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    marginRight: 10,
    backgroundColor: '#f9f9f9',
  },
  searchButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  friendsContainer: {
    flex: 1,
  },
  requestsContainer: {
    paddingTop: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  resultsContainer: {
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  listContent: {
    paddingHorizontal: 15,
  },
  friendItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  friendDetails: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  friendEmail: {
    fontSize: 14,
    color: '#666',
  },
  locationStatus: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  friendActions: {
    flexDirection: 'row',
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 5,
    backgroundColor: '#f0f0f0',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  acceptButton: {
    backgroundColor: '#4CD964',
  },
  declineButton: {
    backgroundColor: '#FF3B30',
  },
  addButton: {
    backgroundColor: '#007AFF',
  },
  removeButton: {
    backgroundColor: '#f0f0f0',
  },
  selectedButton: {
    backgroundColor: '#007AFF',
  },
  alreadyFriendButton: {
    backgroundColor: '#8E8E93',
    paddingHorizontal: 10,
    width: 'auto',
  },
  requestedButton: {
    backgroundColor: '#FF9500',
    paddingHorizontal: 10,
    width: 'auto',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyStateText: {
    fontSize: 18,
    color: '#333',
    marginTop: 10,
    textAlign: 'center',
  },
  emptyStateSubText: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  viewMapButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  viewMapButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  mapContainer: {
    flex: 1,
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 40,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  mapTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 5,
  },
  map: {
    flex: 1,
  },
  legend: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 5,
  },
  legendText: {
    fontSize: 12,
    color: '#333',
  },
  recenterButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 10,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
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
  offlineFooter: {
    backgroundColor: '#E8EAF6',
    padding: 15,
    borderRadius: 8,
    margin: 10,
    marginTop: 'auto',
  },
  offlineFooterText: {
    color: '#3F51B5',
    fontSize: 14,
    textAlign: 'center',
  },
}); 