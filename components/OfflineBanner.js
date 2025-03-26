import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const OfflineBanner = ({ isOffline }) => {
  const [fadeAnim] = React.useState(new Animated.Value(0));
  
  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isOffline ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline]);
  
  if (!isOffline) return null;
  
  return (
    <Animated.View 
      style={[
        styles.container,
        { opacity: fadeAnim }
      ]}
    >
      <Ionicons name="cloud-offline" size={18} color="#fff" />
      <Text style={styles.text}>You're offline. Showing cached data.</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#E34234',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  text: {
    color: '#fff',
    marginLeft: 8,
    fontWeight: '600',
  },
});

export default OfflineBanner; 