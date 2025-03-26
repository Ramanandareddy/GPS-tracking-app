import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
    apiKey: "AIzaSyBg7gRvecj8Bbyp_fZGOUNQ3xfYZhw2-3M",
    authDomain: "tracker-8c8a0.firebaseapp.com",
    projectId: "tracker-8c8a0",
    storageBucket: "tracker-8c8a0.firebasestorage.app",
    messagingSenderId: "824587622924",
    appId: "1:824587622924:web:4f00ba5a221e8d2f416c29",
    measurementId: "G-EJ94SC01JS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });

export { db, storage, auth };