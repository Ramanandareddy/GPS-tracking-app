import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// Keys for AsyncStorage
const LOCATION_CACHE_KEY = '@location_cache';
const FRIENDS_LOCATIONS_CACHE_KEY = '@friends_locations_cache';
const PENDING_UPDATES_KEY = '@pending_updates';

// Function to check if device is connected to the internet
export const isConnected = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected && state.isInternetReachable;
};

// Cache current user's location locally
export const cacheUserLocation = async (location) => {
  try {
    if (!location) return;
    
    const locationData = {
      userId: auth.currentUser.uid,
      location: location,
      timestamp: new Date().toISOString(),
    };
    
    await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locationData));
    console.log('Location cached successfully');
    
    // Also add to pending updates queue
    await addToPendingUpdates({
      type: 'updateUserLocation',
      data: locationData
    });
    
  } catch (error) {
    console.error('Error caching location:', error);
  }
};

// Cache friends' locations
export const cacheFriendsLocations = async (friendsLocations) => {
  try {
    await AsyncStorage.setItem(FRIENDS_LOCATIONS_CACHE_KEY, JSON.stringify(friendsLocations));
    console.log('Friends locations cached successfully');
  } catch (error) {
    console.error('Error caching friends locations:', error);
  }
};

// Get cached user location
export const getCachedUserLocation = async () => {
  try {
    const locationData = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
    return locationData ? JSON.parse(locationData) : null;
  } catch (error) {
    console.error('Error getting cached location:', error);
    return null;
  }
};

// Get cached friends locations
export const getCachedFriendsLocations = async () => {
  try {
    const friendsLocations = await AsyncStorage.getItem(FRIENDS_LOCATIONS_CACHE_KEY);
    return friendsLocations ? JSON.parse(friendsLocations) : [];
  } catch (error) {
    console.error('Error getting cached friends locations:', error);
    return [];
  }
};

// Add an operation to pending updates queue
const addToPendingUpdates = async (operation) => {
  try {
    const pendingUpdates = await AsyncStorage.getItem(PENDING_UPDATES_KEY);
    let updates = pendingUpdates ? JSON.parse(pendingUpdates) : [];
    updates.push(operation);
    await AsyncStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(updates));
  } catch (error) {
    console.error('Error adding to pending updates:', error);
  }
};

// Process pending updates when back online
export const processPendingUpdates = async () => {
  try {
    const isOnline = await isConnected();
    if (!isOnline) return false;
    
    const pendingUpdates = await AsyncStorage.getItem(PENDING_UPDATES_KEY);
    if (!pendingUpdates) return true;
    
    const updates = JSON.parse(pendingUpdates);
    if (updates.length === 0) return true;
    
    console.log(`Processing ${updates.length} pending updates`);
    
    for (const update of updates) {
      switch (update.type) {
        case 'updateUserLocation':
          if (auth.currentUser) {
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              location: update.data.location
            }, { merge: true });
          }
          break;
        // Add more cases as needed for different types of operations
      }
    }
    
    // Clear pending updates after successful processing
    await AsyncStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify([]));
    return true;
  } catch (error) {
    console.error('Error processing pending updates:', error);
    return false;
  }
};

// Set up NetInfo listener to detect connectivity changes
export const setupConnectivityListener = (setOfflineMode) => {
  return NetInfo.addEventListener(state => {
    const isOnline = state.isConnected && state.isInternetReachable;
    setOfflineMode(!isOnline);
    
    if (isOnline) {
      // When coming back online, process pending updates
      processPendingUpdates()
        .then(success => {
          if (success) {
            console.log('Successfully synced pending updates');
          }
        });
    }
  });
}; 