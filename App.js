// App.js
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import * as SplashScreen from 'expo-splash-screen';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View, StyleSheet } from 'react-native';
import LoginScreen from './screens/Login';
import SignupScreen from './screens/Signup';
import HomeScreen from './screens/Home';
import ProfileScreen from './screens/Profile';
import TrackerScreen from './screens/Tracker'; // Added import
import FriendsScreen from './screens/Friends'; // New import for Friends screen
import OfflineBanner from './components/OfflineBanner';
import { setupConnectivityListener } from './utils/offlineManager';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Auth Stack Navigator for Login and Signup
function AuthStack() {
  return (
    <Stack.Navigator initialRouteName="Login">
      <Stack.Screen 
        name="Login" 
        component={LoginScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen 
        name="Signup" 
        component={SignupScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

// Main Tab Navigator for authenticated users
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
      }}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" color={color} size={size} />
          ),
          headerShown: false,
        }}
      />
      <Tab.Screen 
        name="Friends" 
        component={FriendsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" color={color} size={size} />
          ),
          headerShown: false,
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color} size={size} />
          ),
          headerShown: false,
        }}
      />
      <Tab.Screen 
        name="Track" 
        component={TrackerScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="location" color={color} size={size} />
          ),
          headerShown: false,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = React.useState(null);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    SplashScreen.preventAutoHideAsync();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      SplashScreen.hideAsync();
    });
    
    // Set up network connectivity listener
    const netInfoUnsubscribe = setupConnectivityListener(setIsOffline);
    
    return () => {
      unsubscribe();
      netInfoUnsubscribe && netInfoUnsubscribe();
    };
  }, []);

  return (
    <View style={styles.container}>
      <NavigationContainer>
        {user ? <MainTabs /> : <AuthStack />}
      </NavigationContainer>
      <OfflineBanner isOffline={isOffline} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});